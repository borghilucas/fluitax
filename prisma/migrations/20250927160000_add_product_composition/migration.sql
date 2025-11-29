-- CreateTable
CREATE TABLE "public"."ProductComposition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rawProductId" TEXT NOT NULL,
    "finishedProductId" TEXT NOT NULL,
    "ratio" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductComposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductComposition_companyId_rawProductId_finishedProduc_key" ON "public"."ProductComposition"("companyId", "rawProductId", "finishedProductId");
CREATE INDEX "ProductComposition_companyId_rawProductId_idx" ON "public"."ProductComposition"("companyId", "rawProductId");
CREATE INDEX "ProductComposition_companyId_finishedProductId_idx" ON "public"."ProductComposition"("companyId", "finishedProductId");

-- AddForeignKey
ALTER TABLE "public"."ProductComposition" ADD CONSTRAINT "ProductComposition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProductComposition" ADD CONSTRAINT "ProductComposition_rawProductId_fkey" FOREIGN KEY ("rawProductId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProductComposition" ADD CONSTRAINT "ProductComposition_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
