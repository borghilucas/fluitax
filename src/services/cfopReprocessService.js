const { prisma } = require('../prisma');
const { ensureNaturezaOperacao } = require('./naturezaOperacaoRegistry');
const {
  sanitizeNatOp,
  buildCfopCompositeFromNatOp,
  determinePrimaryCfop,
} = require('../utils/naturezaOperacao');

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5000;
const SAMPLE_LIMIT = 20;

function clampBatchSize(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(Math.max(1, Math.floor(value)), MAX_BATCH_SIZE);
}

function trimToNull(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function asISODate(input) {
  if (!input) return null;
  const copy = new Date(input);
  return Number.isNaN(copy.getTime()) ? null : copy.toISOString();
}

function equalsNormalized(a, b) {
  return sanitizeNatOp(a) === sanitizeNatOp(b);
}

function deriveInvoiceNatOp(invoice) {
  const direct = sanitizeNatOp(invoice.natOp);
  if (direct) return direct;

  const fromRelation = sanitizeNatOp(invoice.naturezaOperacao?.natOp)
    || sanitizeNatOp(invoice.naturezaOperacao?.descricao);
  if (fromRelation) return fromRelation;

  for (const item of invoice.items || []) {
    const composite = sanitizeNatOp(item?.cfopComposite);
    if (composite && composite.includes('-')) {
      const [, ...rest] = composite.split('-');
      const candidate = sanitizeNatOp(rest.join('-'));
      if (candidate) {
        return candidate;
      }
    }
  }

  for (const item of invoice.items || []) {
    const fromDescription = sanitizeNatOp(item?.cfopDescription);
    if (fromDescription) {
      return fromDescription;
    }
  }

  return null;
}

async function reprocessCompanyCfops({
  companyId,
  mode = 'dry-run',
  batchSize: requestedBatchSize,
  since,
  onlyMissing = false,
  actorId = null,
}) {
  if (!companyId) {
    const error = new Error('companyId é obrigatório');
    error.status = 400;
    throw error;
  }

  const normalizedMode = mode === 'commit' ? 'commit' : 'dry-run';
  const batchSize = clampBatchSize(requestedBatchSize);

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });

  if (!company) {
    const error = new Error('Empresa não encontrada');
    error.status = 404;
    throw error;
  }

  const params = {
    mode: normalizedMode,
    batchSize,
    since: since ? asISODate(since) : null,
    onlyMissing: Boolean(onlyMissing),
  };

  const batch = await prisma.reprocessBatch.create({
    data: {
      companyId,
      mode: normalizedMode,
      status: 'RUNNING',
      params,
      actorId: trimToNull(actorId),
      startedAt: new Date(),
    },
  });

  const stats = {
    scanned: 0,
    reprocessed: 0,
    skipped: 0,
    failed: 0,
  };
  const warnings = new Set();
  const samples = [];

  const invoiceWhere = {
    companyId,
    ...(since ? { emissao: { gte: since } } : {}),
    ...(onlyMissing
      ? {
          OR: [
            { naturezaOperacaoId: null },
            { natOp: null },
            { natOp: '' },
            { cfop: null },
            { cfop: '' },
          ],
        }
      : {}),
  };

  let cursor = null;
  let hasMore = true;

  try {
    while (hasMore) {
      const invoices = await prisma.invoice.findMany({
        where: invoiceWhere,
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : {}),
        select: {
          id: true,
          chave: true,
          type: true,
          emissao: true,
          isSelfIssuedEntrada: true,
          naturezaOperacaoId: true,
          natOp: true,
          cfop: true,
          naturezaOperacao: {
            select: {
              id: true,
              natOp: true,
              descricao: true,
            },
          },
          items: {
            orderBy: { id: 'asc' },
            select: {
              id: true,
              cfopCode: true,
              cfopDescription: true,
              cfopComposite: true,
              gross: true,
            },
          },
        },
      });

      if (!invoices.length) {
        hasMore = false;
        break;
      }

      cursor = invoices[invoices.length - 1].id;
      stats.scanned += invoices.length;

      for (const invoice of invoices) {
        const natOpCandidate = deriveInvoiceNatOp(invoice);
        if (!natOpCandidate) {
          warnings.add(`NF ${invoice.chave}: natureza da operação ausente.`);
          stats.skipped += 1;
          continue;
        }

        const primaryCfop = determinePrimaryCfop(
          (invoice.items || []).map((item) => ({
            cfopCode: item.cfopCode,
            gross: item.gross?.toString?.() ?? item.gross ?? '0',
          })),
        );

        if (!primaryCfop) {
          warnings.add(`NF ${invoice.chave}: CFOP principal não identificado.`);
          stats.skipped += 1;
          continue;
        }

        const naturezaResult = await ensureNaturezaOperacao({
          companyId,
          cfopCode: primaryCfop,
          invoiceType: invoice.type,
          isSelfIssuedEntrada: invoice.isSelfIssuedEntrada,
          natOp: natOpCandidate,
        }, { client: tx });

        const natureza = naturezaResult.natureza;
        if (!natureza) {
          warnings.add(`NF ${invoice.chave}: não foi possível registrar natureza da operação.`);
          stats.skipped += 1;
          continue;
        }

        const naturezaDescricao = naturezaResult.descricao
          ?? natureza.descricao
          ?? naturezaResult.natOpSanitized
          ?? natOpCandidate;
        const normalizedNatOp = naturezaResult.natOpSanitized ?? natOpCandidate;

        const invoiceUpdates = {};
        if (!equalsNormalized(invoice.cfop, primaryCfop)) {
          invoiceUpdates.cfop = primaryCfop;
        }
        if (invoice.naturezaOperacaoId !== natureza.id) {
          invoiceUpdates.naturezaOperacao = { connect: { id: natureza.id } };
        }
        if (!equalsNormalized(invoice.natOp, normalizedNatOp)) {
          invoiceUpdates.natOp = normalizedNatOp;
        }

        const itemUpdates = [];
        for (const item of invoice.items || []) {
          const expectedDescription = naturezaDescricao;
          const expectedComposite = buildCfopCompositeFromNatOp(item.cfopCode, expectedDescription);

          if (
            !equalsNormalized(item.cfopDescription, expectedDescription)
            || !equalsNormalized(item.cfopComposite, expectedComposite)
          ) {
            itemUpdates.push({
              id: item.id,
              data: {
                cfopDescription: expectedDescription,
                cfopComposite: expectedComposite,
              },
            });
          }
        }

        if (!Object.keys(invoiceUpdates).length && !itemUpdates.length) {
          stats.skipped += 1;
          continue;
        }

        if (normalizedMode === 'commit') {
          await prisma.$transaction(async (tx) => {
            if (Object.keys(invoiceUpdates).length) {
              const { naturezaOperacao, ...invoiceData } = invoiceUpdates;
              await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                  ...invoiceData,
                  ...(naturezaOperacao ? { naturezaOperacao } : {}),
                },
              });
            }
            for (const update of itemUpdates) {
              await tx.invoiceItem.update({
                where: { id: update.id },
                data: update.data,
              });
            }
          });
        }

        stats.reprocessed += 1;

        if (samples.length < SAMPLE_LIMIT) {
          samples.push({
            invoiceId: invoice.id,
            invoiceChave: invoice.chave,
            previousNaturezaOperacaoId: invoice.naturezaOperacaoId,
            newNaturezaOperacaoId: natureza.id,
            previousNatOp: invoice.natOp ?? null,
            newNatOp: normalizedNatOp,
            previousCfop: invoice.cfop ?? null,
            newCfop: primaryCfop,
            itemsAdjusted: itemUpdates.length,
          });
        }
      }
    }
  } catch (error) {
    stats.failed += 1;
    const failureFinishedAt = new Date();
    const failureSummary = {
      batchId: batch.id,
      mode: normalizedMode,
      scanned: stats.scanned,
      reprocessed: stats.reprocessed,
      skipped: stats.skipped,
      failed: stats.failed,
      warnings: Array.from(warnings),
      samples,
      startedAt: asISODate(batch.startedAt),
      finishedAt: asISODate(failureFinishedAt),
      error: error.message,
    };

    await prisma.reprocessBatch.update({
      where: { id: batch.id },
      data: {
        status: 'FAILED',
        summary: failureSummary,
        warnings: failureSummary.warnings,
        finishedAt: failureFinishedAt,
      },
    });
    throw error;
  }

  const finishedAt = new Date();
  const summary = {
    batchId: batch.id,
    mode: normalizedMode,
    scanned: stats.scanned,
    reprocessed: stats.reprocessed,
    skipped: stats.skipped,
    failed: stats.failed,
    warnings: Array.from(warnings),
    samples,
    startedAt: asISODate(batch.startedAt),
    finishedAt: asISODate(finishedAt),
  };

  await prisma.reprocessBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETED',
      summary,
      warnings: summary.warnings,
      finishedAt,
    },
  });

  return summary;
}

module.exports = {
  reprocessCompanyCfops,
};
