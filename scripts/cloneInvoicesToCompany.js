#!/usr/bin/env node
/*
 * Utility script to clone invoices from one company to another, adjusting the type to OUT and
 * linking the clones to a dedicated UploadBatch. Intended for regularisation flows such as
 * migrating TTR Soluções Comerciais outbound invoices.
 *
 * Usage:
 *   node scripts/cloneInvoicesToCompany.js --source <companyId> --target <companyId> --issuer <cnpjDigits>
 *
 * Environment:
 *   Relies on DATABASE_URL. No changes are committed unless execution completes without throwing.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { dryRun: false, commit: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (arg === '--commit') {
      result.commit = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    let value = inlineValue;
    if (value == null) {
      value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`);
      }
      index += 1;
    }
    if (rawKey === 'from') {
      result.source = value;
    } else if (rawKey === 'to') {
      result.target = value;
    } else {
      result[rawKey] = value;
    }
  }
  return result;
}

function buildCfopLabel(code, description, composite) {
  if (!code) return null;
  if (composite && composite.trim().length) {
    return composite.trim();
  }
  if (description && description.trim().length) {
    return `${code} - ${description.trim()}`;
  }
  return code;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const { source, target, issuer, type: typeArg, dryRun, commit } = parseArgs();
  assert(source, 'Missing --source <companyId>');
  assert(target, 'Missing --target <companyId>');
  assert(issuer, 'Missing --issuer <CNPJ digits>');
  assert(!(dryRun && commit), 'Use either --dry-run or --commit, not both.');
  assert(dryRun || commit, 'Specify --dry-run to preview or --commit to execute.');

  if (typeArg && typeArg.toUpperCase() !== 'OUT') {
    throw new Error('Only type=OUT is supported for cloning.');
  }

  const normalizedIssuer = issuer.replace(/\D/g, '');
  assert(normalizedIssuer.length === 14, 'Issuer CNPJ must contain 14 digits');

  const [sourceCompany, targetCompany] = await Promise.all([
    prisma.company.findUnique({ where: { id: source }, select: { id: true, name: true } }),
    prisma.company.findUnique({ where: { id: target }, select: { id: true, name: true } }),
  ]);

  assert(sourceCompany, `Source company not found: ${source}`);
  assert(targetCompany, `Target company not found: ${target}`);

  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: source,
      issuerCnpj: normalizedIssuer,
    },
    orderBy: { emissao: 'asc' },
    include: {
      items: {
        orderBy: { id: 'asc' },
        select: {
          cfopCode: true,
          cfopDescription: true,
          cfopComposite: true,
          ncm: true,
          cst: true,
          csosn: true,
          productCode: true,
          description: true,
          unit: true,
          qty: true,
          unitPrice: true,
          gross: true,
          discount: true,
          icmsValue: true,
          ipiValue: true,
          pisValue: true,
          cofinsValue: true,
        },
      },
    },
  });

  if (!invoices.length) {
    console.info('No invoices found for the given parameters. Nothing to clone.');
    return;
  }

  const duplicateKeys = await prisma.invoice.findMany({
    where: {
      companyId: target,
      chave: { in: invoices.map((invoice) => invoice.chave) },
    },
    select: { chave: true },
  });

  if (duplicateKeys.length) {
    const keys = duplicateKeys.map((entry) => entry.chave).join(', ');
    throw new Error(`Target company already contains ${duplicateKeys.length} invoice(s) with the same chave: ${keys}`);
  }


  const summary = {
    sourceCompany: sourceCompany.name,
    targetCompany: targetCompany.name,
    invoiceCount: invoices.length,
    chaves: invoices.map((invoice) => invoice.chave),
  };

  if (dryRun) {
    console.info(JSON.stringify(summary, null, 2));
    return;
  }

  const batch = await prisma.uploadBatch.create({
    data: {
      companyId: target,
      fileName: 'regularization-clone',
      actorId: 'system',
    },
  });

  const cfopCodes = Array.from(
    new Set(
      invoices.flatMap((invoice) => invoice.items.map((item) => item.cfopCode).filter(Boolean))
    )
  );

  if (cfopCodes.length) {
    await Promise.all(
      cfopCodes.map((code) =>
        prisma.cfop.upsert({
          where: { code },
          update: {},
          create: { code },
        })
      )
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    let counter = 0;
    const freshDuplicates = await tx.invoice.findMany({
      where: {
        companyId: target,
        chave: { in: invoices.map((invoice) => invoice.chave) },
      },
      select: { chave: true },
    });
    if (freshDuplicates.length) {
      const keys = freshDuplicates.map((entry) => entry.chave).join(', ');
      throw new Error(`Concurrent insert detected. Abort clone. Conflicting chaves: ${keys}`);
    }

    for (const invoice of invoices) {
      await tx.invoice.create({
        data: {
          companyId: target,
          chave: invoice.chave,
          globalInvoiceKey: invoice.chave,
          emissao: invoice.emissao,
          entradaSaida: invoice.entradaSaida,
          type: 'OUT',
          issuerCnpj: invoice.issuerCnpj,
          recipientCnpj: invoice.recipientCnpj,
          isSelfIssuedEntrada: false,
          totalNFe: invoice.totalNFe,
          sourceFileName: invoice.sourceFileName ?? 'regularization-clone',
          uploadBatchId: batch.id,
          items: {
            create: invoice.items.map((item) => {
              const payload = {
                ncm: item.ncm,
                cst: item.cst,
                csosn: item.csosn,
                productCode: item.productCode,
                description: item.description,
                unit: item.unit,
                qty: item.qty,
                unitPrice: item.unitPrice,
                gross: item.gross,
                discount: item.discount,
                icmsValue: item.icmsValue,
                ipiValue: item.ipiValue,
                pisValue: item.pisValue,
                cofinsValue: item.cofinsValue,
                cfopDescription: item.cfopDescription ?? null,
                cfopComposite: buildCfopLabel(item.cfopCode ?? null, item.cfopDescription ?? null, item.cfopComposite ?? null),
              };
              if (item.cfopCode) {
                payload.cfop = { connect: { code: item.cfopCode } };
              }
              return payload;
            }),
          },
        },
      });
      counter += 1;
    }
    return counter;
  });

  await prisma.uploadBatch.update({
    where: { id: batch.id },
    data: {
      summary: {
        inserted: created,
        duplicate: 0,
        failed: 0,
        warnings: [],
        clonedFromCompanyId: source,
      },
    },
  });

  console.info(`Cloned ${created} invoice(s) from ${sourceCompany.name} to ${targetCompany.name}. UploadBatch=${batch.id}`);
  console.info(JSON.stringify({ uploadBatchId: batch.id, inserted: created }, null, 2));
}

main()
  .catch((error) => {
    console.error('Clone failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
