-- CreateTable
CREATE TABLE "ReportConfiguration" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "excludedCfops" TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  "excludedCustomers" TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportConfiguration_companyId_reportId_key" ON "ReportConfiguration"("companyId", "reportId");

-- AddForeignKey
ALTER TABLE "ReportConfiguration"
ADD CONSTRAINT "ReportConfiguration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
