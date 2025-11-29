-- AlterTable
ALTER TABLE "public"."Invoice" ADD COLUMN     "cfop" TEXT,
ADD COLUMN     "natOp" TEXT,
ADD COLUMN     "naturezaOperacaoId" TEXT;

-- CreateTable
CREATE TABLE "public"."NaturezaOperacao" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "natOp" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "cfopCode" TEXT NOT NULL,
    "cfopType" "public"."InvoiceType" NOT NULL,
    "isSelfIssuedEntrada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaturezaOperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReprocessBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "params" JSONB,
    "summary" JSONB,
    "warnings" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReprocessBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NaturezaOperacao_companyId_descricao_idx" ON "public"."NaturezaOperacao"("companyId", "descricao");

-- CreateIndex
CREATE UNIQUE INDEX "NaturezaOperacao_unique_key" ON "public"."NaturezaOperacao"("companyId", "cfopCode", "natOp", "cfopType", "isSelfIssuedEntrada");

-- CreateIndex
CREATE INDEX "ReprocessBatch_companyId_createdAt_idx" ON "public"."ReprocessBatch"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Invoice" ADD CONSTRAINT "Invoice_naturezaOperacaoId_fkey" FOREIGN KEY ("naturezaOperacaoId") REFERENCES "public"."NaturezaOperacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NaturezaOperacao" ADD CONSTRAINT "NaturezaOperacao_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReprocessBatch" ADD CONSTRAINT "ReprocessBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "public"."ProductComposition_companyId_rawProductId_finishedProduc_key" RENAME TO "ProductComposition_companyId_rawProductId_finishedProductId_key";
