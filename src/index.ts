import express, { Request, Response } from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "sema-api" });
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

  if (body.object === "whatsapp_business_account") {
    body.entry?.forEach((entry: any) => {
      entry.changes?.forEach((change: any) => {
        if (change.field === "messages") {
          const messages = change.value?.messages;
          messages?.forEach((message: any) => {
            console.log("Received message:", {
              from: message.from,
              type: message.type,
              timestamp: message.timestamp,
              text: message.text?.body,
            });
          });
        }
      });
    });

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`sema-api listening on port ${port}`);
});
