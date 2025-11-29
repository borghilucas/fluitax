-- CreateEnum
CREATE TYPE "public"."InvoiceType" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "public"."Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Partner" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cnpjCpf" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Cfop" (
    "code" TEXT NOT NULL,

    CONSTRAINT "Cfop_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "public"."Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "emissao" TIMESTAMP(3) NOT NULL,
    "entradaSaida" TIMESTAMP(3),
    "type" "public"."InvoiceType" NOT NULL,
    "issuerCnpj" TEXT NOT NULL,
    "recipientCnpj" TEXT NOT NULL,
    "isSelfIssuedEntrada" BOOLEAN NOT NULL DEFAULT false,
    "totalNFe" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "cfopCode" TEXT NOT NULL,
    "ncm" TEXT,
    "cst" TEXT,
    "csosn" TEXT,
    "qty" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "gross" DECIMAL(65,30) NOT NULL,
    "discount" DECIMAL(65,30) NOT NULL,
    "icmsValue" DECIMAL(65,30),
    "ipiValue" DECIMAL(65,30),
    "pisValue" DECIMAL(65,30),
    "cofinsValue" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_cnpj_key" ON "public"."Company"("cnpj");

-- CreateIndex
CREATE INDEX "Partner_companyId_cnpjCpf_idx" ON "public"."Partner"("companyId", "cnpjCpf");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_chave_key" ON "public"."Invoice"("chave");

-- CreateIndex
CREATE INDEX "Invoice_companyId_emissao_idx" ON "public"."Invoice"("companyId", "emissao");

-- CreateIndex
CREATE INDEX "Invoice_companyId_type_emissao_idx" ON "public"."Invoice"("companyId", "type", "emissao");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "public"."InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_cfopCode_idx" ON "public"."InvoiceItem"("cfopCode");

-- AddForeignKey
ALTER TABLE "public"."Partner" ADD CONSTRAINT "Partner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvoiceItem" ADD CONSTRAINT "InvoiceItem_cfopCode_fkey" FOREIGN KEY ("cfopCode") REFERENCES "public"."Cfop"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
