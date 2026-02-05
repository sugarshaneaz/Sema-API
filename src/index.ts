import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { createHash, randomBytes } from "crypto";
import { OrderStatus, TranslationStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadBusinessContext, checkSafetyTriggers, generateAIResponse, type ConversationMessage } from "./promptBuilder";
import {
  detectLanguage,
  translate,
  translateMessage,
  isQuotaError,
  getSupportedUILanguages,
  getSupportedTranslationLanguages,
  isValidUILanguage,
  isValidTranslationLanguage,
} from "./services/i18n";
import multer from "multer";
import { processFile, isValidFileType } from "./services/fileProcessor";
import { ObjectStorageService } from "./integrations/object_storage";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import { scrapeWebsite } from "./services/webScraper";
import { scrapeWebsite as scrapeWithCheerio, scrapeWithBrowser } from "./services/browserScraper";
import { createSelcomCheckout, checkSelcomStatus, getBusinessPaymentMethods, SelcomConfig } from "./services/selcom";

const app = express();
const port = Number(process.env.PORT || 3000);

console.log(`DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
console.log(`Web scraping: Using cheerio (fast HTML parsing)`);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

function maskToken(token: string | null | undefined): string {
  if (!token) return "***masked***";
  const last4 = token.slice(-4);
  return `***masked***${last4}`;
}

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

// Browser-based scraper endpoints (handles JS-rendered sites)
app.get("/api/scrape-website/ping", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/api/scrape-website", async (req: Request, res: Response) => {
  try {
    const { url, render } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ ok: false, error: "Missing or invalid 'url' in request body" });
      return;
    }

    // Use cheerio-based scraping (render param kept for API compatibility but ignored)
    const result = await scrapeWithCheerio(url);

    if (!result.ok) {
      const statusCode = result.isServerError ? 500 : 400;
      res.status(statusCode).json(result);
      return;
    }

    res.json(result);
  } catch (error: any) {
    console.error("Browser scrape endpoint error:", error.message);
    res.status(500).json({ ok: false, error: error.message, isServerError: true });
  }
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
      accessToken: maskToken(connection.accessToken),
      displayPhoneNumber: connection.displayPhoneNumber,
      enabled: connection.enabled,
      mode: connection.mode,
      pausedUntil: connection.pausedUntil,
      lastInboundAt: connection.lastInboundAt,
      lastOutboundAt: connection.lastOutboundAt,
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
      accessToken: maskToken(conn.accessToken),
      displayPhoneNumber: conn.displayPhoneNumber,
      enabled: conn.enabled,
      mode: conn.mode,
      pausedUntil: conn.pausedUntil,
      lastInboundAt: conn.lastInboundAt,
      lastOutboundAt: conn.lastOutboundAt,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    }));

    res.json(maskedConnections);
  } catch (error) {
    console.error("Error fetching connections:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to fetch connections", code: "CONNECTIONS_FETCH_FAILED" });
  }
});

app.get("/api/whatsapp/connections/:phoneNumberId", async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const connection = await prisma.whatsappConnection.findUnique({
      where: { phoneNumberId },
    });

    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    res.json({
      id: connection.id,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
      accessToken: maskToken(connection.accessToken),
      displayPhoneNumber: connection.displayPhoneNumber,
      enabled: connection.enabled,
      mode: connection.mode,
      pausedUntil: connection.pausedUntil,
      lastInboundAt: connection.lastInboundAt,
      lastOutboundAt: connection.lastOutboundAt,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching connection:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to fetch connection" });
  }
});

app.patch("/api/whatsapp/connections/:phoneNumberId", async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const { enabled, mode, pausedUntil } = req.body;

    const connection = await prisma.whatsappConnection.findUnique({
      where: { phoneNumberId },
    });

    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const validModes = ["OFF", "REVIEW", "AUTO"];
    if (mode !== undefined && !validModes.includes(mode)) {
      res.status(400).json({ error: "Invalid mode. Must be OFF, REVIEW, or AUTO" });
      return;
    }

    let updateData: any = {};

    if (enabled !== undefined) {
      updateData.enabled = enabled;
      if (enabled === false && mode === undefined) {
        updateData.mode = "OFF";
      }
      if (enabled === true && mode === undefined && connection.mode === "OFF") {
        updateData.mode = "REVIEW";
      }
    }

    if (mode !== undefined) {
      updateData.mode = mode;
    }

    if (pausedUntil !== undefined) {
      updateData.pausedUntil = pausedUntil ? new Date(pausedUntil) : null;
    }

    const updated = await prisma.whatsappConnection.update({
      where: { phoneNumberId },
      data: updateData,
    });

    res.json({
      id: updated.id,
      wabaId: updated.wabaId,
      phoneNumberId: updated.phoneNumberId,
      accessToken: maskToken(updated.accessToken),
      displayPhoneNumber: updated.displayPhoneNumber,
      enabled: updated.enabled,
      mode: updated.mode,
      pausedUntil: updated.pausedUntil,
      lastInboundAt: updated.lastInboundAt,
      lastOutboundAt: updated.lastOutboundAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error("Error updating connection:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to update connection" });
  }
});

app.get("/api/whatsapp/status/:phoneNumberId", async (req: Request, res: Response) => {
  try {
    const { phoneNumberId } = req.params;
    const connection = await prisma.whatsappConnection.findUnique({
      where: { phoneNumberId },
    });

    if (!connection) {
      res.json({
        exists: false,
        enabled: null,
        mode: null,
        pausedUntil: null,
        lastInboundAt: null,
        lastOutboundAt: null,
      });
      return;
    }

    res.json({
      exists: true,
      enabled: connection.enabled,
      mode: connection.mode,
      pausedUntil: connection.pausedUntil,
      lastInboundAt: connection.lastInboundAt,
      lastOutboundAt: connection.lastOutboundAt,
    });
  } catch (error) {
    console.error("Error fetching status:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

app.get("/api/whatsapp/messages", async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, limit, cursor } = req.query;

    if (!phoneNumberId || typeof phoneNumberId !== "string") {
      res.status(400).json({ error: "phoneNumberId is required" });
      return;
    }

    const take = Math.min(parseInt(limit as string) || 50, 100);

    let where: any = { phoneNumberId };
    if (cursor && typeof cursor === "string") {
      where.createdAt = { lt: new Date(cursor) };
    }

    const messages = await prisma.whatsappMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
    });

    const nextCursor = messages.length === take ? messages[messages.length - 1].createdAt.toISOString() : null;

    res.json({
      messages,
      nextCursor,
    });
  } catch (error) {
    console.error("Error fetching messages:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.get("/api/whatsapp/drafts", async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, status } = req.query;

    if (!phoneNumberId || typeof phoneNumberId !== "string") {
      res.status(400).json({ error: "phoneNumberId is required" });
      return;
    }

    let where: any = { phoneNumberId };
    if (status && typeof status === "string") {
      where.status = status;
    }

    const drafts = await prisma.whatsappDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    res.json(drafts);
  } catch (error) {
    console.error("Error fetching drafts:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to fetch drafts" });
  }
});

app.post("/api/whatsapp/drafts", async (req: Request, res: Response) => {
  try {
    const { phoneNumberId, toNumber, text, inboundMsgId, createdBy } = req.body;

    if (!phoneNumberId || !toNumber || !text) {
      res.status(400).json({ error: "phoneNumberId, toNumber, and text are required" });
      return;
    }

    const draft = await prisma.whatsappDraft.create({
      data: {
        phoneNumberId,
        toNumber,
        text,
        inboundMsgId: inboundMsgId || null,
        createdBy: createdBy || null,
        status: "PENDING",
      },
    });

    res.status(201).json(draft);
  } catch (error) {
    console.error("Error creating draft:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to create draft" });
  }
});

app.post("/api/whatsapp/drafts/:id/send", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const draft = await prisma.whatsappDraft.findUnique({
      where: { id },
    });

    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }

    if (draft.status !== "PENDING") {
      res.status(400).json({ error: `Cannot send draft with status ${draft.status}` });
      return;
    }

    const connection = await prisma.whatsappConnection.findUnique({
      where: { phoneNumberId: draft.phoneNumberId },
    });

    if (!connection) {
      res.status(404).json({ error: "Connection not found for this draft" });
      return;
    }

    const graphResponse = await fetch(
      `https://graph.facebook.com/v20.0/${draft.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: draft.toNumber,
          type: "text",
          text: { body: draft.text },
        }),
      }
    );

    const graphBody = await graphResponse.json();

    if (!graphResponse.ok) {
      console.error("Graph API error sending draft:", { status: graphResponse.status, body: graphBody });
      await prisma.whatsappDraft.update({
        where: { id },
        data: { status: "FAILED" },
      });
      res.status(500).json({ error: "Failed to send message via WhatsApp" });
      return;
    }

    await prisma.whatsappDraft.update({
      where: { id },
      data: { status: "SENT" },
    });

    const outboundMessage = await prisma.whatsappMessage.create({
      data: {
        phoneNumberId: draft.phoneNumberId,
        direction: "OUT",
        toNumber: draft.toNumber,
        waMessageId: graphBody?.messages?.[0]?.id || null,
        text: draft.text,
        status: "SENT",
      },
    });

    await prisma.whatsappConnection.update({
      where: { phoneNumberId: draft.phoneNumberId },
      data: { lastOutboundAt: new Date() },
    });

    res.json({
      success: true,
      draft: { ...draft, status: "SENT" },
      message: outboundMessage,
    });
  } catch (error) {
    console.error("Error sending draft:", error instanceof Error ? error.stack : error);
    res.status(500).json({ error: "Failed to send draft" });
  }
});

// ============================================
// Webhook Black Box - logs ALL webhook events
// ============================================

// Helper function to log webhook event to database
async function logWebhookEvent(
  method: string,
  headers: Record<string, any>,
  query: Record<string, any>,
  body: any,
  rawBody: string | null,
  note: string | null
) {
  try {
    await prisma.whatsappWebhookEvent.create({
      data: {
        method,
        headersJson: headers,
        queryJson: query,
        bodyJson: body || null,
        rawBody,
        note,
      },
    });
    console.log(`[Webhook Event] Logged ${method} request`);
  } catch (err) {
    console.error("[Webhook Event] Failed to log event:", err);
  }
}

// GET /api/whatsapp/webhook - Verification endpoint (alternative to /webhooks/whatsapp)
app.get("/api/whatsapp/webhook", async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  // Log the verification attempt first
  await logWebhookEvent(
    "GET",
    req.headers as Record<string, any>,
    req.query as Record<string, any>,
    null,
    null,
    mode === "subscribe" && token === verifyToken ? "VERIFY_SUCCESS" : "VERIFY_FAILED"
  );

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[Webhook] Verification SUCCESS via /api/whatsapp/webhook");
    res.status(200).send(challenge);
  } else {
    console.log("[Webhook] Verification FAILED via /api/whatsapp/webhook");
    res.status(400).json({ error: "Verification failed" });
  }
});

// POST /api/whatsapp/webhook - Event receiver (logs first, then returns 200 immediately)
app.post("/api/whatsapp/webhook", async (req: Request, res: Response) => {
  // Log event FIRST before any processing
  await logWebhookEvent(
    "POST",
    req.headers as Record<string, any>,
    req.query as Record<string, any>,
    req.body,
    JSON.stringify(req.body),
    "EVENT_RECEIVED"
  );

  // Return 200 immediately (Meta expects quick response)
  res.sendStatus(200);

  // Process the webhook asynchronously (same as existing /webhooks/whatsapp logic)
  (async () => {
    try {
      const body = req.body;
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const msg = value?.messages?.[0];
      const waMessageId = msg?.id;
      const from = msg?.from;
      const text = msg?.text?.body || "(no text)";

      console.log("[Webhook] Processing event", { phone_number_id: phoneNumberId || null, from: from || null });

      if (!phoneNumberId || !from) {
        console.log("[Webhook] Missing phoneNumberId or from, skipping processing");
        return;
      }

      await prisma.whatsappMessage.create({
        data: {
          phoneNumberId,
          direction: "IN",
          fromNumber: from,
          waMessageId: waMessageId || null,
          text,
          rawPayload: body,
          status: "RECEIVED",
        },
      });

      console.log("[Webhook] Message stored successfully");
    } catch (err) {
      console.error("[Webhook] Error processing event:", err);
    }
  })();
});

// GET /api/debug/whatsapp/webhook-events - View recent webhook events (protected by DEBUG_KEY)
app.get("/api/debug/whatsapp/webhook-events", async (req: Request, res: Response) => {
  const debugKey = req.query.key || req.headers["x-debug-key"];
  const expectedKey = process.env.DEBUG_KEY;

  if (!expectedKey || debugKey !== expectedKey) {
    res.status(401).json({ error: "Invalid or missing DEBUG_KEY" });
    return;
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await prisma.whatsappWebhookEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json({
      count: events.length,
      events: events.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        method: e.method,
        note: e.note,
        query: e.queryJson,
        body: e.bodyJson,
        headers: e.headersJson,
      })),
    });
  } catch (err) {
    console.error("[Debug] Error fetching webhook events:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.get("/webhooks/whatsapp", async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

  // Log verification attempt to webhook events table
  await logWebhookEvent(
    "GET",
    req.headers as Record<string, any>,
    req.query as Record<string, any>,
    null,
    null,
    mode === "subscribe" && token === verifyToken ? "VERIFY_SUCCESS" : "VERIFY_FAILED"
  );

  if (mode === "subscribe" && token === verifyToken) {
    console.log("WhatsApp webhook verified");
    res.status(200).send(challenge);
  } else {
    console.log("WhatsApp webhook verification failed");
    res.sendStatus(403);
  }
});

app.post("/webhooks/whatsapp", async (req: Request, res: Response) => {
  const body = req.body;
  
  // Log event FIRST before any processing
  await logWebhookEvent(
    "POST",
    req.headers as Record<string, any>,
    req.query as Record<string, any>,
    body,
    JSON.stringify(body),
    "EVENT_RECEIVED"
  );

  res.sendStatus(200);

  (async () => {
    try {
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const msg = value?.messages?.[0];
      const waMessageId = msg?.id;
      const from = msg?.from;
      const text = msg?.text?.body || "(no text)";

      console.log("incoming webhook", { phone_number_id: phoneNumberId || null, from: from || null });

      if (!phoneNumberId || !from) {
        console.log("Missing phoneNumberId or from, skipping processing");
        return;
      }

      await prisma.whatsappMessage.create({
        data: {
          phoneNumberId,
          direction: "IN",
          fromNumber: from,
          waMessageId: waMessageId || null,
          text,
          rawPayload: body,
          status: "RECEIVED",
        },
      });

      const connection = await prisma.whatsappConnection.findUnique({
        where: { phoneNumberId },
        include: { businessProfile: true },
      });

      if (!connection) {
        console.log(`No connection found for phone_number_id: ${phoneNumberId}`);
        return;
      }

      await prisma.whatsappConnection.update({
        where: { phoneNumberId },
        data: { lastInboundAt: new Date() },
      });

      const now = new Date();
      const isPaused = connection.pausedUntil && connection.pausedUntil > now;
      const isDisabled = !connection.enabled || connection.mode === "OFF" || isPaused;

      if (isDisabled) {
        console.log(`Connection disabled for ${phoneNumberId} (enabled=${connection.enabled}, mode=${connection.mode}, paused=${isPaused}), ignoring auto-reply`);
        return;
      }

      if (connection.mode === "REVIEW") {
        console.log(`Connection in REVIEW mode for ${phoneNumberId}, no auto-reply`);
        return;
      }

      if (connection.mode === "AUTO") {
        console.log(`Connection in AUTO mode for ${phoneNumberId}, processing message from ${from}`);

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
          replyText = "Thanks! We received your message. A team member will reply shortly.";
          console.log("No business profile configured, using auto-reply fallback");
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
          `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${connection.accessToken}`,
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

        const graphBody = await graphResponse.json();
        console.log("Graph API response:", { status: graphResponse.status });

        if (graphResponse.ok) {
          await prisma.whatsappMessage.create({
            data: {
              phoneNumberId,
              direction: "OUT",
              toNumber: from,
              waMessageId: graphBody?.messages?.[0]?.id || null,
              text: replyText,
              status: "SENT",
            },
          });

          await prisma.whatsappConnection.update({
            where: { phoneNumberId },
            data: { lastOutboundAt: new Date() },
          });
        }
      }

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max
  },
});

const objectStorageService = new ObjectStorageService();

app.post("/api/admin/businesses/:id/upload-knowledge", requireAdminAuth as any, upload.single("file"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const fileType = req.body.type as "pdf" | "image";

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    if (!fileType || !["pdf", "image"].includes(fileType)) {
      res.status(400).json({ error: "type must be 'pdf' or 'image'" });
      return;
    }

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const mimeType = req.file.mimetype;
    if (!isValidFileType(mimeType, fileType)) {
      const allowedTypes = fileType === "image" 
        ? "JPEG, PNG, WEBP" 
        : "PDF";
      res.status(400).json({ error: `Invalid file type. Allowed: ${allowedTypes}` });
      return;
    }

    const processed = await processFile(req.file.buffer, mimeType, fileType);

    const uploadUrl = await objectStorageService.getObjectEntityUploadURL();

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: new Uint8Array(processed.buffer),
      headers: {
        "Content-Type": processed.contentType,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload to object storage");
    }

    const normalizedPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadUrl, {
      owner: req.admin!.id,
      visibility: "private",
    });

    if (processed.extractedText) {
      const existingKnowledge = (business.settings as any)?.knowledgeBase || "";
      const updatedKnowledge = existingKnowledge 
        ? `${existingKnowledge}\n\n---\n\n${processed.extractedText}`
        : processed.extractedText;

      await prisma.business.update({
        where: { id },
        data: {
          settings: {
            ...(business.settings as object || {}),
            knowledgeBase: updatedKnowledge,
          },
        },
      });
    }

    res.json({
      success: true,
      file: {
        url: normalizedPath,
        originalSize: processed.originalSize,
        compressedSize: processed.compressedSize,
        extractedText: processed.extractedText,
      },
    });
  } catch (error: any) {
    console.error("Error processing upload:", error);
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File too large. Maximum size is 20MB." });
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to process upload";
    res.status(500).json({ error: message });
  }
});

const scraperOpenAI = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const scrapeRateLimits = new Map<string, { count: number; resetAt: number }>();

app.post("/api/admin/scrape-website", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminId = req.admin!.id;
    const now = Date.now();
    const rateLimit = scrapeRateLimits.get(adminId);
    
    if (rateLimit && now < rateLimit.resetAt) {
      if (rateLimit.count >= 5) {
        res.status(429).json({ success: false, error: "Rate limit exceeded. Max 5 requests per minute." });
        return;
      }
      rateLimit.count++;
    } else {
      scrapeRateLimits.set(adminId, { count: 1, resetAt: now + 60000 });
    }

    const { url } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ success: false, error: "url is required" });
      return;
    }

    // Use browser-based scraper for JS-rendered sites
    const scrapeResult = await scrapeWithBrowser(url);

    if (!scrapeResult.ok) {
      res.status(400).json({ 
        success: false, 
        error: scrapeResult.error || "Failed to scrape website" 
      });
      return;
    }

    const aiPrompt = `Analyze the following website content and extract relevant business information. Format it clearly with sections like:
- Products/Services with prices (if found)
- Business hours
- Location/Address
- Contact information
- Delivery/shipping policies
- FAQs or important policies
- About the business

Only include sections where you found relevant information. Be concise but complete.

Website content:
${scrapeResult.text}`;

    const aiResponse = await scraperOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that extracts and formats business information from website content." },
        { role: "user", content: aiPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.3,
    });

    const summarizedContent = aiResponse.choices[0]?.message?.content || scrapeResult.text;

    res.json({
      success: true,
      content: summarizedContent,
      title: scrapeResult.title || "",
      url: scrapeResult.url,
    });
  } catch (error) {
    console.error("Error scraping website:", error);
    const message = error instanceof Error ? error.message : "Failed to scrape website";
    res.status(500).json({ success: false, error: message });
  }
});

app.post("/api/admin/businesses/:id/scrape-website", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { url } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ success: false, error: "url is required" });
      return;
    }

    const business = await prisma.business.findFirst({
      where: { id, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ success: false, error: "Business not found" });
      return;
    }

    // Use browser-based scraper for JS-rendered sites
    const scrapeResult = await scrapeWithBrowser(url);

    if (!scrapeResult.ok) {
      res.status(400).json({ 
        success: false, 
        error: scrapeResult.error || "Failed to scrape website" 
      });
      return;
    }

    const aiPrompt = `You are extracting business information from a scraped website. 
The business type is: ${business.type}
The business name is: ${business.name}

Analyze the following website content and extract relevant business information. Format it clearly with sections like:
- Products/Services with prices (if found)
- Business hours
- Location/Address
- Contact information
- Delivery/shipping policies
- FAQs or important policies
- About the business

Only include sections where you found relevant information. Be concise but complete.

Website content:
${scrapeResult.text}`;

    const aiResponse = await scraperOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that extracts and formats business information from website content." },
        { role: "user", content: aiPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.3,
    });

    const summarizedContent = aiResponse.choices[0]?.message?.content || scrapeResult.text;

    const existingKnowledge = (business.settings as any)?.knowledgeBase || "";
    const updatedKnowledge = existingKnowledge
      ? `${existingKnowledge}\n\n---\n\n[Scraped from ${scrapeResult.url}]\n${summarizedContent}`
      : `[Scraped from ${scrapeResult.url}]\n${summarizedContent}`;

    await prisma.business.update({
      where: { id },
      data: {
        settings: {
          ...(business.settings as object || {}),
          knowledgeBase: updatedKnowledge,
        },
      },
    });

    res.json({
      success: true,
      content: summarizedContent,
      title: scrapeResult.title || "",
      url: scrapeResult.url,
    });
  } catch (error) {
    console.error("Error scraping website:", error);
    const message = error instanceof Error ? error.message : "Failed to scrape website";
    res.status(500).json({ success: false, error: message });
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

const MAX_I18N_TEXT_LENGTH = 5000;

app.post("/v1/i18n/detect", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (text.length > MAX_I18N_TEXT_LENGTH) {
      res.status(413).json({ error: `Text exceeds maximum length of ${MAX_I18N_TEXT_LENGTH} characters` });
      return;
    }

    const result = await detectLanguage(text, prisma);
    res.json(result);
  } catch (error) {
    console.error("Language detection error:", error instanceof Error ? error.message : "Unknown");
    res.status(500).json({ error: "Language detection failed" });
  }
});

app.post("/v1/i18n/translate", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { text, to, from, mode } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (!to || typeof to !== "string") {
      res.status(400).json({ error: "to is required" });
      return;
    }

    if (text.length > MAX_I18N_TEXT_LENGTH) {
      res.status(413).json({ error: `Text exceeds maximum length of ${MAX_I18N_TEXT_LENGTH} characters` });
      return;
    }

    if (!isValidTranslationLanguage(to)) {
      res.status(400).json({ 
        error: `Unsupported target language: ${to}. Supported: ${getSupportedTranslationLanguages().join(", ")}` 
      });
      return;
    }

    const businessId = req.admin!.activeBusinessId;
    if (!businessId) {
      res.status(400).json({ error: "No active business. Create or select a business first." });
      return;
    }

    const result = await translate(text, to, prisma, businessId, {
      from: from || undefined,
      mode: mode === "rich" ? "rich" : "plain",
    });

    if (isQuotaError(result)) {
      res.status(429).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    console.error("Translation error:", error instanceof Error ? error.message : "Unknown");
    res.status(500).json({ error: "Translation failed" });
  }
});

app.get("/v1/i18n/languages", (_req: Request, res: Response) => {
  res.json({
    uiLanguages: getSupportedUILanguages(),
    translationLanguages: getSupportedTranslationLanguages(),
  });
});

app.get("/v1/business/:id/language-settings", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findFirst({
      where: {
        id,
        ownerAdminId: req.admin!.id,
      },
      select: {
        id: true,
        uiLanguage: true,
        incomingTranslateTo: true,
        outgoingTranslateTo: true,
        autoTranslateIncoming: true,
        autoTranslateOutgoing: true,
        plan: true,
      },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    res.json(business);
  } catch (error) {
    console.error("Error getting language settings:", error);
    res.status(500).json({ error: "Failed to get language settings" });
  }
});

app.put("/v1/business/:id/language-settings", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      uiLanguage,
      incomingTranslateTo,
      outgoingTranslateTo,
      autoTranslateIncoming,
      autoTranslateOutgoing,
    } = req.body;

    const existing = await prisma.business.findFirst({
      where: {
        id,
        ownerAdminId: req.admin!.id,
      },
    });

    if (!existing) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const updateData: any = {};

    if (uiLanguage !== undefined) {
      if (!isValidUILanguage(uiLanguage)) {
        res.status(400).json({ 
          error: `Invalid uiLanguage. Supported: ${getSupportedUILanguages().join(", ")}` 
        });
        return;
      }
      updateData.uiLanguage = uiLanguage;
    }

    if (incomingTranslateTo !== undefined) {
      if (!isValidTranslationLanguage(incomingTranslateTo)) {
        res.status(400).json({ 
          error: `Invalid incomingTranslateTo. Supported: ${getSupportedTranslationLanguages().join(", ")}` 
        });
        return;
      }
      updateData.incomingTranslateTo = incomingTranslateTo;
    }

    if (outgoingTranslateTo !== undefined) {
      if (!isValidTranslationLanguage(outgoingTranslateTo)) {
        res.status(400).json({ 
          error: `Invalid outgoingTranslateTo. Supported: ${getSupportedTranslationLanguages().join(", ")}` 
        });
        return;
      }
      updateData.outgoingTranslateTo = outgoingTranslateTo;
    }

    if (typeof autoTranslateIncoming === "boolean") {
      updateData.autoTranslateIncoming = autoTranslateIncoming;
    }

    if (typeof autoTranslateOutgoing === "boolean") {
      updateData.autoTranslateOutgoing = autoTranslateOutgoing;
    }

    const updated = await prisma.business.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        uiLanguage: true,
        incomingTranslateTo: true,
        outgoingTranslateTo: true,
        autoTranslateIncoming: true,
        autoTranslateOutgoing: true,
        plan: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating language settings:", error);
    res.status(500).json({ error: "Failed to update language settings" });
  }
});

app.post("/v1/business/:id/messages", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: businessId } = req.params;
    const {
      text,
      direction = "inbound",
      senderPhone,
      recipientPhone,
      conversationId,
      metadata,
    } = req.body;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (text.length > MAX_I18N_TEXT_LENGTH) {
      res.status(413).json({ error: `Text exceeds maximum length of ${MAX_I18N_TEXT_LENGTH} characters` });
      return;
    }

    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerAdminId: req.admin!.id,
      },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const translationResult = await translateMessage(
      text,
      businessId,
      prisma,
      direction === "outgoing" ? "outgoing" : "incoming"
    );

    const message = await prisma.message.create({
      data: {
        businessId,
        conversationId: conversationId || null,
        direction,
        senderPhone: senderPhone || null,
        recipientPhone: recipientPhone || null,
        textOriginal: translationResult.textOriginal,
        langOriginal: translationResult.langOriginal,
        textTranslated: translationResult.textTranslated,
        langTranslated: translationResult.langTranslated,
        translationStatus: translationResult.translationStatus as TranslationStatus,
        translationError: translationResult.translationError,
        metadata: metadata || {},
      },
    });

    res.status(201).json(message);
  } catch (error) {
    console.error("Error creating message:", error);
    res.status(500).json({ error: "Failed to create message" });
  }
});

app.get("/v1/business/:id/messages", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: businessId } = req.params;
    const { conversationId, limit = "50", offset = "0" } = req.query;

    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerAdminId: req.admin!.id,
      },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const where: any = { businessId };
    if (conversationId) {
      where.conversationId = conversationId;
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(parseInt(limit as string, 10), 100),
      skip: parseInt(offset as string, 10),
    });

    res.json(messages);
  } catch (error) {
    console.error("Error listing messages:", error);
    res.status(500).json({ error: "Failed to list messages" });
  }
});

app.get("/v1/business/:id/translation-usage", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id: businessId } = req.params;

    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerAdminId: req.admin!.id,
      },
      select: { id: true, plan: true },
    });

    if (!business) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const today = new Date();
    const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const usage = await prisma.translationUsageDaily.findUnique({
      where: {
        businessId_day: { businessId, day: utcToday },
      },
    });

    const plan = business.plan || "free";
    const limit = plan === "pro" 
      ? parseInt(process.env.TRANSLATION_PRO_DAILY_LIMIT || "5000", 10)
      : parseInt(process.env.TRANSLATION_FREE_DAILY_LIMIT || "200", 10);

    res.json({
      businessId,
      plan,
      today: utcToday.toISOString().split("T")[0],
      used: usage?.count || 0,
      limit,
      remaining: Math.max(0, limit - (usage?.count || 0)),
    });
  } catch (error) {
    console.error("Error getting translation usage:", error);
    res.status(500).json({ error: "Failed to get translation usage" });
  }
});

// Selcom Payment Endpoints
app.post("/api/payments/selcom/checkout", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { businessId, orderId, amount, currency, buyerEmail, buyerPhone, buyerName, redirectUrl, cancelUrl, webhook } = req.body;

    if (!businessId || !orderId || !amount) {
      res.status(400).json({ success: false, error: "businessId, orderId, and amount are required" });
      return;
    }

    // Get business to read payment settings
    const business = await prisma.business.findFirst({
      where: { id: businessId, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ success: false, error: "Business not found" });
      return;
    }

    // Check for Selcom credentials in business settings or environment
    const settings = business.settings as any || {};
    const selcomConfig: SelcomConfig = {
      apiKey: settings.selcom?.apiKey || process.env.SELCOM_API_KEY || '',
      apiSecret: settings.selcom?.apiSecret || process.env.SELCOM_API_SECRET || '',
      vendorId: settings.selcom?.vendorId || process.env.SELCOM_VENDOR_ID || '',
      baseUrl: settings.selcom?.baseUrl || process.env.SELCOM_BASE_URL || 'https://apigw.selcommobile.com',
    };

    if (!selcomConfig.apiKey || !selcomConfig.apiSecret || !selcomConfig.vendorId) {
      res.status(400).json({ 
        success: false, 
        error: "Selcom credentials not configured. Set SELCOM_API_KEY, SELCOM_API_SECRET, and SELCOM_VENDOR_ID." 
      });
      return;
    }

    // Get payment methods from business settings - includes card if configured
    const paymentMethods = getBusinessPaymentMethods(settings);
    
    // Default to mpesa + card if no methods configured
    const methodsToUse = paymentMethods.length > 0 ? paymentMethods : ['mpesa', 'card'];

    const result = await createSelcomCheckout(selcomConfig, {
      orderId,
      amount,
      currency: currency || settings.currency || 'TZS',
      buyerEmail,
      buyerPhone,
      buyerName,
      paymentMethods: methodsToUse as any,
      redirectUrl,
      cancelUrl,
      webhook,
    });

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.json({
      success: true,
      checkoutUrl: result.checkoutUrl,
      transactionId: result.transactionId,
      reference: result.reference,
      paymentMethodsEnabled: methodsToUse,
    });
  } catch (error) {
    console.error("Selcom checkout error:", error);
    res.status(500).json({ success: false, error: "Failed to create payment link" });
  }
});

app.get("/api/payments/selcom/status/:orderId", requireAdminAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const { businessId } = req.query;

    if (!businessId) {
      res.status(400).json({ success: false, error: "businessId query parameter required" });
      return;
    }

    const business = await prisma.business.findFirst({
      where: { id: businessId as string, ownerAdminId: req.admin!.id },
    });

    if (!business) {
      res.status(404).json({ success: false, error: "Business not found" });
      return;
    }

    const settings = business.settings as any || {};
    const selcomConfig: SelcomConfig = {
      apiKey: settings.selcom?.apiKey || process.env.SELCOM_API_KEY || '',
      apiSecret: settings.selcom?.apiSecret || process.env.SELCOM_API_SECRET || '',
      vendorId: settings.selcom?.vendorId || process.env.SELCOM_VENDOR_ID || '',
      baseUrl: settings.selcom?.baseUrl || process.env.SELCOM_BASE_URL || 'https://apigw.selcommobile.com',
    };

    if (!selcomConfig.apiKey) {
      res.status(400).json({ success: false, error: "Selcom credentials not configured" });
      return;
    }

    const result = await checkSelcomStatus(selcomConfig, orderId);
    res.json(result);
  } catch (error) {
    console.error("Selcom status check error:", error);
    res.status(500).json({ success: false, error: "Failed to check payment status" });
  }
});

// ============================================================
// WhatsApp Embedded Signup Flow
// ============================================================

// Generate a signed nonce for embedded signup security
function generateSignupNonce(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("SESSION_SECRET is not configured - signup security compromised");
  }
  const nonce = randomBytes(32).toString('hex');
  const timestamp = Date.now();
  const data = `${nonce}:${timestamp}`;
  const signature = createHash('sha256').update(data + (secret || '')).digest('hex');
  return Buffer.from(`${data}:${signature}`).toString('base64');
}

// Verify a signed nonce
function verifySignupNonce(token: string, maxAgeMs: number = 30 * 60 * 1000): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("SESSION_SECRET is not configured - cannot verify nonce");
    return false;
  }
  
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [nonce, timestampStr, signature] = decoded.split(':');
    const timestamp = parseInt(timestampStr, 10);
    
    // Check expiry
    if (Date.now() - timestamp > maxAgeMs) {
      return false;
    }
    
    // Verify signature
    const data = `${nonce}:${timestamp}`;
    const expectedSig = createHash('sha256').update(data + secret).digest('hex');
    return signature === expectedSig;
  } catch {
    return false;
  }
}

// GET /connect/whatsapp - Server-rendered HTML page for Embedded Signup
app.get("/connect/whatsapp", (req: Request, res: Response) => {
  const metaAppId = process.env.META_APP_ID;
  const metaConfigId = process.env.META_CONFIG_ID;
  
  if (!metaAppId || !metaConfigId) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html><head><title>Configuration Error</title></head>
      <body style="font-family: system-ui; padding: 40px; text-align: center;">
        <h1>Configuration Error</h1>
        <p>META_APP_ID and META_CONFIG_ID environment variables must be set.</p>
      </body></html>
    `);
    return;
  }
  
  const signupNonce = generateSignupNonce();
  const apiBaseUrl = process.env.API_BASE_URL || `https://${req.get('host')}`;
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect WhatsApp - Sema</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
      text-align: center;
    }
    .logo {
      width: 64px;
      height: 64px;
      background: #25D366;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .logo svg { width: 36px; height: 36px; fill: white; }
    h1 { color: #1a1a2e; font-size: 24px; margin-bottom: 12px; }
    p { color: #666; font-size: 15px; line-height: 1.6; margin-bottom: 32px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: #1877F2;
      color: white;
      font-size: 16px;
      font-weight: 600;
      padding: 14px 28px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover { background: #166FE5; transform: translateY(-1px); }
    .btn:disabled { background: #ccc; cursor: not-allowed; transform: none; }
    .btn svg { width: 20px; height: 20px; fill: currentColor; }
    .status { margin-top: 24px; padding: 16px; border-radius: 8px; display: none; }
    .status.success { background: #d4edda; color: #155724; display: block; }
    .status.error { background: #f8d7da; color: #721c24; display: block; }
    .status.loading { background: #e2e3e5; color: #383d41; display: block; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #383d41; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    </div>
    <h1>Connect WhatsApp</h1>
    <p>Link your WhatsApp Business account to start receiving messages and automate responses with AI.</p>
    <button class="btn" id="connectBtn" onclick="startEmbeddedSignup()">
      <svg viewBox="0 0 24 24"><path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0022 12.06C22 6.53 17.5 2.04 12 2.04Z"/></svg>
      Continue with Facebook
    </button>
    <div class="status" id="status"></div>
  </div>

  <script>
    const SIGNUP_NONCE = '${signupNonce}';
    const API_BASE = '${apiBaseUrl}';
    const META_APP_ID = '${metaAppId}';
    const META_CONFIG_ID = '${metaConfigId}';
    
    window.fbAsyncInit = function() {
      FB.init({
        appId: META_APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: 'v18.0'
      });
    };
    
    (function(d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) return;
      js = d.createElement(s); js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'facebook-jssdk'));
    
    function showStatus(type, message) {
      const el = document.getElementById('status');
      el.className = 'status ' + type;
      el.innerHTML = type === 'loading' ? '<span class="spinner"></span>' + message : message;
    }
    
    function startEmbeddedSignup() {
      const btn = document.getElementById('connectBtn');
      btn.disabled = true;
      showStatus('loading', 'Opening Facebook Login...');
      
      FB.login(function(response) {
        if (response.authResponse) {
          handleSignupResponse(response.authResponse);
        } else {
          btn.disabled = false;
          showStatus('error', 'Login cancelled or failed. Please try again.');
        }
      }, {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: 2
        }
      });
    }
    
    async function handleSignupResponse(authResponse) {
      const btn = document.getElementById('connectBtn');
      showStatus('loading', 'Completing setup...');
      
      try {
        let result;
        
        if (authResponse.code) {
          // Exchange code server-side - this now handles everything
          result = await exchangeCodeForInfo(authResponse.code);
        } else {
          // Non-code response - this flow is not supported for security reasons
          // All auth must go through code exchange server-side
          btn.disabled = false;
          showStatus('error', 'Please retry - authentication must use code exchange flow.');
          return;
        }
        
        if (result.ok) {
          showStatus('success', '✓ WhatsApp connected successfully! You can close this window.');
          if (window.opener) {
            window.opener.postMessage({ type: 'WHATSAPP_CONNECTED', connection: result.connection }, '*');
          }
        } else {
          btn.disabled = false;
          showStatus('error', result.error || 'Failed to complete setup. Please try again.');
        }
      } catch (err) {
        btn.disabled = false;
        showStatus('error', 'Connection error: ' + (err.message || 'Unknown error'));
      }
    }
    
    async function exchangeCodeForInfo(code) {
      // Exchange code server-side - this handles everything including storage
      const resp = await fetch(API_BASE + '/api/whatsapp/embedded-signup/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, nonce: SIGNUP_NONCE })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to exchange code');
      }
      const result = await resp.json();
      // The exchange endpoint now stores the connection directly
      // Return a signal to skip the /complete call
      result._skipComplete = true;
      return result;
    }
    
    function parseSessionInfo(authResponse) {
      // Parse session info from embedded signup response
      // The structure varies based on Meta's response
      return {
        wabaId: authResponse.waba_id || null,
        phoneNumberId: authResponse.phone_number_id || null,
        displayPhoneNumber: authResponse.display_phone_number || null,
        businessName: authResponse.business_name || null
      };
    }
  </script>
</body>
</html>
  `;
  
  res.type('html').send(html);
});

// POST /api/whatsapp/embedded-signup/complete - Finalize signup via auth code exchange (server-side only)
app.post("/api/whatsapp/embedded-signup/complete", async (req: Request, res: Response) => {
  try {
    const { nonce, wabaId, phoneNumberId, displayPhoneNumber, businessName, authCode } = req.body;
    
    // Verify nonce (requires SESSION_SECRET)
    if (!nonce || !verifySignupNonce(nonce)) {
      res.status(401).json({ ok: false, error: "Invalid or expired signup session" });
      return;
    }
    
    // Require authCode for server-side token exchange (no browser tokens accepted)
    if (!authCode) {
      res.status(400).json({ ok: false, error: "authCode is required for server-side token exchange" });
      return;
    }
    
    if (!wabaId || !phoneNumberId) {
      res.status(400).json({ ok: false, error: "wabaId and phoneNumberId are required" });
      return;
    }
    
    // Exchange auth code for token server-side only
    const exchangeResult = await exchangeAuthCodeForToken(authCode);
    if (!exchangeResult.success) {
      res.status(400).json({ ok: false, error: exchangeResult.error || "Failed to exchange auth code" });
      return;
    }
    const finalAccessToken = exchangeResult.accessToken;
    
    // Upsert WhatsApp connection
    const connection = await prisma.whatsappConnection.upsert({
      where: { phoneNumberId },
      create: {
        wabaId,
        phoneNumberId,
        accessToken: finalAccessToken,
        displayPhoneNumber,
        businessName,
        enabled: true,
        mode: "REVIEW",
      },
      update: {
        wabaId,
        accessToken: finalAccessToken,
        displayPhoneNumber,
        businessName,
        updatedAt: new Date(),
      },
    });
    
    // Subscribe app to WABA webhooks
    const subscribeResult = await subscribeToWABAWebhooks(wabaId, finalAccessToken);
    if (!subscribeResult.success) {
      console.warn("Webhook subscription warning:", subscribeResult.error);
      // Don't fail the whole request, just log warning
    }
    
    // Log onboarding attempt for debugging
    await prisma.whatsappWebhookEvent.create({
      data: {
        method: "EMBEDDED_SIGNUP",
        bodyJson: {
          wabaId,
          phoneNumberId,
          displayPhoneNumber,
          businessName,
          subscriptionSuccess: subscribeResult.success,
        },
        note: "ONBOARDING_COMPLETE",
      },
    });
    
    res.json({
      ok: true,
      connection: {
        id: connection.id,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber,
        businessName: connection.businessName,
        enabled: connection.enabled,
        mode: connection.mode,
      },
      webhookSubscribed: subscribeResult.success,
    });
  } catch (error) {
    console.error("Embedded signup complete error:", error);
    res.status(500).json({ ok: false, error: "Failed to complete signup" });
  }
});

// POST /api/whatsapp/embedded-signup/exchange - Server-side code exchange (never returns token to browser)
app.post("/api/whatsapp/embedded-signup/exchange", async (req: Request, res: Response) => {
  try {
    const { code, nonce } = req.body;
    
    if (!nonce || !verifySignupNonce(nonce as string)) {
      res.status(401).json({ ok: false, error: "Invalid or expired session" });
      return;
    }
    
    if (!code) {
      res.status(400).json({ ok: false, error: "code is required" });
      return;
    }
    
    // Exchange code for access token (server-side only)
    const exchangeResult = await exchangeAuthCodeForToken(code as string);
    if (!exchangeResult.success) {
      res.status(400).json({ ok: false, error: exchangeResult.error });
      return;
    }
    
    // Get WABA and phone info from token
    const wabaInfo = await getWABAInfoFromToken(exchangeResult.accessToken!);
    
    if (!wabaInfo.wabaId || !wabaInfo.phoneNumberId) {
      res.status(400).json({ ok: false, error: "Could not retrieve WhatsApp Business Account info" });
      return;
    }
    
    // Store the connection directly - don't return token to browser
    const connection = await prisma.whatsappConnection.upsert({
      where: { phoneNumberId: wabaInfo.phoneNumberId },
      create: {
        wabaId: wabaInfo.wabaId,
        phoneNumberId: wabaInfo.phoneNumberId,
        accessToken: exchangeResult.accessToken!,
        displayPhoneNumber: wabaInfo.displayPhoneNumber,
        businessName: wabaInfo.businessName,
        enabled: true,
        mode: "REVIEW",
      },
      update: {
        wabaId: wabaInfo.wabaId,
        accessToken: exchangeResult.accessToken!,
        displayPhoneNumber: wabaInfo.displayPhoneNumber,
        businessName: wabaInfo.businessName,
        updatedAt: new Date(),
      },
    });
    
    // Subscribe to webhooks
    const subscribeResult = await subscribeToWABAWebhooks(wabaInfo.wabaId, exchangeResult.accessToken!);
    
    // Log onboarding
    await prisma.whatsappWebhookEvent.create({
      data: {
        method: "EMBEDDED_SIGNUP",
        bodyJson: {
          wabaId: wabaInfo.wabaId,
          phoneNumberId: wabaInfo.phoneNumberId,
          displayPhoneNumber: wabaInfo.displayPhoneNumber,
          businessName: wabaInfo.businessName,
          subscriptionSuccess: subscribeResult.success,
        },
        note: "ONBOARDING_VIA_EXCHANGE",
      },
    });
    
    // Return connection info without token
    res.json({
      ok: true,
      connection: {
        id: connection.id,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber,
        businessName: connection.businessName,
        enabled: connection.enabled,
        mode: connection.mode,
      },
      webhookSubscribed: subscribeResult.success,
    });
  } catch (error) {
    console.error("Exchange code error:", error);
    res.status(500).json({ ok: false, error: "Failed to exchange code" });
  }
});

// GET /api/whatsapp/embedded-signup/status - Check if user has connected WhatsApp
app.get("/api/whatsapp/embedded-signup/status", async (req: Request, res: Response) => {
  try {
    // Get the most recent connection (could be filtered by admin/business in future)
    const connections = await prisma.whatsappConnection.findMany({
      select: {
        id: true,
        wabaId: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        businessName: true,
        enabled: true,
        mode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    
    res.json({
      ok: true,
      hasConnection: connections.length > 0,
      connections,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ ok: false, error: "Failed to check status" });
  }
});

// GET /api/debug/whatsapp/onboarding - Debug endpoint for onboarding attempts
app.get("/api/debug/whatsapp/onboarding", async (req: Request, res: Response) => {
  const { key, limit } = req.query;
  const debugKey = process.env.DEBUG_KEY || "sema-debug-2026";
  
  if (key !== debugKey) {
    res.status(401).json({ error: "Invalid debug key" });
    return;
  }
  
  try {
    const events = await prisma.whatsappWebhookEvent.findMany({
      where: {
        OR: [
          { method: "EMBEDDED_SIGNUP" },
          { note: { contains: "ONBOARDING" } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit) || 50,
    });
    
    res.json({ ok: true, count: events.length, events });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch onboarding events" });
  }
});

// Helper: Exchange auth code for access token
async function exchangeAuthCodeForToken(code: string): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI || '';
    
    if (!appId || !appSecret) {
      return { success: false, error: "META_APP_ID and META_APP_SECRET required" };
    }
    
    const response = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${appId}&client_secret=${appSecret}&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      { method: 'GET' }
    );
    
    const data = await response.json();
    
    if (data.access_token) {
      return { success: true, accessToken: data.access_token };
    }
    
    return { success: false, error: data.error?.message || "Token exchange failed" };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Helper: Get WABA info from access token
async function getWABAInfoFromToken(accessToken: string): Promise<{
  wabaId: string | null;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessName: string | null;
}> {
  try {
    // Get debug token info to find business ID
    const debugResp = await fetch(
      `https://graph.facebook.com/v18.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`
    );
    const debugData = await debugResp.json();
    
    // Try to get WABA from the granted scopes/data
    // This is simplified - actual implementation may need to query /me/businesses or /me/accounts
    const wabaResp = await fetch(
      `https://graph.facebook.com/v18.0/me/whatsapp_business_accounts?access_token=${accessToken}`
    );
    const wabaData = await wabaResp.json();
    
    if (wabaData.data && wabaData.data.length > 0) {
      const waba = wabaData.data[0];
      
      // Get phone numbers for this WABA
      const phonesResp = await fetch(
        `https://graph.facebook.com/v18.0/${waba.id}/phone_numbers?access_token=${accessToken}`
      );
      const phonesData = await phonesResp.json();
      
      const phone = phonesData.data?.[0] || {};
      
      return {
        wabaId: waba.id,
        phoneNumberId: phone.id || null,
        displayPhoneNumber: phone.display_phone_number || null,
        businessName: waba.name || null,
      };
    }
    
    return { wabaId: null, phoneNumberId: null, displayPhoneNumber: null, businessName: null };
  } catch (error) {
    console.error("Get WABA info error:", error);
    return { wabaId: null, phoneNumberId: null, displayPhoneNumber: null, businessName: null };
  }
}

// Helper: Subscribe app to WABA webhooks
async function subscribeToWABAWebhooks(wabaId: string, accessToken: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Graph API expects access_token as query parameter for POST requests to subscribed_apps
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    
    const data = await response.json();
    
    if (data.success) {
      console.log(`Webhook subscription successful for WABA ${wabaId}`);
      return { success: true };
    }
    
    return { success: false, error: data.error?.message || "Subscription failed" };
  } catch (error: any) {
    console.error("Webhook subscription error:", error);
    return { success: false, error: error.message };
  }
}

// Helper: Verify webhook subscription
async function verifyWebhookSubscription(wabaId: string, accessToken: string): Promise<{ subscribed: boolean; apps?: any[] }> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps?access_token=${accessToken}`
    );
    const data = await response.json();
    
    return {
      subscribed: data.data && data.data.length > 0,
      apps: data.data || [],
    };
  } catch {
    return { subscribed: false };
  }
}

app.listen(port, "0.0.0.0", () => {
  console.log(`=== sema-api started ===`);
  console.log(`PORT: ${port}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? 'configured' : 'missing'}`);
  console.log(`Listening on 0.0.0.0:${port}`);
});
