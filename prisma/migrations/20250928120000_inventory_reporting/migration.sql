-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('RAW', 'FINISHED');

-- CreateEnum
CREATE TYPE "StockMovementDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "StockMovementSource" AS ENUM ('XML_IN', 'XML_OUT', 'ADJUSTMENT', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT', 'INVENTORY_OPENING');

-- AlterTable
ALTER TABLE "public"."Product"
  ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'RAW',
  ADD COLUMN "packSizeKg" DECIMAL,
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "line" TEXT,
  ADD COLUMN "category" TEXT;

-- CreateTable
CREATE TABLE "public"."ProductAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "direction" "StockMovementDirection" NOT NULL,
    "qty" DECIMAL NOT NULL,
    "unitPrice" DECIMAL,
    "totalValue" DECIMAL NOT NULL,
    "source" "StockMovementSource" NOT NULL,
    "invoiceId" TEXT,
    "counterparty" TEXT,
    "cfop" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CostSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "rawCoffeeAvgCostPerSc" DECIMAL NOT NULL,
    "stockSc" DECIMAL NOT NULL,
    "stockValue" DECIMAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "public"."Product"("companyId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_companyId_alias_key" ON "public"."ProductAlias"("companyId", "alias");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_idx" ON "public"."ProductAlias"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_date_idx" ON "public"."StockMovement"("companyId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_productId_date_idx" ON "public"."StockMovement"("companyId", "productId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_source_idx" ON "public"."StockMovement"("companyId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "CostSnapshot_companyId_date_key" ON "public"."CostSnapshot"("companyId", "date");

-- CreateIndex
CREATE INDEX "CostSnapshot_companyId_date_idx" ON "public"."CostSnapshot"("companyId", "date");

-- AddForeignKey
ALTER TABLE "public"."ProductAlias" ADD CONSTRAINT "ProductAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostSnapshot" ADD CONSTRAINT "CostSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
