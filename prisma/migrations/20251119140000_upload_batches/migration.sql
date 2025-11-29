-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT,
    "actorId" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add upload metadata to Invoice
ALTER TABLE "Invoice"
    ADD COLUMN "uploadBatchId" TEXT,
    ADD COLUMN "sourceFileName" TEXT,
    ADD COLUMN "globalInvoiceKey" TEXT;

-- Backfill existing invoices with globalInvoiceKey = chave
UPDATE "Invoice"
SET "globalInvoiceKey" = "chave"
WHERE "globalInvoiceKey" IS NULL;

-- CreateIndex for UploadBatch company/date
CREATE INDEX "UploadBatch_companyId_createdAt_idx" ON "UploadBatch"("companyId", "createdAt");

-- Add foreign key from UploadBatch to Company
ALTER TABLE "UploadBatch"
    ADD CONSTRAINT "UploadBatch_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key from Invoice to UploadBatch
ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_uploadBatchId_fkey"
    FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create per-company unique constraint for invoice keys
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_companyId_chave_key" ON "Invoice"("companyId", "chave");
