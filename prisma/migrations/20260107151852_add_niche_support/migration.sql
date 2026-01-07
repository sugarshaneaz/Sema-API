-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('CATALOG', 'FAQ', 'POLICIES', 'WEBSITE', 'DOCUMENT', 'NOTES');

-- CreateTable
CREATE TABLE "niches" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "niches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niche_templates" (
    "id" TEXT NOT NULL,
    "nicheId" TEXT NOT NULL,
    "templateJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "niche_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "nicheId" TEXT,
    "businessName" TEXT,
    "languagePreference" TEXT NOT NULL DEFAULT 'en',
    "tonePreference" TEXT NOT NULL DEFAULT 'friendly',
    "handoffRules" JSONB NOT NULL DEFAULT '{}',
    "intakeAnswers" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "metaJson" JSONB NOT NULL DEFAULT '{}',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products_services" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "description" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sku" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "returnsPolicyText" TEXT,
    "warrantyPolicyText" TEXT,
    "deliveryPolicyText" TEXT,
    "paymentMethodsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" TEXT,
    "messageHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "niche_templates_nicheId_key" ON "niche_templates"("nicheId");

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_connectionId_key" ON "business_profiles"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "policies_businessId_key" ON "policies"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_connectionId_customerPhone_key" ON "conversations"("connectionId", "customerPhone");

-- AddForeignKey
ALTER TABLE "niche_templates" ADD CONSTRAINT "niche_templates_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "niches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_nicheId_fkey" FOREIGN KEY ("nicheId") REFERENCES "niches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products_services" ADD CONSTRAINT "products_services_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
