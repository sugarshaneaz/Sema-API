-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('RESTAURANT', 'RETAIL', 'CLINIC', 'SALON', 'GOV', 'OTHER');

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "activeBusinessId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "businessId" TEXT;

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "ownerAdminId" TEXT NOT NULL,
    "type" "BusinessType" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "colors" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "legacyRestaurantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_categories" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "description" TEXT,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_legacyRestaurantId_key" ON "businesses"("legacyRestaurantId");

-- CreateIndex
CREATE INDEX "businesses_ownerAdminId_idx" ON "businesses"("ownerAdminId");

-- CreateIndex
CREATE INDEX "catalog_categories_businessId_idx" ON "catalog_categories"("businessId");

-- CreateIndex
CREATE INDEX "catalog_items_businessId_idx" ON "catalog_items"("businessId");

-- CreateIndex
CREATE INDEX "catalog_items_categoryId_idx" ON "catalog_items"("categoryId");

-- CreateIndex
CREATE INDEX "orders_businessId_idx" ON "orders"("businessId");

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_activeBusinessId_fkey" FOREIGN KEY ("activeBusinessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_ownerAdminId_fkey" FOREIGN KEY ("ownerAdminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
