import express, { Request, Response } from "express";
import cors from "cors";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const app = express();
const port = Number(process.env.PORT || 3000);

console.log(`DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

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
      });

      if (!connection) {
        console.log(`No connection found for phone_number_id: ${phoneNumberId}`);
        return;
      }

      console.log(`Connection found for ${phoneNumberId}, sending auto-reply to ${from}`);

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
            text: { body: "Sema ✅ I received: " + text },
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

app.listen(port, "0.0.0.0", () => {
  console.log(`sema-api listening on port ${port}`);
});
