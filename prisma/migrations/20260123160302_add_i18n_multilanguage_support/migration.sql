-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('none', 'done', 'failed');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "autoTranslateIncoming" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoTranslateOutgoing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "incomingTranslateTo" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "outgoingTranslateTo" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "uiLanguage" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "senderPhone" TEXT,
    "recipientPhone" TEXT,
    "textOriginal" TEXT NOT NULL,
    "langOriginal" TEXT,
    "textTranslated" TEXT,
    "langTranslated" TEXT,
    "translationStatus" "TranslationStatus" NOT NULL DEFAULT 'none',
    "translationError" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_cache" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "fromLang" TEXT NOT NULL,
    "toLang" TEXT NOT NULL,
    "textOriginal" TEXT NOT NULL,
    "textTranslated" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_usage_daily" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translation_usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_businessId_idx" ON "messages"("businessId");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "translation_cache_keyHash_key" ON "translation_cache"("keyHash");

-- CreateIndex
CREATE INDEX "translation_usage_daily_businessId_idx" ON "translation_usage_daily"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "translation_usage_daily_businessId_day_key" ON "translation_usage_daily"("businessId", "day");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_usage_daily" ADD CONSTRAINT "translation_usage_daily_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
