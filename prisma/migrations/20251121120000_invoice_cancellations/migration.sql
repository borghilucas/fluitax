-- CreateTable
CREATE TABLE "InvoiceCancellation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "eventType" TEXT,
    "eventSequence" INTEGER,
    "statusCode" TEXT,
    "statusMessage" TEXT,
    "protocolNumber" TEXT,
    "eventTimestamp" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "justification" TEXT,
    "sourceFileName" TEXT,
    "uploadBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCancellation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InvoiceCancellation" ADD CONSTRAINT "InvoiceCancellation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCancellation" ADD CONSTRAINT "InvoiceCancellation_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCancellation_companyId_chave_key" ON "InvoiceCancellation"("companyId", "chave");

-- CreateIndex
CREATE INDEX "InvoiceCancellation_companyId_eventTimestamp_idx" ON "InvoiceCancellation"("companyId", "eventTimestamp");
