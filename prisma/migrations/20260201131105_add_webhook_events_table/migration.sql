-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "headersJson" JSONB,
    "queryJson" JSONB,
    "bodyJson" JSONB,
    "rawBody" TEXT,
    "note" TEXT,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_webhook_events_createdAt_idx" ON "whatsapp_webhook_events"("createdAt");
