-- CreateTable
CREATE TABLE "public"."NaturezaOperacaoAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "natOp" TEXT NOT NULL,
    "cfopCode" TEXT NOT NULL,
    "cfopType" "public"."InvoiceType" NOT NULL,
    "isSelfIssuedEntrada" BOOLEAN NOT NULL DEFAULT false,
    "targetNaturezaOperacaoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaturezaOperacaoAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NaturezaOperacaoAlias_companyId_natOp_idx" ON "public"."NaturezaOperacaoAlias"("companyId", "natOp");

-- CreateIndex
CREATE UNIQUE INDEX "NaturezaOperacaoAlias_unique_key" ON "public"."NaturezaOperacaoAlias"("companyId", "cfopCode", "natOp", "cfopType", "isSelfIssuedEntrada");

-- AddForeignKey
ALTER TABLE "public"."NaturezaOperacaoAlias" ADD CONSTRAINT "NaturezaOperacaoAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NaturezaOperacaoAlias" ADD CONSTRAINT "NaturezaOperacaoAlias_targetNaturezaOperacaoId_fkey" FOREIGN KEY ("targetNaturezaOperacaoId") REFERENCES "public"."NaturezaOperacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
