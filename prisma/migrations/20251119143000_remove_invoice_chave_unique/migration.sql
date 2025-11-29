-- Remove global unique index on invoice chave now that per-company uniqueness is enforced
DROP INDEX IF EXISTS "Invoice_chave_key";
