-- CreateTable
CREATE TABLE "Cte" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "modelo" TEXT,
    "serie" TEXT,
    "numero" TEXT,
    "emissao" TIMESTAMP(3) NOT NULL,
    "cfop" TEXT,
    "natOp" TEXT,
    "emitCnpj" TEXT,
    "emitNome" TEXT,
    "emitUf" TEXT,
    "emitMun" TEXT,
    "destCnpj" TEXT,
    "destNome" TEXT,
    "destUf" TEXT,
    "destMun" TEXT,
    "valorPrestacao" DECIMAL(65,30) NOT NULL,
    "valorReceber" DECIMAL(65,30),
    "pesoBruto" DECIMAL(65,30),
    "unidadePeso" TEXT,
    "protocolo" TEXT,
    "protocoloMsg" TEXT,
    "protocoloStatus" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "uploadBatchId" TEXT,
    "sourceFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cte_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Cte" ADD CONSTRAINT "Cte_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cte" ADD CONSTRAINT "Cte_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "Cte_companyId_chave_key" ON "Cte"("companyId", "chave");
CREATE INDEX "Cte_companyId_emissao_idx" ON "Cte"("companyId", "emissao");
