-- CreateTable
CREATE TABLE "public"."CfopRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cfopCode" TEXT NOT NULL,
    "description" TEXT,
    "icmsRate" DECIMAL(65,30),
    "ipiRate" DECIMAL(65,30),
    "pisRate" DECIMAL(65,30),
    "cofinsRate" DECIMAL(65,30),
    "funruralRate" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfopRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CfopRule_companyId_cfopCode_key" ON "public"."CfopRule"("companyId", "cfopCode");

-- AddForeignKey
ALTER TABLE "public"."CfopRule" ADD CONSTRAINT "CfopRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CfopRule" ADD CONSTRAINT "CfopRule_cfopCode_fkey" FOREIGN KEY ("cfopCode") REFERENCES "public"."Cfop"("code") ON DELETE CASCADE ON UPDATE CASCADE;
