import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { createHash, randomBytes } from "crypto";
import { OrderStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadBusinessContext, checkSafetyTriggers, generateAIResponse, type ConversationMessage } from "./promptBuilder";

const app = express();
const port = Number(process.env.PORT || 3000);

console.log(`DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "sema-api",
    version: "1.0.0",
    description: "WhatsApp Business API with multi-niche AI agent support",
    endpoints: {
      health: "/api/health",
      niches: "/api/niches",
      webhook: "/webhooks/whatsapp"
    }
  });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "sema-api" });
});

app.get("/api/debug/env", (_req: Request, res: Response) => {
  res.json({
    hasDbUrl: !!process.env.DATABASE_URL,
    dbUrlPrefix: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + "..." : null,
    nodeEnv: process.env.NODE_ENV || "not set",
  });
});

app.get("/api/debug/dbinfo", (_req: Request, res: Response) => {
  const url = process.env.DATABASE_URL || "";
  res.json({
    hasDbUrl: Boolean(url),
    dbUrlPrefix: url ? url.slice(0, 25) : null,
    dbUrlHash: url ? createHash("sha256").update(url).digest("hex").slice(0, 12) : null,
  });
});

app.get("/api/db/ping", async (_req: Request, res: Response) => {
  try {
    await prisma.whatsappConnection.findFirst();
    res.json({ ok: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "Unknown";
    console.error("Database ping failed:", error instanceof Error ? error.stack : error);
    res.status(500).json({ 
      ok: false, 
      error: "Database connection failed", 
      code: "DB_PING_FAILED",
      details: { name: errorName, message: errorMessage.substring(0, 200) }
    });
  }
});

app.post("/api/whatsapp/connect", async (req: Request, res: Response) => {
  try {
    const { wabaId, phoneNumberId, accessToken, displayPhoneNumber } = req.body;

    if (!wabaId || !phoneNumberId || !accessToken) {
      res.status(400).json({ error: "wabaId, phoneNumberId, and accessToken are required" });
      return;
    }

    const connection = await prisma.whatsappConnection.upsert({
      where: { phoneNumberId },
      update: {
        wabaId,
        accessToken,
        displayPhoneNumber: displayPhoneNumber || null,
      },
      create: {
        wabaId,
        phoneNumberId,
        accessToken,
        displayPhoneNumber: displayPhoneNumber || null,
      },
    });

    res.json({
      id: connection.id,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
      accessToken: "***masked***",
      displayPhoneNumber: connection.displayPhoneNumber,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  } catch (error) {
    console.error("Error saving connection:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to save connection" });
  }
});

app.get("/api/whatsapp/connections", async (_req: Request, res: Response) => {
  try {
    const connections = await prisma.whatsappConnection.findMany({
      orderBy: { createdAt: "desc" },
    });

    const maskedConnections = connections.map((conn) => ({
      id: conn.id,
      wabaId: conn.wabaId,
      phoneNumberId: conn.phoneNumberId,
      accessToken: "***masked***",
      displayPhoneNumber: conn.displayPhoneNumber,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));

    res.json(maskedConnections);
  } catch (error) {
    console.error("Error fetching connections:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to fetch connections", code: "CONNECTIONS_FETCH_FAILED" });
  }
});

app.get("/webhooks/whatsapp", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    console.log("WhatsApp webhook verified");
    res.status(200).send(challenge);
  } else {
    console.log("WhatsApp webhook verification failed");
    res.sendStatus(403);
  }
});

app.post("/webhooks/whatsapp", (req: Request, res: Response) => {
  const body = req.body;
  
  res.sendStatus(200);

  (async () => {
    try {
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const msg = value?.messages?.[0];
      const from = msg?.from;
      const text = msg?.text?.body || "(no text)";

      console.log("incoming webhook", { phone_number_id: phoneNumberId || null, from: from || null });

      if (!phoneNumberId || !from) {
        console.log("Missing phoneNumberId or from, skipping auto-reply");
        return;
      }

      const connection = await prisma.whatsappConnection.findUnique({
        where: { phoneNumberId },
        include: { businessProfile: true },
      });

      if (!connection) {
        console.log(`No connection found for phone_number_id: ${phoneNumberId}`);
        return;
      }

      console.log(`Connection found for ${phoneNumberId}, processing message from ${from}`);

      let conversation = await prisma.conversation.findUnique({
        where: { connectionId_customerPhone: { connectionId: connection.id, customerPhone: from } },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { connectionId: connection.id, customerPhone: from },
        });
      }

      if (conversation.needsHuman) {
        console.log(`Conversation ${conversation.id} is escalated, skipping AI reply`);
        return;
      }

      const history = (conversation.messageHistory as unknown as ConversationMessage[]) || [];

      const businessContext = await loadBusinessContext(prisma, connection.id);

      let replyText: string;

      if (!businessContext) {
        replyText = "Sema ✅ I received: " + text;
        console.log("No business profile configured, using fallback reply");
      } else {
        const safetyCheck = checkSafetyTriggers(text, businessContext.template);

        if (safetyCheck.shouldRefuse) {
          replyText = safetyCheck.message || "I'm not able to help with that request.";
          console.log("Safety refusal triggered");
        } else if (safetyCheck.shouldEscalate) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              needsHuman: true,
              escalationReason: `Triggered by message: "${text.slice(0, 100)}"`,
              status: "escalated",
            },
          });
          replyText = safetyCheck.message || "Let me connect you with someone who can help better.";
          console.log("Escalation triggered, conversation marked for human handoff");
        } else {
          try {
            replyText = await generateAIResponse(businessContext, text, history);
            console.log("AI response generated successfully");
          } catch (aiError) {
            console.error("AI generation failed:", aiError instanceof Error ? aiError.message : aiError);
            replyText = "I'm having trouble processing your request. Please try again in a moment.";
          }
        }
      }

      const updatedHistory: ConversationMessage[] = [
        ...history.slice(-19),
        { role: "user", content: text },
        { role: "assistant", content: replyText },
      ];

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { messageHistory: updatedHistory as unknown as any },
      });

      const graphResponse = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${connection.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            type: "text",
            text: { body: replyText },
          }),
        }
      );

      const graphBody = await graphResponse.text();
      console.log("Graph API response:", { status: graphResponse.status, body: graphBody });

    } catch (error) {
      console.error("Error processing webhook:", error instanceof Error ? error.stack : error);
    }
  })();
});

// ============ NICHE ENDPOINTS ============

app.get("/api/niches", async (_req: Request, res: Response) => {
  try {
    const niches = await prisma.niche.findMany({
      where: { isActive: true },
      orderBy: { label: "asc" },
      select: { id: true, label: true, version: true }
    });
    res.json(niches);
  } catch (error) {
    console.error("Error fetching niches:", error);
    res.status(500).json({ error: "Failed to fetch niches" });
  }
});

app.get("/api/niches/:id/template", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const niche = await prisma.niche.findUnique({
      where: { id },
      include: { template: true }
    });

    if (!niche) {
      const fallback = await prisma.niche.findUnique({
        where: { id: "general_retail" },
        include: { template: true }
      });
      if (fallback?.template) {
        res.json({
          nicheId: fallback.id,
          label: fallback.label,
          intakeQuestions: (fallback.template.templateJson as any).intakeQuestions || [],
          template: fallback.template.templateJson
        });
        return;
      }
      res.status(404).json({ error: "Niche not found" });
      return;
    }

    res.json({
      nicheId: niche.id,
      label: niche.label,
      intakeQuestions: niche.template ? (niche.template.templateJson as any).intakeQuestions || [] : [],
      template: niche.template?.templateJson || null
    });
  } catch (error) {
    console.error("Error fetching niche template:", error);
    res.status(500).json({ error: "Failed to fetch niche template" });
  }
});

// ============ BUSINESS PROFILE ENDPOINTS ============

async function getBusinessFromHeader(req: Request): Promise<{ connectionId: string; businessId: string } | null> {
  const phoneNumberId = req.headers["x-phone-number-id"] as string;
  if (!phoneNumberId) return null;

  const connection = await prisma.whatsappConnection.findUnique({
    where: { phoneNumberId },
    include: { businessProfile: true }
  });

  if (!connection) return null;

  if (!connection.businessProfile) {
    const profile = await prisma.businessProfile.create({
      data: { connectionId: connection.id }
    });
    return { connectionId: connection.id, businessId: profile.id };
  }

  return { connectionId: connection.id, businessId: connection.businessProfile.id };
}

app.get("/api/business/profile", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const profile = await prisma.businessProfile.findUnique({
      where: { id: ctx.businessId },
      include: { niche: true }
    });

    res.json(profile);
  } catch (error) {
    console.error("Error fetching business profile:", error);
    res.status(500).json({ error: "Failed to fetch business profile" });
  }
});

app.put("/api/business/profile", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { nicheId, businessName, languagePreference, tonePreference, handoffRules, intakeAnswers } = req.body;

    if (nicheId) {
      const niche = await prisma.niche.findUnique({ where: { id: nicheId } });
      if (!niche) {
        res.status(400).json({ error: "Invalid nicheId" });
        return;
      }
    }

    const profile = await prisma.businessProfile.update({
      where: { id: ctx.businessId },
      data: {
        ...(nicheId !== undefined && { nicheId }),
        ...(businessName !== undefined && { businessName }),
        ...(languagePreference !== undefined && { languagePreference }),
        ...(tonePreference !== undefined && { tonePreference }),
        ...(handoffRules !== undefined && { handoffRules }),
        ...(intakeAnswers !== undefined && { intakeAnswers })
      },
      include: { niche: true }
    });

    res.json(profile);
  } catch (error) {
    console.error("Error updating business profile:", error);
    res.status(500).json({ error: "Failed to update business profile" });
  }
});

// ============ KNOWLEDGE SOURCE ENDPOINTS ============

app.get("/api/knowledge-sources", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const sources = await prisma.knowledgeSource.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" }
    });

    res.json(sources);
  } catch (error) {
    console.error("Error fetching knowledge sources:", error);
    res.status(500).json({ error: "Failed to fetch knowledge sources" });
  }
});

app.post("/api/knowledge-sources", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { type, title, contentText, metaJson, isEnabled } = req.body;

    if (!type || !title || !contentText) {
      res.status(400).json({ error: "type, title, and contentText are required" });
      return;
    }

    const source = await prisma.knowledgeSource.create({
      data: {
        businessId: ctx.businessId,
        type,
        title,
        contentText,
        metaJson: metaJson || {},
        isEnabled: isEnabled !== false
      }
    });

    res.status(201).json(source);
  } catch (error) {
    console.error("Error creating knowledge source:", error);
    res.status(500).json({ error: "Failed to create knowledge source" });
  }
});

app.put("/api/knowledge-sources/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;
    const { type, title, contentText, metaJson, isEnabled } = req.body;

    const existing = await prisma.knowledgeSource.findFirst({
      where: { id, businessId: ctx.businessId }
    });

    if (!existing) {
      res.status(404).json({ error: "Knowledge source not found" });
      return;
    }

    const source = await prisma.knowledgeSource.update({
      where: { id },
      data: {
        ...(type !== undefined && { type }),
        ...(title !== undefined && { title }),
        ...(contentText !== undefined && { contentText }),
        ...(metaJson !== undefined && { metaJson }),
        ...(isEnabled !== undefined && { isEnabled })
      }
    });

    res.json(source);
  } catch (error) {
    console.error("Error updating knowledge source:", error);
    res.status(500).json({ error: "Failed to update knowledge source" });
  }
});

app.delete("/api/knowledge-sources/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;

    const existing = await prisma.knowledgeSource.findFirst({
      where: { id, businessId: ctx.businessId }
    });

    if (!existing) {
      res.status(404).json({ error: "Knowledge source not found" });
      return;
    }

    await prisma.knowledgeSource.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting knowledge source:", error);
    res.status(500).json({ error: "Failed to delete knowledge source" });
  }
});

// ============ FAQ ENDPOINTS ============

app.get("/api/faqs", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const faqs = await prisma.fAQItem.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" }
    });

    res.json(faqs);
  } catch (error) {
    console.error("Error fetching FAQs:", error);
    res.status(500).json({ error: "Failed to fetch FAQs" });
  }
});

app.post("/api/faqs", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { question, answer, isEnabled } = req.body;

    if (!question || !answer) {
      res.status(400).json({ error: "question and answer are required" });
      return;
    }

    const faq = await prisma.fAQItem.create({
      data: {
        businessId: ctx.businessId,
        question,
        answer,
        isEnabled: isEnabled !== false
      }
    });

    res.status(201).json(faq);
  } catch (error) {
    console.error("Error creating FAQ:", error);
    res.status(500).json({ error: "Failed to create FAQ" });
  }
});

app.put("/api/faqs/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;
    const { question, answer, isEnabled } = req.body;

    const existing = await prisma.fAQItem.findFirst({
      where: { id, businessId: ctx.businessId }
    });

    if (!existing) {
      res.status(404).json({ error: "FAQ not found" });
      return;
    }

    const faq = await prisma.fAQItem.update({
      where: { id },
      data: {
        ...(question !== undefined && { question }),
        ...(answer !== undefined && { answer }),
        ...(isEnabled !== undefined && { isEnabled })
      }
    });

    res.json(faq);
  } catch (error) {
    console.error("Error updating FAQ:", error);
    res.status(500).json({ error: "Failed to update FAQ" });
  }
});

app.delete("/api/faqs/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;

    const existing = await prisma.fAQItem.findFirst({
      where: { id, businessId: ctx.businessId }
    });

    if (!existing) {
      res.status(404).json({ error: "FAQ not found" });
      return;
    }

    await prisma.fAQItem.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting FAQ:", error);
    res.status(500).json({ error: "Failed to delete FAQ" });
  }
});

// ============ POLICIES ENDPOINTS ============

app.get("/api/policies", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    let policies = await prisma.policies.findUnique({
      where: { businessId: ctx.businessId }
    });

    if (!policies) {
      policies = await prisma.policies.create({
        data: { businessId: ctx.businessId }
      });
    }

    res.json(policies);
  } catch (error) {
    console.error("Error fetching policies:", error);
    res.status(500).json({ error: "Failed to fetch policies" });
  }
});

app.put("/api/policies", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { returnsPolicyText, warrantyPolicyText, deliveryPolicyText, paymentMethodsJson } = req.body;

    const policies = await prisma.policies.upsert({
      where: { businessId: ctx.businessId },
      update: {
        ...(returnsPolicyText !== undefined && { returnsPolicyText }),
        ...(warrantyPolicyText !== undefined && { warrantyPolicyText }),
        ...(deliveryPolicyText !== undefined && { deliveryPolicyText }),
        ...(paymentMethodsJson !== undefined && { paymentMethodsJson })
      },
      create: {
        businessId: ctx.businessId,
        returnsPolicyText: returnsPolicyText || null,
        warrantyPolicyText: warrantyPolicyText || null,
        deliveryPolicyText: deliveryPolicyText || null,
        paymentMethodsJson: paymentMethodsJson || []
      }
    });

    res.json(policies);
  } catch (error) {
    console.error("Error updating policies:", error);
    res.status(500).json({ error: "Failed to update policies" });
  }
});

// ============ PRODUCTS/SERVICES ENDPOINTS ============

app.get("/api/products", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const products = await prisma.productOrService.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" }
    });

    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.post("/api/products", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { name, price, currency, description, category, isActive, sku, imageUrl } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const product = await prisma.productOrService.create({
      data: {
        businessId: ctx.businessId,
        name,
        price: price || null,
        currency: currency || "KES",
        description: description || null,
        category: category || null,
        isActive: isActive !== false,
        sku: sku || null,
        imageUrl: imageUrl || null
      }
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

app.put("/api/products/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;
    const { name, price, currency, description, category, isActive, sku, imageUrl } = req.body;

    const existing = await prisma.productOrService.findFirst({
      where: { id, businessId: ctx.businessId }
    });

    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const product = await prisma.productOrService.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(currency !== undefined && { currency }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
        ...(sku !== undefined && { sku }),
        ...(imageUrl !== undefined && { imageUrl })
      }
    });

    res.json(product);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.delete("/api/products/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getBusinessFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;

    const existing = await prisma.productOrService.findFirst({
      where: { id, businessId: ctx.businessId }
    });

    if (!existing) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    await prisma.productOrService.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

// ============ CONVERSATION ENDPOINTS ============

async function getConnectionFromHeader(req: Request): Promise<{ connectionId: string; businessId: string } | null> {
  const phoneNumberId = req.headers["x-phone-number-id"] as string;
  if (!phoneNumberId) return null;

  const connection = await prisma.whatsappConnection.findUnique({
    where: { phoneNumberId },
    include: { businessProfile: true }
  });

  if (!connection) return null;

  return { 
    connectionId: connection.id, 
    businessId: connection.businessProfile?.id || ""
  };
}

app.get("/api/conversations", async (req: Request, res: Response) => {
  try {
    const ctx = await getConnectionFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const conversations = await prisma.conversation.findMany({
      where: { connectionId: ctx.connectionId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        customerPhone: true,
        status: true,
        needsHuman: true,
        escalationReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

app.get("/api/conversations/:id", async (req: Request, res: Response) => {
  try {
    const ctx = await getConnectionFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, connectionId: ctx.connectionId },
    });

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json(conversation);
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

app.put("/api/conversations/:id/resolve", async (req: Request, res: Response) => {
  try {
    const ctx = await getConnectionFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;

    const result = await prisma.conversation.updateMany({
      where: { id, connectionId: ctx.connectionId },
      data: {
        needsHuman: false,
        status: "active",
        escalationReason: null,
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const updated = await prisma.conversation.findUnique({ where: { id } });
    res.json(updated);
  } catch (error) {
    console.error("Error resolving conversation:", error);
    res.status(500).json({ error: "Failed to resolve conversation" });
  }
});

app.put("/api/conversations/:id/escalate", async (req: Request, res: Response) => {
  try {
    const ctx = await getConnectionFromHeader(req);
    if (!ctx) {
      res.status(401).json({ error: "Missing or invalid X-Phone-Number-Id header" });
      return;
    }

    const { id } = req.params;
    const { reason } = req.body;

    const result = await prisma.conversation.updateMany({
      where: { id, connectionId: ctx.connectionId },
      data: {
        needsHuman: true,
        status: "escalated",
        escalationReason: reason || "Manual escalation",
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const updated = await prisma.conversation.findUnique({ where: { id } });
    res.json(updated);
  } catch (error) {
    console.error("Error escalating conversation:", error);
    res.status(500).json({ error: "Failed to escalate conversation" });
  }
});

// ============ ADMIN AUTH & MANAGEMENT ============

interface AdminSession {
  adminId: string;
  createdAt: Date;
  expiresAt: Date;
}

const adminSessions = new Map<string, AdminSession>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

interface AuthenticatedRequest extends Request {
  admin?: {
    id: string;
    email: string;
    name: string;
    restaurantId?: string;
    activeBusinessId?: string;
  };
}

async function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.substring(7);
  const session = adminSessions.get(token);

  if (!session) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  if (new Date() > session.expiresAt) {
    adminSessions.delete(token);
    res.status(401).json({ error: "Token expired" });
    return;
  }

  const admin = await prisma.admin.findUnique({
    where: { id: session.adminId },
    include: { restaurant: true },
  });

  if (!admin) {
    adminSessions.delete(token);
    res.status(401).json({ error: "Admin not found" });
    return;
  }

  req.admin = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    restaurantId: admin.restaurant?.id,
    activeBusinessId: admin.activeBusinessId || undefined,
  };

  next();
}

app.post("/api/admin/register", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: "email, password, and name are required" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = await prisma.admin.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);

    const admin = await prisma.admin.create({
      data: { email, passwordHash, salt, name },
    });

    const token = generateToken();
    adminSessions.set(token, {
      adminId: admin.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    res.status(201).json({
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (error) {
    console.error("Error registering admin:", error);
    res.status(500).json({ error: "Failed to register admin" });
  }
});

app.post("/api/admin/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const admin = await prisma.admin.findUnique({
      where: { email },
      include: { restaurant: true },
    });

    if (!admin) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const hash = hashPassword(password, admin.salt);
    if (hash !== admin.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = generateToken();
    adminSessions.set(token, {
      adminId: admin.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    res.json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        restaurantId: admin.restaurant?.id,
      },
    });
  } catch (error) {
    console.error("Error logging in admin:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

app.post("/api/admin/logout", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    adminSessions.delete(token);
  }
  res.json({ success: true });
});

app.get("/api/admin/me", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin!.id },
      include: { restaurant: true },
    });

    if (!admin) {
      res.status(404).json({ error: "Admin not found" });
      return;
    }

    res.json({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      restaurantId: admin.restaurant?.id || null,
      activeBusinessId: admin.activeBusinessId || null,
      restaurant: admin.restaurant ? {
        id: admin.restaurant.id,
        name: admin.restaurant.name,
        phone: admin.restaurant.phone,
        address: admin.restaurant.address,
        description: admin.restaurant.description,
        logoUrl: admin.restaurant.logoUrl,
        colors: admin.restaurant.colors,
        settings: admin.restaurant.settings,
      } : null,
      createdAt: admin.createdAt,
    });
  } catch (error) {
    console.error("Error fetching admin:", error);
    res.status(500).json({ error: "Failed to fetch admin info" });
  }
});

app.post("/api/admin/businesses", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, name, phone, address, description, logoUrl, colors, settings } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const validTypes = ["RESTAURANT", "RETAIL", "CLINIC", "SALON", "GOV", "OTHER"];
    if (!type || !validTypes.includes(type)) {
      res.status(400).json({ error: "type is required. Must be one of: " + validTypes.join(", ") });
      return;
    }

    const business = await prisma.business.create({
      data: {
        ownerAdminId: req.admin!.id,
        type,
        name,
        phone: phone || null,
        address: address || null,
        description: description || null,
        logoUrl: logoUrl || null,
        colors: colors || {},
        settings: settings || {},
      },
    });

    res.status(201).json(business);
  } catch (error) {
    console.error("Error creating business:", error);
    res.status(500).json({ error: "Failed to create business" });
  }
});

app.get("/api/admin/businesses", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const businesses = await prisma.business.findMany({
      where: { ownerAdminId: req.admin!.id },
      orderBy: { createdAt: "desc" },
    });

    res.json(businesses);
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

app.get("/api/admin/businesses/:id", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
      include: {
        catalogCategories: {
          orderBy: { position: "asc" },
          include: { catalogItems: { orderBy: { position: "asc" } } },
        },
        catalogItems: { orderBy: { position: "asc" } },
      },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    res.json(business);
  } catch (error) {
    console.error("Error fetching business:", error);
    res.status(500).json({ error: "Failed to fetch business" });
  }
});

app.patch("/api/admin/businesses/:id", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { type, name, phone, address, description, logoUrl, colors, settings } = req.body;

    const validTypes = ["RESTAURANT", "RETAIL", "CLINIC", "SALON", "GOV", "OTHER"];
    if (type && !validTypes.includes(type)) {
      res.status(400).json({ error: "Invalid type. Must be one of: " + validTypes.join(", ") });
      return;
    }

    const result = await prisma.business.updateMany({
      where: { id, ownerAdminId: req.admin!.id },
      data: {
        ...(type !== undefined && { type }),
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(description !== undefined && { description }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(colors !== undefined && { colors }),
        ...(settings !== undefined && { settings }),
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const business = await prisma.business.findUnique({ where: { id } });
    res.json(business);
  } catch (error) {
    console.error("Error updating business:", error);
    res.status(500).json({ error: "Failed to update business" });
  }
});

app.post("/api/admin/businesses/:id/select", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    await prisma.admin.update({
      where: { id: req.admin!.id },
      data: { activeBusinessId: id },
    });

    res.json({ activeBusinessId: id });
  } catch (error) {
    console.error("Error selecting business:", error);
    res.status(500).json({ error: "Failed to select business" });
  }
});

app.get("/api/admin/businesses/:id/catalog/categories", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const categories = await prisma.catalogCategory.findMany({
      where: { businessId: id },
      orderBy: { position: "asc" },
      include: { catalogItems: { orderBy: { position: "asc" } } },
    });

    res.json(categories);
  } catch (error) {
    console.error("Error fetching catalog categories:", error);
    res.status(500).json({ error: "Failed to fetch catalog categories" });
  }
});

app.post("/api/admin/businesses/:id/catalog/categories", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, position, isActive } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const category = await prisma.catalogCategory.create({
      data: {
        businessId: id,
        name,
        description: description || null,
        position: position || 0,
        isActive: isActive !== false,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    console.error("Error creating catalog category:", error);
    res.status(500).json({ error: "Failed to create catalog category" });
  }
});

app.patch("/api/admin/businesses/:id/catalog/categories/:categoryId", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, categoryId } = req.params;
    const { name, description, position, isActive } = req.body;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const result = await prisma.catalogCategory.updateMany({
      where: { id: categoryId, businessId: id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(position !== undefined && { position }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    const category = await prisma.catalogCategory.findUnique({ where: { id: categoryId } });
    res.json(category);
  } catch (error) {
    console.error("Error updating catalog category:", error);
    res.status(500).json({ error: "Failed to update catalog category" });
  }
});

app.delete("/api/admin/businesses/:id/catalog/categories/:categoryId", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, categoryId } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const result = await prisma.catalogCategory.deleteMany({
      where: { id: categoryId, businessId: id },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ message: "Category deleted" });
  } catch (error) {
    console.error("Error deleting catalog category:", error);
    res.status(500).json({ error: "Failed to delete catalog category" });
  }
});

app.get("/api/admin/businesses/:id/catalog/items", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const items = await prisma.catalogItem.findMany({
      where: { businessId: id },
      orderBy: { position: "asc" },
      include: { category: true },
    });

    res.json(items);
  } catch (error) {
    console.error("Error fetching catalog items:", error);
    res.status(500).json({ error: "Failed to fetch catalog items" });
  }
});

app.post("/api/admin/businesses/:id/catalog/items", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, price, currency, description, categoryId, imageUrl, isAvailable, position, metadata } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    if (categoryId) {
      const category = await prisma.catalogCategory.findFirst({
        where: { id: categoryId, businessId: id },
      });
      if (!category) {
        res.status(400).json({ error: "Invalid category" });
        return;
      }
    }

    const item = await prisma.catalogItem.create({
      data: {
        businessId: id,
        name,
        price: price !== undefined ? Number(price) : null,
        currency: currency || "KES",
        description: description || null,
        categoryId: categoryId || null,
        imageUrl: imageUrl || null,
        isAvailable: isAvailable !== false,
        position: position || 0,
        metadata: metadata || {},
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error("Error creating catalog item:", error);
    res.status(500).json({ error: "Failed to create catalog item" });
  }
});

app.patch("/api/admin/businesses/:id/catalog/items/:itemId", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, itemId } = req.params;
    const { name, price, currency, description, categoryId, imageUrl, isAvailable, position, metadata } = req.body;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    if (categoryId) {
      const category = await prisma.catalogCategory.findFirst({
        where: { id: categoryId, businessId: id },
      });
      if (!category) {
        res.status(400).json({ error: "Invalid category" });
        return;
      }
    }

    const result = await prisma.catalogItem.updateMany({
      where: { id: itemId, businessId: id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price: price !== null ? Number(price) : null }),
        ...(currency !== undefined && { currency }),
        ...(description !== undefined && { description }),
        ...(categoryId !== undefined && { categoryId }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(position !== undefined && { position }),
        ...(metadata !== undefined && { metadata }),
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    const item = await prisma.catalogItem.findUnique({ where: { id: itemId } });
    res.json(item);
  } catch (error) {
    console.error("Error updating catalog item:", error);
    res.status(500).json({ error: "Failed to update catalog item" });
  }
});

app.delete("/api/admin/businesses/:id/catalog/items/:itemId", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, itemId } = req.params;

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const result = await prisma.catalogItem.deleteMany({
      where: { id: itemId, businessId: id },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    res.json({ message: "Item deleted" });
  } catch (error) {
    console.error("Error deleting catalog item:", error);
    res.status(500).json({ error: "Failed to delete catalog item" });
  }
});

app.post("/api/admin/restaurant", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.admin!.restaurantId) {
      res.status(409).json({ error: "You already have a restaurant" });
      return;
    }

    const { name, phone, address, description, logoUrl, colors, settings } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({
        data: {
          adminId: req.admin!.id,
          name,
          phone: phone || null,
          address: address || null,
          description: description || null,
          logoUrl: logoUrl || null,
          colors: colors || {},
          settings: settings || {},
        },
      });

      const business = await tx.business.create({
        data: {
          ownerAdminId: req.admin!.id,
          type: "RESTAURANT",
          name,
          phone: phone || null,
          address: address || null,
          description: description || null,
          logoUrl: logoUrl || null,
          colors: colors || {},
          settings: settings || {},
          legacyRestaurantId: restaurant.id,
        },
      });

      await tx.admin.update({
        where: { id: req.admin!.id },
        data: { activeBusinessId: business.id },
      });

      return restaurant;
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Error creating restaurant:", error);
    res.status(500).json({ error: "Failed to create restaurant" });
  }
});

app.get("/api/admin/restaurant", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.admin!.restaurantId },
      include: {
        categories: { orderBy: { position: "asc" } },
        menuItems: { orderBy: { position: "asc" } },
      },
    });

    res.json(restaurant);
  } catch (error) {
    console.error("Error fetching restaurant:", error);
    res.status(500).json({ error: "Failed to fetch restaurant" });
  }
});

app.patch("/api/admin/restaurant", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { name, phone, address, description, logoUrl, colors, settings } = req.body;

    const updateData = {
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone }),
      ...(address !== undefined && { address }),
      ...(description !== undefined && { description }),
      ...(logoUrl !== undefined && { logoUrl }),
      ...(colors !== undefined && { colors }),
      ...(settings !== undefined && { settings }),
    };

    const result = await prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.update({
        where: { id: req.admin!.restaurantId },
        data: updateData,
      });

      await tx.business.updateMany({
        where: { legacyRestaurantId: req.admin!.restaurantId },
        data: updateData,
      });

      return restaurant;
    });

    res.json(result);
  } catch (error) {
    console.error("Error updating restaurant:", error);
    res.status(500).json({ error: "Failed to update restaurant" });
  }
});

app.get("/api/admin/menu/categories", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId: req.admin!.restaurantId },
      orderBy: { position: "asc" },
      include: { menuItems: { orderBy: { position: "asc" } } },
    });

    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

app.post("/api/admin/menu/categories", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { name, description, position, isActive } = req.body;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const category = await prisma.menuCategory.create({
      data: {
        restaurantId: req.admin!.restaurantId,
        name,
        description: description || null,
        position: position || 0,
        isActive: isActive !== false,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Failed to create category" });
  }
});

app.patch("/api/admin/menu/categories/:id", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { id } = req.params;
    const { name, description, position, isActive } = req.body;

    const result = await prisma.menuCategory.updateMany({
      where: { id, restaurantId: req.admin!.restaurantId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(position !== undefined && { position }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    const category = await prisma.menuCategory.findUnique({ where: { id } });
    res.json(category);
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({ error: "Failed to update category" });
  }
});

app.delete("/api/admin/menu/categories/:id", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { id } = req.params;

    const result = await prisma.menuCategory.deleteMany({
      where: { id, restaurantId: req.admin!.restaurantId },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

app.get("/api/admin/menu/items", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const items = await prisma.menuItem.findMany({
      where: { restaurantId: req.admin!.restaurantId },
      orderBy: { position: "asc" },
      include: { category: true },
    });

    res.json(items);
  } catch (error) {
    console.error("Error fetching menu items:", error);
    res.status(500).json({ error: "Failed to fetch menu items" });
  }
});

app.post("/api/admin/menu/items", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { name, description, price, currency, categoryId, imageUrl, isAvailable, position } = req.body;

    if (!name || price === undefined) {
      res.status(400).json({ error: "name and price are required" });
      return;
    }

    if (categoryId) {
      const category = await prisma.menuCategory.findFirst({
        where: { id: categoryId, restaurantId: req.admin!.restaurantId },
      });
      if (!category) {
        res.status(400).json({ error: "Invalid category" });
        return;
      }
    }

    const item = await prisma.menuItem.create({
      data: {
        restaurantId: req.admin!.restaurantId,
        name,
        description: description || null,
        price: Number(price),
        currency: currency || "KES",
        categoryId: categoryId || null,
        imageUrl: imageUrl || null,
        isAvailable: isAvailable !== false,
        position: position || 0,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error("Error creating menu item:", error);
    res.status(500).json({ error: "Failed to create menu item" });
  }
});

app.patch("/api/admin/menu/items/:id", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { id } = req.params;
    const { name, description, price, currency, categoryId, imageUrl, isAvailable, position } = req.body;

    if (categoryId) {
      const category = await prisma.menuCategory.findFirst({
        where: { id: categoryId, restaurantId: req.admin!.restaurantId },
      });
      if (!category) {
        res.status(400).json({ error: "Invalid category" });
        return;
      }
    }

    const result = await prisma.menuItem.updateMany({
      where: { id, restaurantId: req.admin!.restaurantId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price: Number(price) }),
        ...(currency !== undefined && { currency }),
        ...(categoryId !== undefined && { categoryId }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(position !== undefined && { position }),
      },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Menu item not found" });
      return;
    }

    const item = await prisma.menuItem.findUnique({ where: { id } });
    res.json(item);
  } catch (error) {
    console.error("Error updating menu item:", error);
    res.status(500).json({ error: "Failed to update menu item" });
  }
});

app.delete("/api/admin/menu/items/:id", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { id } = req.params;

    const result = await prisma.menuItem.deleteMany({
      where: { id, restaurantId: req.admin!.restaurantId },
    });

    if (result.count === 0) {
      res.status(404).json({ error: "Menu item not found" });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting menu item:", error);
    res.status(500).json({ error: "Failed to delete menu item" });
  }
});

app.get("/api/admin/orders", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { status, limit, offset } = req.query;

    const orders = await prisma.order.findMany({
      where: {
        restaurantId: req.admin!.restaurantId,
        ...(status && { status: status as OrderStatus }),
      },
      orderBy: { createdAt: "desc" },
      take: limit ? Number(limit) : 50,
      skip: offset ? Number(offset) : 0,
    });

    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

const orderTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

app.patch("/api/admin/orders/:id/status", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.admin!.restaurantId) {
      res.status(404).json({ error: "No restaurant found" });
      return;
    }

    const { id } = req.params;
    const { status } = req.body;

    const validStatuses: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status. Must be one of: " + validStatuses.join(", ") });
      return;
    }

    const existingOrder = await prisma.order.findFirst({
      where: { id, restaurantId: req.admin!.restaurantId },
    });

    if (!existingOrder) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const allowedNext = orderTransitions[existingOrder.status];
    if (!allowedNext.includes(status as OrderStatus)) {
      res.status(400).json({ 
        error: `Cannot transition from ${existingOrder.status} to ${status}. Allowed: ${allowedNext.join(", ") || "none"}` 
      });
      return;
    }

    const order = await prisma.order.update({
      where: { id },
      data: { status },
    });

    res.json(order);
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`sema-api listening on port ${port}`);
});
