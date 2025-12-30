import express, { Request, Response } from "express";
import cors from "cors";
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
  
  const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  console.log("incoming webhook", { phone_number_id: phoneNumberId || null });

  res.sendStatus(200);

  if (body.object === "whatsapp_business_account") {
    (async () => {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === "messages") {
            const pnid = change.value?.metadata?.phone_number_id;
            const messages = change.value?.messages;

            if (pnid) {
              try {
                const connection = await prisma.whatsappConnection.findUnique({
                  where: { phoneNumberId: pnid },
                });

                if (connection) {
                  console.log(`Connection found for ${pnid}`);
                  
                  messages?.forEach((message: any) => {
                    console.log("Received message:", {
                      from: message.from,
                      type: message.type,
                      timestamp: message.timestamp,
                      text: message.text?.body,
                    });
                  });
                } else {
                  console.log(`No connection for phone_number_id: ${pnid}`);
                }
              } catch (error) {
                console.error("Error looking up connection:", error instanceof Error ? error.stack : error);
              }
            }
          }
        }
      }
    })();
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`sema-api listening on port ${port}`);
});
