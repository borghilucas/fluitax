const path = require('path');
const AdmZip = require('adm-zip');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../prisma');
const { parseUploadXml, InvoiceParseError } = require('../utils/xmlInvoiceParser');
const {
  sanitizeNatOp,
  buildCfopCompositeFromNatOp,
  determinePrimaryCfop,
} = require('../utils/naturezaOperacao');
const { ensureNaturezaOperacao } = require('./naturezaOperacaoRegistry');

const DEFAULT_REASON_GENERIC = 'falha ao processar arquivo';
const REASON_LAYOUT_UNSUPPORTED = 'layout não suportado';
const REASON_XML_MALFORMED = 'XML malformado';
const REASON_MISSING_INF = 'faltando infNFe/Id';
const REASON_NFSE = 'NFS-e';

function sanitizeEntryName(entryName) {
  const normalized = path.posix.normalize(entryName);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

const MULTI_COMPANY_ACCESS_KEY_ENABLED =
  String(process.env.MULTI_COMPANY_ACCESS_KEY ?? 'false').toLowerCase() === 'true';
const DECISION_LOGS_ENABLED =
  String(process.env.UPLOAD_DECISION_LOGS ?? 'false').toLowerCase() === 'true';

function logClassificationDecision(payload) {
  if (!DECISION_LOGS_ENABLED) {
    return;
  }

  try {
    console.info('[invoice-direction-decision]', payload);
  } catch (error) {
    // swallow logging errors to avoid impacting flow
  }
}

async function ensureCfops(codes) {
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));

  await Promise.all(uniqueCodes.map((code) => (
    prisma.cfop.upsert({
      where: { code },
      update: {},
      create: { code },
    })
  )));
}

async function persistCancellation(companyId, cancellationData, options = {}) {
  const { uploadBatchId = null, sourceFileName = null } = options;
  if (!cancellationData || !cancellationData.chave) {
    return null;
  }

  const uploadBatchValue = uploadBatchId ?? null;
  const sourceName = sourceFileName ?? cancellationData.sourceFileName ?? null;

  const payload = {
    eventType: cancellationData.eventType ?? null,
    eventSequence: cancellationData.eventSequence ?? null,
    statusCode: cancellationData.statusCode ?? null,
    statusMessage: cancellationData.statusMessage ?? null,
    protocolNumber: cancellationData.protocolNumber ?? null,
    eventTimestamp: cancellationData.eventTimestamp ?? null,
    receivedAt: cancellationData.receivedAt ?? null,
    justification: cancellationData.justification ?? null,
    uploadBatchId: uploadBatchValue,
    sourceFileName: sourceName,
  };

  return prisma.$transaction(async (tx) => {
    const record = await tx.invoiceCancellation.upsert({
      where: { companyId_chave: { companyId, chave: cancellationData.chave } },
      update: payload,
      create: {
        companyId,
        chave: cancellationData.chave,
        ...payload,
      },
      select: {
        id: true,
        chave: true,
        statusCode: true,
        statusMessage: true,
        eventTimestamp: true,
      },
    });

    await tx.invoice.deleteMany({ where: { companyId, chave: cancellationData.chave } });

    return record;
  });
}

async function persistInvoice(companyId, invoiceData, options = {}) {
  const {
    uploadBatchId = null,
    sourceFileName = null,
    allowCrossCompany = false,
    updateExisting = false,
    onCrossCompanyDuplicate = null,
  } = options;

  const existing = await prisma.invoice.findFirst({
    where: { companyId, chave: invoiceData.chave },
    select: { id: true, numero: true },
  });
  if (existing) {
    if (invoiceData.numero && (!existing.numero || existing.numero !== invoiceData.numero)) {
      await prisma.invoice.update({
        where: { id: existing.id },
        data: { numero: String(invoiceData.numero) },
        select: { id: true },
      });
    }
    if (updateExisting) {
      const updated = await updateExistingInvoice(companyId, invoiceData);
      return { status: 'updated', reason: 'chave já existente', updatedItems: updated };
    }
    return { status: 'duplicate', reason: 'chave já existente' };
  }

  let crossCompanyRecord = null;
  if (allowCrossCompany) {
    crossCompanyRecord = await prisma.invoice.findFirst({
      where: {
        chave: invoiceData.chave,
        NOT: { companyId },
      },
      select: {
        id: true,
        companyId: true,
      },
    });
    if (crossCompanyRecord && typeof onCrossCompanyDuplicate === 'function') {
      await onCrossCompanyDuplicate(crossCompanyRecord);
    }
  }

  const cfopCodes = invoiceData.items.map((item) => item.cfopCode);
  await ensureCfops(cfopCodes);

  const primaryCfop = determinePrimaryCfop(invoiceData.items);
  if (!primaryCfop) {
    return { status: 'failed', reason: 'CFOP não identificado' };
  }

  const natOpSanitized = sanitizeNatOp(invoiceData.natOp);
  if (!natOpSanitized) {
    return { status: 'failed', reason: 'natureza da operação ausente' };
  }

  const naturezaResult = await ensureNaturezaOperacao({
    companyId,
    cfopCode: primaryCfop,
    invoiceType: invoiceData.type,
    isSelfIssuedEntrada: invoiceData.isSelfIssuedEntrada,
    natOp: natOpSanitized,
  });

  const natureza = naturezaResult.natureza;
  if (!natureza) {
    return { status: 'failed', reason: 'natureza da operação ausente' };
  }

  const naturezaDescricao = naturezaResult.descricao ?? natOpSanitized;
  const invoiceNatOpValue = naturezaResult.natOpSanitized ?? natOpSanitized;

  try {
    const invoiceNumber = invoiceData.numero ? String(invoiceData.numero).trim() : null;
    await prisma.invoice.create({
      data: {
        company: { connect: { id: companyId } },
        chave: invoiceData.chave,
        globalInvoiceKey: invoiceData.chave,
        numero: invoiceNumber,
    emissao: invoiceData.emissao,
    entradaSaida: invoiceData.entradaSaida,
    type: invoiceData.type,
    issuerCnpj: invoiceData.issuerCnpj,
    recipientCnpj: invoiceData.recipientCnpj,
    recipientName: invoiceData.recipientName ?? null,
    recipientCity: invoiceData.recipientCity ?? null,
    recipientState: invoiceData.recipientState ?? null,
    isSelfIssuedEntrada: invoiceData.isSelfIssuedEntrada,
    cfop: primaryCfop,
    naturezaOperacao: { connect: { id: natureza.id } },
        natOp: invoiceNatOpValue,
        totalNFe: new Prisma.Decimal(invoiceData.totalNFe),
        uploadBatch: uploadBatchId ? { connect: { id: uploadBatchId } } : undefined,
        sourceFileName,
        items: {
          create: invoiceData.items.map((item) => {
            return {
              cfop: { connect: { code: item.cfopCode } },
              cfopDescription: naturezaDescricao,
              cfopComposite: buildCfopCompositeFromNatOp(item.cfopCode, naturezaDescricao),
              ncm: item.ncm ?? null,
              cst: item.cst ?? null,
              csosn: item.csosn ?? null,
              productCode: item.productCode ?? null,
              description: item.description ?? null,
              unit: item.unit ?? null,
              qty: new Prisma.Decimal(item.qty),
              unitPrice: new Prisma.Decimal(item.unitPrice),
              gross: new Prisma.Decimal(item.gross),
              discount: new Prisma.Decimal(item.discount ?? '0'),
              icmsValue: item.icmsValue != null ? new Prisma.Decimal(item.icmsValue) : null,
              ipiValue: item.ipiValue != null ? new Prisma.Decimal(item.ipiValue) : null,
              pisValue: item.pisValue != null ? new Prisma.Decimal(item.pisValue) : null,
              cofinsValue: item.cofinsValue != null ? new Prisma.Decimal(item.cofinsValue) : null,
              vBC: item.vBC != null ? new Prisma.Decimal(item.vBC) : null,
              vICMS: item.icmsValue != null ? new Prisma.Decimal(item.icmsValue) : null,
              vICMSDeson: item.vICMSDeson != null ? new Prisma.Decimal(item.vICMSDeson) : null,
              vBCST: item.vBCST != null ? new Prisma.Decimal(item.vBCST) : null,
              vST: item.vST != null ? new Prisma.Decimal(item.vST) : null,
              vTotTrib: item.vTotTrib != null
                ? new Prisma.Decimal(item.vTotTrib)
                : item.icmsValue != null || item.ipiValue != null || item.pisValue != null || item.cofinsValue != null
                  ? new Prisma.Decimal(
                      ['icmsValue', 'ipiValue', 'pisValue', 'cofinsValue']
                        .map((key) => Number(item[key] ?? 0))
                        .reduce((a, b) => a + b, 0)
                    )
                  : null,
            };
          }),
        },
      },
    });

    return {
      status: 'inserted',
      crossCompanyDuplicate: crossCompanyRecord ? crossCompanyRecord.companyId : null,
    };
  } catch (error) {
    if (error.code === 'P2002') {
      return { status: 'duplicate', reason: 'chave já existente', code: 'P2002' };
    }
    throw error;
  }
}

async function persistCte(companyId, cteData, options = {}) {
  const {
    uploadBatchId = null,
    sourceFileName = null,
    allowCrossCompany = false,
  } = options;

  const existing = await prisma.cte.findFirst({
    where: { companyId, chave: cteData.chave },
    select: { id: true },
  });
  if (existing) {
    return { status: 'duplicate', reason: 'chave já existente' };
  }

  if (allowCrossCompany) {
    const cross = await prisma.cte.findFirst({
      where: { chave: cteData.chave, NOT: { companyId } },
      select: { companyId: true },
    });
    if (cross) {
      return { status: 'duplicate', reason: `chave em outra empresa (${cross.companyId})` };
    }
  }

  if (cteData.cfop) {
    await ensureCfops([cteData.cfop]);
  }

  await prisma.cte.create({
    data: {
      company: { connect: { id: companyId } },
      chave: cteData.chave,
      modelo: cteData.modelo ?? null,
      serie: cteData.serie ?? null,
      numero: cteData.numero ?? null,
      emissao: cteData.emissao,
      cfop: cteData.cfop ?? null,
      natOp: cteData.natOp ?? null,
      emitCnpj: cteData.emitCnpj ?? null,
      emitNome: cteData.emitNome ?? null,
      emitUf: cteData.emitUf ?? null,
      emitMun: cteData.emitMun ?? null,
      destCnpj: cteData.destCnpj ?? null,
      destNome: cteData.destNome ?? null,
      destUf: cteData.destUf ?? null,
      destMun: cteData.destMun ?? null,
      valorPrestacao: new Prisma.Decimal(cteData.valorPrestacao),
      valorReceber: cteData.valorReceber != null ? new Prisma.Decimal(cteData.valorReceber) : null,
      pesoBruto: cteData.pesoBruto != null ? new Prisma.Decimal(cteData.pesoBruto) : null,
      unidadePeso: cteData.unidadePeso ?? null,
      protocolo: cteData.protocolo ?? null,
      protocoloMsg: cteData.protocoloMsg ?? null,
      protocoloStatus: cteData.protocoloStatus ?? null,
      isCancelled: Boolean(cteData.isCancelled),
      uploadBatch: uploadBatchId ? { connect: { id: uploadBatchId } } : undefined,
      sourceFileName,
    },
  });

  return { status: 'inserted' };
}

async function updateExistingInvoice(companyId, invoiceData) {
  const existing = await prisma.invoice.findFirst({
    where: { companyId, chave: invoiceData.chave },
    select: {
      id: true,
      recipientName: true,
      recipientCity: true,
      recipientState: true,
      items: { select: { id: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!existing) return 0;

  const count = Math.min(existing.items.length, invoiceData.items.length);
  let updated = 0;

  // Atualiza cabeçalho se vierem dados novos de destinatário
  if (
    invoiceData.recipientName ||
    invoiceData.recipientCity ||
    invoiceData.recipientState
  ) {
    await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        recipientName: invoiceData.recipientName ?? existing.recipientName ?? null,
        recipientCity: invoiceData.recipientCity ?? existing.recipientCity ?? null,
        recipientState: invoiceData.recipientState ?? existing.recipientState ?? null,
      },
    });
  }

  for (let idx = 0; idx < count; idx += 1) {
    const parsed = invoiceData.items[idx];
    const existingItem = existing.items[idx];
    if (!parsed || !existingItem) continue;

    const vTotTrib =
      parsed.vTotTrib ??
      (parsed.icmsValue || parsed.ipiValue || parsed.pisValue || parsed.cofinsValue
        ? ['icmsValue', 'ipiValue', 'pisValue', 'cofinsValue']
            .map((key) => Number(parsed[key] ?? 0))
            .reduce((a, b) => a + b, 0)
        : null);

    await prisma.invoiceItem.update({
      where: { id: existingItem.id },
      data: {
        vBC: parsed.vBC != null ? new Prisma.Decimal(parsed.vBC) : null,
        vICMS: parsed.icmsValue != null ? new Prisma.Decimal(parsed.icmsValue) : null,
        vICMSDeson: parsed.vICMSDeson != null ? new Prisma.Decimal(parsed.vICMSDeson) : null,
        vBCST: parsed.vBCST != null ? new Prisma.Decimal(parsed.vBCST) : null,
        vST: parsed.vST != null ? new Prisma.Decimal(parsed.vST) : null,
        vTotTrib: vTotTrib != null ? new Prisma.Decimal(vTotTrib) : null,
        icmsValue: parsed.icmsValue != null ? new Prisma.Decimal(parsed.icmsValue) : null,
        ipiValue: parsed.ipiValue != null ? new Prisma.Decimal(parsed.ipiValue) : null,
        pisValue: parsed.pisValue != null ? new Prisma.Decimal(parsed.pisValue) : null,
        cofinsValue: parsed.cofinsValue != null ? new Prisma.Decimal(parsed.cofinsValue) : null,
      },
    });
    updated += 1;
  }
  return updated;
}

function normalizeTaxId(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) {
    return digits;
  }
  return null;
}

function deriveInvoiceDirection(invoiceData, companyCnpj) {
  const normalizedCompany = normalizeTaxId(companyCnpj);
  const issuer = normalizeTaxId(invoiceData.issuerCnpj);
  const recipient = normalizeTaxId(invoiceData.recipientCnpj);

  if (!normalizedCompany || !issuer || !recipient) {
    return { error: REASON_LAYOUT_UNSUPPORTED };
  }

  if (invoiceData.tpNF === '0' && issuer === normalizedCompany) {
    return {
      type: 'IN',
      isSelfIssuedEntrada: true,
    };
  }

  if (invoiceData.tpNF === '1' && recipient === normalizedCompany) {
    return {
      type: 'IN',
      isSelfIssuedEntrada: issuer === normalizedCompany,
    };
  }

  if (invoiceData.tpNF === '1' && issuer === normalizedCompany) {
    return {
      type: 'OUT',
      isSelfIssuedEntrada: false,
    };
  }

  if (recipient === normalizedCompany) {
    return {
      type: 'IN',
      isSelfIssuedEntrada: issuer === normalizedCompany,
    };
  }

  if (issuer === normalizedCompany) {
    return {
      type: 'OUT',
      isSelfIssuedEntrada: false,
    };
  }

  return { error: REASON_LAYOUT_UNSUPPORTED };
}

function resolveParseFailureReason(error) {
  if (error instanceof InvoiceParseError) {
    switch (error.code) {
      case 'XML_MALFORMED':
        return REASON_XML_MALFORMED;
      case 'MISSING_INF_NFE':
        return REASON_MISSING_INF;
      case 'LAYOUT_UNSUPPORTED':
      default:
        return REASON_LAYOUT_UNSUPPORTED;
    }
  }
  return DEFAULT_REASON_GENERIC;
}

async function processInvoicesFromZip({
  companyId,
  companyCnpj,
  zipBuffer,
  limits,
  fileName,
  actorId,
  flags = {},
}) {
  const maxFiles = limits?.maxFiles ?? 10000;
  const maxFileSize = limits?.maxFileSize ?? 5 * 1024 * 1024;
  const allowCrossCompany = Boolean(flags.multiCompanyAccessKey ?? MULTI_COMPANY_ACCESS_KEY_ENABLED);
  const enableDecisionLogs = Boolean(flags.enableDecisionLogs ?? DECISION_LOGS_ENABLED);

  const result = {
    inserted: 0,
    updated: 0,
    duplicate: 0,
    failed: 0,
    cancelled: 0,
    details: [],
  };

  const warnings = [];

  const cancellationKeys = new Set();
  const insertedInvoices = new Map();

  function registerCancellationDetail(chave, reason, fileName, options = {}) {
    const { increment = true, recordDetail = true } = options;
    const normalizedReason = reason || 'nota fiscal cancelada';

    if (chave && insertedInvoices.has(chave)) {
      const insertedInfo = insertedInvoices.get(chave);
      insertedInvoices.delete(chave);
      if (result.inserted > 0) {
        result.inserted -= 1;
      }
      const existingDetail = result.details[insertedInfo.detailIndex];
      if (existingDetail) {
        existingDetail.status = 'cancelled';
        existingDetail.reason = normalizedReason;
      } else if (recordDetail) {
        result.details.push({ file: fileName, status: 'cancelled', reason: normalizedReason });
      }
      if (increment) {
        result.cancelled += 1;
      }
      return;
    }

    if (increment) {
      result.cancelled += 1;
    }

    if (recordDetail) {
      result.details.push({ file: fileName, status: 'cancelled', reason: normalizedReason });
    }
  }

  let uploadBatch = null;
  if (allowCrossCompany) {
    uploadBatch = await prisma.uploadBatch.create({
      data: {
        companyId,
        fileName: fileName ?? null,
        actorId: actorId ?? null,
      },
      select: { id: true },
    });
  }

  let processedFiles = 0;
  const updateExisting = flags.updateExisting === false ? false : true;

  let zip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (error) {
    throw Object.assign(new Error('Não foi possível ler o arquivo zip'), { status: 400 });
  }

  const entries = zip.getEntries();

  for (const entry of entries) {
    const sanitizedName = sanitizeEntryName(entry.entryName);
    const displayName = path.posix.basename(entry.entryName);

    if (!sanitizedName) {
      result.failed += 1;
      result.details.push({ file: entry.entryName, status: 'failed', reason: 'caminho inválido no zip' });
      continue;
    }

    if (entry.isDirectory || !sanitizedName.toLowerCase().endsWith('.xml')) {
      continue;
    }

    processedFiles += 1;
    if (processedFiles > maxFiles) {
      result.failed += 1;
      result.details.push({ file: displayName, status: 'failed', reason: `limite de ${maxFiles} arquivos excedido` });
      continue;
    }

    let buffer;
    try {
      buffer = entry.getData();
    } catch (error) {
      result.failed += 1;
      result.details.push({ file: displayName, status: 'failed', reason: DEFAULT_REASON_GENERIC });
      continue;
    }

    if (buffer.length > maxFileSize) {
      result.failed += 1;
      result.details.push({ file: displayName, status: 'failed', reason: `arquivo excede ${Math.round(maxFileSize / (1024 * 1024))} MB` });
      continue;
    }

    const xmlContent = buffer.toString('utf-8');

    let analysis;
    try {
      analysis = parseUploadXml(xmlContent);
    } catch (error) {
      result.failed += 1;
      result.details.push({
        file: displayName,
        status: 'failed',
        reason: resolveParseFailureReason(error),
      });
      continue;
    }

    if (analysis.kind === 'NFSE') {
      result.failed += 1;
      result.details.push({ file: displayName, status: 'failed', reason: analysis.data.reason || REASON_NFSE });
      continue;
    }

    if (analysis.kind === 'CANCELLATION') {
      const cancellation = analysis.data;
      if (!cancellation?.chave) {
        result.failed += 1;
        result.details.push({ file: displayName, status: 'failed', reason: 'chave do cancelamento ausente' });
        continue;
      }
      if (!cancellation.isApproved) {
        result.failed += 1;
        result.details.push({
          file: displayName,
          status: 'failed',
          reason: cancellation.statusMessage || 'cancelamento não homologado',
        });
        continue;
      }
      const alreadyCancelled = cancellationKeys.has(cancellation.chave);
      cancellationKeys.add(cancellation.chave);
      try {
        await persistCancellation(companyId, cancellation, {
          uploadBatchId: uploadBatch?.id ?? null,
          sourceFileName: displayName,
        });
      } catch (error) {
        result.failed += 1;
        result.details.push({
          file: displayName,
          status: 'failed',
          reason: error.message || DEFAULT_REASON_GENERIC,
        });
        continue;
      }
      registerCancellationDetail(
        cancellation.chave,
        cancellation.statusMessage || 'nota fiscal cancelada',
        displayName,
        { increment: !alreadyCancelled, recordDetail: !alreadyCancelled },
      );
      continue;
    }

    if (analysis.kind === 'CTE') {
      const cteData = analysis.data;
      try {
        const persistResult = await persistCte(companyId, cteData, {
          uploadBatchId: uploadBatch?.id ?? null,
          sourceFileName: displayName,
          allowCrossCompany,
        });
        if (persistResult.status === 'inserted') {
          result.inserted += 1;
          result.details.push({ file: displayName, status: 'inserted', type: 'CTE' });
        } else if (persistResult.status === 'duplicate') {
          result.duplicate += 1;
          result.details.push({ file: displayName, status: 'duplicate', reason: persistResult.reason || 'chave já existente', type: 'CTE' });
        } else {
          result.failed += 1;
          result.details.push({ file: displayName, status: 'failed', reason: persistResult.reason || DEFAULT_REASON_GENERIC, type: 'CTE' });
        }
      } catch (error) {
        result.failed += 1;
        result.details.push({
          file: displayName,
          status: 'failed',
          reason: error.message || DEFAULT_REASON_GENERIC,
        });
      }
      continue;
    }

    const { protocol, isCancelled, ignored: isIgnored, ignoreReason, ...invoiceData } = analysis.data;

    if (isIgnored) {
      result.failed += 1;
      result.details.push({
        file: displayName,
        status: 'failed',
        reason: ignoreReason || 'nota fiscal ignorada pelos critérios configurados',
      });
      continue;
    }

    if (isCancelled) {
      const alreadyCancelled = cancellationKeys.has(invoiceData.chave);
      cancellationKeys.add(invoiceData.chave);
      try {
        await persistCancellation(companyId, {
          chave: invoiceData.chave,
          statusCode: protocol?.statusCode ?? null,
          statusMessage: protocol?.statusMessage ?? null,
          protocolNumber: protocol?.protocolNumber ?? null,
          receivedAt: protocol?.receivedAt ?? null,
        }, {
          uploadBatchId: uploadBatch?.id ?? null,
          sourceFileName: displayName,
        });
      } catch (error) {
        result.failed += 1;
        result.details.push({
          file: displayName,
          status: 'failed',
          reason: error.message || DEFAULT_REASON_GENERIC,
        });
        continue;
      }
      registerCancellationDetail(
        invoiceData.chave,
        protocol?.statusMessage || 'nota fiscal cancelada',
        displayName,
        { increment: !alreadyCancelled, recordDetail: true },
      );
      continue;
    }

    if (cancellationKeys.has(invoiceData.chave)) {
      registerCancellationDetail(
        invoiceData.chave,
        'nota fiscal cancelada (evento no mesmo upload)',
        displayName,
        { increment: false, recordDetail: true },
      );
      continue;
    }

    const existingCancellation = await prisma.invoiceCancellation.findUnique({
      where: { companyId_chave: { companyId, chave: invoiceData.chave } },
      select: { statusMessage: true },
    });
    if (existingCancellation) {
      cancellationKeys.add(invoiceData.chave);
      registerCancellationDetail(
        invoiceData.chave,
        existingCancellation.statusMessage || 'nota fiscal cancelada',
        displayName,
        { increment: false, recordDetail: true },
      );
      continue;
    }

    const direction = deriveInvoiceDirection(invoiceData, companyCnpj);
    if (enableDecisionLogs) {
      logClassificationDecision({
        companyId,
        chave: invoiceData.chave,
        derivedType: direction.type,
        isSelfIssuedEntrada: direction.isSelfIssuedEntrada,
        issuerCnpj: invoiceData.issuerCnpj,
        recipientCnpj: invoiceData.recipientCnpj,
        tpNF: invoiceData.tpNF,
      });
    }
    if (direction.error) {
      result.failed += 1;
      result.details.push({ file: displayName, status: 'failed', reason: direction.error });
      continue;
    }

    const invoiceForPersistence = {
      ...invoiceData,
      type: direction.type,
      isSelfIssuedEntrada: direction.isSelfIssuedEntrada,
    };

    try {
      const persistenceOutcome = await persistInvoice(companyId, invoiceForPersistence, {
        uploadBatchId: uploadBatch?.id ?? null,
        sourceFileName: displayName,
        allowCrossCompany,
        updateExisting,
        onCrossCompanyDuplicate: (existing) => {
          warnings.push({
            chave: invoiceData.chave,
            existingCompanyId: existing.companyId,
          });
        },
      });
      if (persistenceOutcome.status === 'inserted') {
        result.inserted += 1;
        const detail = { file: displayName, status: 'inserted' };
        if (persistenceOutcome.crossCompanyDuplicate) {
          detail.warning = `chave também encontrada em companyId=${persistenceOutcome.crossCompanyDuplicate}`;
        }
        const detailIndex = result.details.length;
        result.details.push(detail);
        insertedInvoices.set(invoiceData.chave, { detailIndex });
      } else if (persistenceOutcome.status === 'updated') {
        result.updated = (result.updated || 0) + 1;
        result.details.push({
          file: displayName,
          status: 'updated',
          reason: persistenceOutcome.reason,
          updatedItems: persistenceOutcome.updatedItems ?? 0,
        });
      } else if (persistenceOutcome.status === 'duplicate') {
        result.duplicate += 1;
        result.details.push({ file: displayName, status: 'duplicate', reason: persistenceOutcome.reason });
      } else {
        result.failed += 1;
        result.details.push({ file: displayName, status: 'failed', reason: persistenceOutcome.reason || DEFAULT_REASON_GENERIC });
      }
    } catch (error) {
      result.failed += 1;
      result.details.push({
        file: displayName,
        status: 'failed',
        reason: error.message || DEFAULT_REASON_GENERIC,
      });
    }
  }

  if (allowCrossCompany && uploadBatch?.id) {
    const summaryPayload = {
      inserted: result.inserted,
      updated: result.updated,
      duplicate: result.duplicate,
      failed: result.failed,
      cancelled: result.cancelled,
      warnings,
    };
    await prisma.uploadBatch.update({
      where: { id: uploadBatch.id },
      data: { summary: summaryPayload },
    });
    if (warnings.length) {
      result.warnings = warnings;
    }
  }

  return result;
}

module.exports = {
  processInvoicesFromZip,
};
