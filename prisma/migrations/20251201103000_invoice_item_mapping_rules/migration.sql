-- CreateTable
CREATE TABLE "InvoiceItemMappingRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "descriptionKey" TEXT NOT NULL,
    "descriptionRaw" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "unitRaw" TEXT,
    "conversionMultiplier" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItemMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItemMappingRule_unique_key" ON "InvoiceItemMappingRule"("companyId", "descriptionKey", "unitKey");

-- CreateIndex
CREATE INDEX "InvoiceItemMappingRule_companyId_productId_idx" ON "InvoiceItemMappingRule"("companyId", "productId");

-- AddForeignKey
ALTER TABLE "InvoiceItemMappingRule" ADD CONSTRAINT "InvoiceItemMappingRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItemMappingRule" ADD CONSTRAINT "InvoiceItemMappingRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
