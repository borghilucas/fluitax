-- CreateTable
CREATE TABLE "InventoryOpening" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "qtyNative" DECIMAL,
    "scEquivalent" DECIMAL NOT NULL,
    "totalValue" DECIMAL NOT NULL,
    "unitCost" DECIMAL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryOpening_companyId_productId_key" ON "InventoryOpening"("companyId", "productId");

-- CreateIndex
CREATE INDEX "InventoryOpening_companyId_date_idx" ON "InventoryOpening"("companyId", "date");

-- AddForeignKey
ALTER TABLE "InventoryOpening" ADD CONSTRAINT "InventoryOpening_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryOpening" ADD CONSTRAINT "InventoryOpening_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
