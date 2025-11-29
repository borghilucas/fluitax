-- AlterTable
ALTER TABLE "public"."CfopRule"
ADD COLUMN "type" "public"."InvoiceType" NOT NULL DEFAULT 'OUT';

-- DropIndex
DROP INDEX IF EXISTS "CfopRule_companyId_cfopCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "CfopRule_companyId_cfopCode_type_key" ON "public"."CfopRule"("companyId", "cfopCode", "type");
