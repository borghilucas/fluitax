ALTER TABLE "NaturezaOperacao" ADD COLUMN "dreInclude" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NaturezaOperacao" ADD COLUMN "dreCategory" TEXT;
ALTER TABLE "NaturezaOperacao" ADD COLUMN "dreLabel" TEXT;

CREATE TABLE "DREDeduction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DREDeduction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DREDeduction" ADD CONSTRAINT "DREDeduction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "DREDeduction_companyId_idx" ON "DREDeduction"("companyId");
CREATE INDEX "DREDeduction_period_idx" ON "DREDeduction"("startDate", "endDate");
