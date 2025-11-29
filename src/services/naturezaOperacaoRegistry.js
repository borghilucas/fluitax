const { prisma } = require('../prisma');
const {
  sanitizeNatOp,
  normalizeNatOp,
  buildCfopCompositeFromNatOp,
} = require('../utils/naturezaOperacao');

function createHttpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  return error;
}

async function ensureNaturezaOperacao(
  {
    companyId,
    cfopCode,
    invoiceType,
    isSelfIssuedEntrada,
    natOp,
  },
  { client = prisma } = {}
) {
  const requestedNatOp = sanitizeNatOp(natOp);
  if (!requestedNatOp) {
    return {
      natureza: null,
      natOpSanitized: null,
      descricao: null,
      aliasApplied: false,
    };
  }

  const isSelfIssued = Boolean(isSelfIssuedEntrada);

  const alias = await client.naturezaOperacaoAlias.findFirst({
    where: {
      companyId,
      natOp: requestedNatOp,
      cfopCode,
      cfopType: invoiceType,
      isSelfIssuedEntrada: isSelfIssued,
    },
    select: {
      targetNaturezaOperacao: {
        select: {
          id: true,
          companyId: true,
          natOp: true,
          descricao: true,
          cfopCode: true,
          cfopType: true,
          isSelfIssuedEntrada: true,
        },
      },
    },
  });

  if (alias?.targetNaturezaOperacao) {
    const target = alias.targetNaturezaOperacao;
    return {
      natureza: target,
      natOpSanitized: sanitizeNatOp(target.natOp),
      descricao: target.descricao,
      aliasApplied: true,
    };
  }

  const descricao = normalizeNatOp(requestedNatOp) ?? requestedNatOp;

  const natureza = await client.naturezaOperacao.upsert({
    where: {
      companyId_cfopCode_natOp_cfopType_isSelfIssuedEntrada: {
        companyId,
        cfopCode,
        natOp: requestedNatOp,
        cfopType: invoiceType,
        isSelfIssuedEntrada: isSelfIssued,
      },
    },
    update: {
      descricao,
    },
    create: {
      companyId,
      cfopCode,
      natOp: requestedNatOp,
      descricao,
      cfopType: invoiceType,
      isSelfIssuedEntrada: isSelfIssued,
    },
  });

  return {
    natureza,
    natOpSanitized: requestedNatOp,
    descricao,
    aliasApplied: false,
  };
}

async function mergeNaturezas({
  companyId,
  targetNaturezaOperacaoId,
  sourceNaturezaOperacaoIds = [],
  sourceNatOps = [],
  actorId = null,
}) {
  if (!companyId) {
    throw createHttpError(400, 'companyId é obrigatório');
  }
  if (!targetNaturezaOperacaoId) {
    throw createHttpError(400, 'targetNaturezaOperacaoId é obrigatório');
  }

  const target = await prisma.naturezaOperacao.findFirst({
    where: { id: targetNaturezaOperacaoId, companyId },
  });

  if (!target) {
    throw createHttpError(404, 'Natureza de destino não encontrada');
  }

  const sourcesMap = new Map();

  if (Array.isArray(sourceNaturezaOperacaoIds)) {
    const records = await prisma.naturezaOperacao.findMany({
      where: {
        id: { in: sourceNaturezaOperacaoIds.filter(Boolean) },
        companyId,
      },
    });
    records.forEach((record) => {
      if (record.id !== target.id) {
        sourcesMap.set(record.id, record);
      }
    });
  }

  if (Array.isArray(sourceNatOps) && sourceNatOps.length) {
    const sanitizedNatOps = [...new Set(
      sourceNatOps
        .map((value) => sanitizeNatOp(value))
        .filter(Boolean)
    )];

    if (sanitizedNatOps.length) {
      const records = await prisma.naturezaOperacao.findMany({
        where: {
          companyId,
          natOp: { in: sanitizedNatOps },
        },
      });
      records.forEach((record) => {
        if (record.id !== target.id) {
          sourcesMap.set(record.id, record);
        }
      });
    }
  }

  const sources = Array.from(sourcesMap.values());

  if (!sources.length) {
    throw createHttpError(400, 'Nenhuma natureza de origem válida foi informada.');
  }

  sources.forEach((source) => {
    if (
      source.cfopCode !== target.cfopCode
      || source.cfopType !== target.cfopType
      || source.isSelfIssuedEntrada !== target.isSelfIssuedEntrada
    ) {
      throw createHttpError(400, 'As naturezas de origem devem possuir o mesmo CFOP, tipo e flag de self-issued do destino.');
    }
  });

  const sourceIds = sources.map((source) => source.id);
  const aliasNatOps = [...new Set(sources.map((source) => sanitizeNatOp(source.natOp)).filter(Boolean))];

  let invoicesUpdated = 0;
  let itemsUpdated = 0;

  await prisma.$transaction(async (tx) => {
    for (const natOpSanitized of aliasNatOps) {
      await tx.naturezaOperacaoAlias.upsert({
        where: {
          companyId_cfopCode_natOp_cfopType_isSelfIssuedEntrada: {
            companyId,
            cfopCode: target.cfopCode,
            natOp: natOpSanitized,
            cfopType: target.cfopType,
            isSelfIssuedEntrada: target.isSelfIssuedEntrada,
          },
        },
        update: {
          targetNaturezaOperacaoId: target.id,
        },
        create: {
          companyId,
          cfopCode: target.cfopCode,
          natOp: natOpSanitized,
          cfopType: target.cfopType,
          isSelfIssuedEntrada: target.isSelfIssuedEntrada,
          targetNaturezaOperacaoId: target.id,
        },
      });
    }

    if (!sourceIds.length) {
      return;
    }

    const invoices = await tx.invoice.findMany({
      where: {
        companyId,
        naturezaOperacaoId: { in: sourceIds },
      },
      select: { id: true },
    });

    const invoiceIds = invoices.map((invoice) => invoice.id);
    if (!invoiceIds.length) {
      return;
    }

    const updateResult = await tx.invoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: {
        naturezaOperacaoId: target.id,
        natOp: target.natOp,
        cfop: target.cfopCode,
      },
    });
    invoicesUpdated = updateResult.count;

    const items = await tx.invoiceItem.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: { id: true, cfopCode: true },
    });

    for (const item of items) {
      await tx.invoiceItem.update({
        where: { id: item.id },
        data: {
          cfopDescription: target.descricao,
          cfopComposite: buildCfopCompositeFromNatOp(item.cfopCode, target.descricao),
        },
      });
      itemsUpdated += 1;
    }
  });

  return {
    targetNaturezaOperacaoId: target.id,
    sourceNaturezaOperacaoIds: sourceIds,
    sourceNatOps: aliasNatOps,
    aliasesConfigured: aliasNatOps.length,
    invoicesUpdated,
    itemsUpdated,
    actorId,
  };
}

module.exports = {
  ensureNaturezaOperacao,
  mergeNaturezas,
};
