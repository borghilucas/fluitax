-- Add includeInReports flag to NaturezaOperacao
ALTER TABLE "NaturezaOperacao" ADD COLUMN "includeInReports" BOOLEAN NOT NULL DEFAULT true;
