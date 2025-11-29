-- Add cfop description/composite columns to invoice items
ALTER TABLE "InvoiceItem"
    ADD COLUMN "cfopDescription" TEXT,
    ADD COLUMN "cfopComposite" TEXT;

-- Backfill composite with existing CFOP code when empty
UPDATE "InvoiceItem"
SET "cfopComposite" = COALESCE("cfopComposite", "cfopCode");

-- Create indexes supporting composite lookups
CREATE INDEX IF NOT EXISTS "InvoiceItem_cfopComposite_idx" ON "InvoiceItem"("cfopComposite");
