const express = require('express');
const path = require('path');
const { Prisma } = require('@prisma/client');
const { prisma } = require('../prisma');
const { reprocessCompanyCfops } = require('../services/cfopReprocessService');
const { mergeNaturezas } = require('../services/naturezaOperacaoRegistry');
const { sanitizeNatOp, buildCfopCompositeFromNatOp } = require('../utils/naturezaOperacao');
const { buildWarehouseGeneralReport } = require('../services/warehouseReportService');
const { generateWarehouseReportPdf } = require('../services/warehouseReportPdf');
const {
  buildUnconditionalDiscountReport,
  generateUnconditionalDiscountCsv,
} = require('../services/unconditionalDiscountReportService');

const router = express.Router();

const SEPARATE_CFOP_BY_DESCRIPTION =
  String(process.env.SEPARATE_CFOP_BY_DESCRIPTION ?? 'false').toLowerCase() === 'true';
const CFOP_REPROCESS_ENABLED =
  String(process.env.CFOP_REPROCESS_ENABLE ?? 'false').toLowerCase() === 'true';

function normalizeCnpj(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

function formatCnpj(digits) {
  if (digits.length !== 14) {
    return digits;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function toPlainDecimal(value) {
  if (value == null) return '0';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function parseOptionalDecimal(input, label) {
  if (input == null || input === '') {
    return null;
  }

  const normalized = typeof input === 'number' ? input.toString() : String(input).replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) {
    const error = new Error(`Valor inválido para ${label}`);
    error.status = 400;
    throw error;
  }
  return new Prisma.Decimal(normalized);
}

function parseNonNegativeDecimal(input, label) {
  const value = parseOptionalDecimal(input, label);
  if (value && value.lt(0)) {
    const error = new Error(`${label} deve ser maior ou igual a zero.`);
    error.status = 400;
    throw error;
  }
  return value;
}

const DEFAULT_OPENING_DATE_MILLIS = Date.UTC(2024, 11, 31, 0, 0, 0, 0);

function defaultInventoryOpeningDate() {
  return new Date(DEFAULT_OPENING_DATE_MILLIS);
}

function parseInventoryOpeningDate(raw) {
  if (!raw) {
    return defaultInventoryOpeningDate();
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      const error = new Error('Data inválida para estoque inicial.');
      error.status = 400;
      throw error;
    }
    const cloned = new Date(raw.getTime());
    cloned.setUTCHours(0, 0, 0, 0);
    return cloned;
  }

  let value = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return defaultInventoryOpeningDate();
    }
    value = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Data inválida para estoque inicial. Utilize o formato YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function parseOptionalSinceDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      const error = new Error('Parâmetro "since" inválido.');
      error.status = 400;
      throw error;
    }
    const clone = new Date(raw.getTime());
    clone.setUTCHours(0, 0, 0, 0);
    return clone;
  }

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error('Parâmetro "since" inválido. Use o formato YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

function parseOptionalEndDate(raw) {
  const start = parseOptionalSinceDate(raw);
  if (!start) return null;
  const end = new Date(start.getTime());
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function serializeInventoryOpening(record) {
  if (!record) {
    return null;
  }

  const scEquivalentDecimal = record.scEquivalent ?? new Prisma.Decimal(0);
  let unitCostDecimal = record.unitCost ?? null;
  if (!unitCostDecimal && scEquivalentDecimal && typeof scEquivalentDecimal.isZero === 'function' && !scEquivalentDecimal.isZero()) {
    unitCostDecimal = record.totalValue.div(scEquivalentDecimal);
  }

  return {
    id: record.id,
    productId: record.productId,
    productName: record.product?.name ?? null,
    productSku: record.product?.sku ?? null,
    productType: record.product?.type ?? null,
    productUnit: record.product?.unit ?? null,
    packSizeKg: record.product?.packSizeKg ? toPlainDecimal(record.product.packSizeKg) : null,
    date: record.date?.toISOString() ?? null,
    qtyNative: record.qtyNative != null ? toPlainDecimal(record.qtyNative) : null,
    scEquivalent: toPlainDecimal(record.scEquivalent),
    totalValue: toPlainDecimal(record.totalValue),
    unitCost: unitCostDecimal ? toPlainDecimal(unitCostDecimal) : null,
    notes: record.notes ?? null,
    updatedAt: record.updatedAt?.toISOString() ?? null,
  };
}

async function loadInventoryOpenings(companyId) {
  const records = await prisma.inventoryOpening.findMany({
    where: { companyId },
    orderBy: [
      { product: { name: 'asc' } },
      { productId: 'asc' },
    ],
    select: {
      id: true,
      productId: true,
      date: true,
      qtyNative: true,
      scEquivalent: true,
      totalValue: true,
      unitCost: true,
      notes: true,
      updatedAt: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          type: true,
          unit: true,
          packSizeKg: true,
        },
      },
    },
  });

  return records.map(serializeInventoryOpening);
}

async function buildCompanySummary(companyId) {
  const cfopBreakdownPromise = SEPARATE_CFOP_BY_DESCRIPTION
    ? prisma.invoiceItem.groupBy({
        by: ['cfopCode', 'cfopDescription', 'cfopComposite'],
        where: { invoice: { companyId } },
        _count: { _all: true },
        _sum: { gross: true },
        orderBy: { _sum: { gross: 'desc' } },
        take: 10,
      })
    : prisma.invoiceItem.groupBy({
        by: ['cfopCode'],
        where: { invoice: { companyId } },
        _count: { _all: true },
        _sum: { gross: true },
        orderBy: { _sum: { gross: 'desc' } },
        take: 10,
      });

  const [aggregates, totals, cfopBreakdown] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['type'],
      where: { companyId },
      _count: { _all: true },
      _sum: { totalNFe: true },
    }),
    prisma.invoice.count({ where: { companyId } }),
    cfopBreakdownPromise,
  ]);

  const itemsCountPromise = prisma.invoiceItem.count({
    where: {
      invoice: { companyId },
    },
  });

  const [firstInvoice, lastInvoice, itemsCount, recentInvoices, monthlyTotals] = await Promise.all([
    prisma.invoice.findFirst({
      where: { companyId },
      orderBy: { emissao: 'asc' },
      select: { emissao: true },
    }),
    prisma.invoice.findFirst({
      where: { companyId },
      orderBy: { emissao: 'desc' },
      select: { emissao: true },
    }),
    itemsCountPromise,
    prisma.invoice.findMany({
      where: { companyId },
      orderBy: { emissao: 'desc' },
      take: 5,
      select: {
        id: true,
        chave: true,
        emissao: true,
        type: true,
        totalNFe: true,
        issuerCnpj: true,
        recipientCnpj: true,
      },
    }),
    prisma.$queryRaw`
      SELECT
        to_char(date_trunc('month', "emissao"), 'YYYY-MM') AS period,
        "type",
        COUNT(*) AS invoice_count,
        COALESCE(SUM("totalNFe"), 0) AS total_amount
      FROM "Invoice"
      WHERE "companyId" = ${companyId}
      GROUP BY period, "type"
      ORDER BY period DESC, "type" ASC
      LIMIT 48
    `,
  ]);

  const summary = {
    totalInvoices: totals,
    totalItems: itemsCount,
    outbound: { count: 0, total: '0' },
    inbound: { count: 0, total: '0' },
    grandTotal: '0',
  };

  let grandTotalDecimal = new Prisma.Decimal(0);

  aggregates.forEach((entry) => {
    const count = entry._count?._all ?? 0;
    const decimalValue = entry._sum?.totalNFe ?? new Prisma.Decimal(0);
    const totalValue = toPlainDecimal(decimalValue);
    if (entry.type === 'OUT') {
      summary.outbound.count = count;
      summary.outbound.total = totalValue;
    } else if (entry.type === 'IN') {
      summary.inbound.count = count;
      summary.inbound.total = totalValue;
    }
    grandTotalDecimal = grandTotalDecimal.plus(decimalValue);
  });

  summary.grandTotal = toPlainDecimal(grandTotalDecimal);

  return {
    summary,
    period: {
      start: firstInvoice?.emissao ?? null,
      end: lastInvoice?.emissao ?? null,
    },
    recentInvoices: recentInvoices.map((invoice) => ({
      ...invoice,
      emissao: invoice.emissao?.toISOString() ?? null,
      totalNFe: toPlainDecimal(invoice.totalNFe),
    })),
    monthlyTotals: normalizeMonthlyTotals(monthlyTotals),
    cfopBreakdown: cfopBreakdown.map((entry) => {
      const cfopCode = entry.cfopCode;
      const description = 'cfopDescription' in entry ? entry.cfopDescription ?? null : null;
      const composite = 'cfopComposite' in entry ? entry.cfopComposite ?? null : null;
      const label = SEPARATE_CFOP_BY_DESCRIPTION
        ? (composite && composite.trim().length
            ? composite.trim()
            : description && description.trim().length
            ? `${cfopCode} - ${description.trim()}`
            : cfopCode)
        : cfopCode;

      return {
        cfopCode,
        cfop: label,
        cfopLabel: label,
        cfopDescription: description,
        invoices: entry._count?._all ?? 0,
        grossTotal: toPlainDecimal(entry._sum?.gross ?? '0'),
      };
    }),
  };
}

function normalizeMonthlyTotals(rawRows) {
  if (!Array.isArray(rawRows)) return [];

  const aggregator = new Map();
  rawRows.forEach((row) => {
    const period = row.period;
    if (!aggregator.has(period)) {
      aggregator.set(period, {
        period,
        totals: { IN: '0', OUT: '0' },
        invoices: 0,
      });
    }
    const bucket = aggregator.get(period);
    const type = row.type;
    const amount = row.total_amount ?? 0;
    const count = Number(row.invoice_count ?? 0);
    if (type === 'IN' || type === 'OUT') {
      const previous = Number(bucket.totals[type]);
      const numericAmount = Number(amount);
      if (!Number.isNaN(numericAmount)) {
        bucket.totals[type] = (previous + numericAmount).toString();
      }
    }
    bucket.invoices += count;
  });

  return Array.from(aggregator.values())
    .sort((a, b) => (a.period > b.period ? 1 : -1));
}

async function buildProductOverview(companyId) {
  const [totalProducts, mappedItems, totalItems] = await prisma.$transaction([
    prisma.product.count({ where: { companyId } }),
    prisma.invoiceItemProductMapping.count({
      where: {
        invoiceItem: {
          invoice: { companyId },
        },
      },
    }),
    prisma.invoiceItem.count({ where: { invoice: { companyId } } }),
  ]);

  const unmapped = totalItems - mappedItems;

  return {
    totalProducts,
    mappedItems,
    unmappedItems: unmapped < 0 ? 0 : unmapped,
    totalItems,
  };
}

function normalizeKey(input) {
  if (!input) return null;
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const UNIT_ALIASES = {
  SCS: 'SC',
};

function normalizeUnit(input) {
  if (!input) return null;
  const cleaned = String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .toUpperCase();

  return UNIT_ALIASES[cleaned] || cleaned;
}

function requireUnit(value, label) {
  const normalized = normalizeUnit(value);
  if (!normalized) {
    const error = new Error(`Unidade inválida para ${label}.`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

function serializeUnitConversion(conversion) {
  return {
    id: conversion.id,
    productId: conversion.productId,
    scope: conversion.productId ? 'PRODUCT' : 'GENERAL',
    productName: conversion.product ? conversion.product.name : null,
    productUnit: conversion.product ? conversion.product.unit : null,
    sourceUnit: conversion.sourceUnit,
    targetUnit: conversion.targetUnit,
    multiplier: toPlainDecimal(conversion.multiplier),
    createdAt: conversion.createdAt,
    updatedAt: conversion.updatedAt,
  };
}

function buildMappingRuleKey(descriptionKey, unitKey) {
  if (!descriptionKey || !unitKey) {
    return null;
  }
  return `${descriptionKey}|${unitKey}`;
}

async function upsertInvoiceItemMappingRule({
  companyId,
  productId,
  description,
  unit,
  conversionMultiplier = null,
}) {
  if (!description || !description.toString().trim()) {
    return;
  }
  const descriptionKey = normalizeKey(description);
  const unitKey = normalizeUnit(unit);
  if (!descriptionKey || !unitKey) {
    return;
  }

  const descriptionRaw = description.toString().trim();
  const unitRaw = unit ? unit.toString().trim() : null;

  const updateData = {
    productId,
    descriptionRaw,
    unitRaw,
  };
  if (conversionMultiplier && !conversionMultiplier.isZero()) {
    updateData.conversionMultiplier = conversionMultiplier;
  }

  await prisma.invoiceItemMappingRule.upsert({
    where: {
      companyId_descriptionKey_unitKey: {
        companyId,
        descriptionKey,
        unitKey,
      },
    },
    update: updateData,
    create: {
      companyId,
      productId,
      descriptionKey,
      descriptionRaw,
      unitKey,
      unitRaw,
      conversionMultiplier: conversionMultiplier && !conversionMultiplier.isZero() ? conversionMultiplier : null,
    },
  });

  console.info('[product-mapping-rule] learned', {
    companyId,
    productId,
    description: descriptionRaw,
    unit: unitRaw,
    conversionMultiplier: conversionMultiplier ? conversionMultiplier.toString() : null,
  });
}

async function cleanupIncompatibleMappings(companyId) {
  const mappings = await prisma.invoiceItemProductMapping.findMany({
    where: {
      invoiceItem: {
        invoice: { companyId },
      },
      product: { companyId },
    },
    select: {
      invoiceItemId: true,
      convertedQty: true,
      conversionFactor: true,
      invoiceItem: { select: { unit: true } },
      product: { select: { unit: true } },
    },
  });

  const invalidIds = mappings
    .filter((mapping) => {
      const itemUnit = normalizeUnit(mapping.invoiceItem.unit);
      const productUnit = normalizeUnit(mapping.product.unit);
      const unitsMismatch = itemUnit && productUnit && itemUnit !== productUnit;
      if (!unitsMismatch) {
        return false;
      }

      const hasConversion = (mapping.convertedQty && !mapping.convertedQty.isZero())
        || (mapping.conversionFactor && !mapping.conversionFactor.isZero());

      return !hasConversion;
    })
    .map((mapping) => mapping.invoiceItemId);

  if (invalidIds.length) {
    await prisma.invoiceItemProductMapping.deleteMany({
      where: { invoiceItemId: { in: invalidIds } },
    });
  }

  return invalidIds.length;
}

router.get('/', async (req, res, next) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        cnpj: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ items: companies });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/naturezas/:naturezaId/detail', async (req, res, next) => {
  try {
    const { id, naturezaId } = req.params;
    const natureza = await prisma.naturezaOperacao.findFirst({
      where: { id: naturezaId, companyId: id },
      select: {
        id: true,
        natOp: true,
        descricao: true,
        cfopCode: true,
        cfopType: true,
        includeInReports: true,
        dreInclude: true,
        dreCategory: true,
        dreLabel: true,
      },
    });
    if (!natureza) {
      return res.status(404).json({ error: 'Natureza não encontrada' });
    }

    const aliases = await prisma.naturezaOperacaoAlias.findMany({
      where: { targetNaturezaOperacaoId: naturezaId },
      select: { id: true, natOp: true, cfopCode: true, cfopType: true },
      orderBy: { natOp: 'asc' },
    });

    const invoices = await prisma.invoice.findMany({
      where: { companyId: id, naturezaOperacaoId: naturezaId },
      orderBy: { emissao: 'desc' },
      take: 50,
      select: { id: true, chave: true, emissao: true, type: true, totalNFe: true },
    });

    const products = await prisma.invoiceItemProductMapping.findMany({
      where: { invoiceItem: { invoice: { companyId: id, naturezaOperacaoId: naturezaId } } },
      select: {
        productId: true,
        invoiceItem: { select: { gross: true } },
        product: { select: { name: true, sku: true } },
      },
      take: 50,
    });

    res.status(200).json({ natureza, aliases, invoices, products });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/naturezas/:naturezaId/config', async (req, res, next) => {
  try {
    const { id, naturezaId } = req.params;
    const includeInReports = typeof req.body?.includeInReports === 'boolean' ? req.body.includeInReports : null;
    const dreInclude = typeof req.body?.dreInclude === 'boolean' ? req.body.dreInclude : null;
    const dreCategory = typeof req.body?.dreCategory === 'string' ? req.body.dreCategory : null;
    const dreLabel = typeof req.body?.dreLabel === 'string' ? req.body.dreLabel.trim() : null;
    const updated = await prisma.naturezaOperacao.update({
      where: { id: naturezaId, companyId: id },
      data: {
        ...(includeInReports == null ? {} : { includeInReports }),
        ...(dreInclude == null ? {} : { dreInclude }),
        ...(dreCategory ? { dreCategory } : {}),
        ...(dreLabel ? { dreLabel } : {}),
      },
      select: { id: true, includeInReports: true, dreInclude: true, dreCategory: true, dreLabel: true },
    });
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/naturezas/:naturezaId/aliases', async (req, res, next) => {
  try {
    const { id, naturezaId } = req.params;
    const natOp = typeof req.body?.natOp === 'string' ? req.body.natOp.trim() : null;
    const cfopCode = typeof req.body?.cfopCode === 'string' ? req.body.cfopCode.trim() : null;
    const cfopType = req.body?.cfopType === 'IN' || req.body?.cfopType === 'OUT' ? req.body.cfopType : 'OUT';
    if (!natOp) {
      const error = new Error('natOp é obrigatório');
      error.status = 400;
      throw error;
    }
    const created = await prisma.naturezaOperacaoAlias.create({
      data: {
        companyId: id,
        natOp,
        cfopCode: cfopCode ?? '',
        cfopType,
        targetNaturezaOperacaoId: naturezaId,
      },
      select: { id: true, natOp: true, cfopCode: true, cfopType: true },
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/naturezas/:naturezaId/aliases/:aliasId', async (req, res, next) => {
  try {
    const { aliasId } = req.params;
    await prisma.naturezaOperacaoAlias.delete({
      where: { id: aliasId },
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const rawCnpj = req.body?.cnpj;
    const normalizedCnpj = normalizeCnpj(rawCnpj);

    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    if (normalizedCnpj.length !== 14) {
      return res.status(400).json({ error: 'CNPJ inválido' });
    }

    const formattedCnpj = formatCnpj(normalizedCnpj);

    const company = await prisma.company.create({
      data: {
        name,
        cnpj: formattedCnpj,
      },
      select: {
        id: true,
        name: true,
        cnpj: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({ item: company });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Empresa já cadastrada' });
    }
    next(error);
  }
});

router.get('/:id/summary', async (req, res, next) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        cnpj: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const { summary, period, recentInvoices, monthlyTotals, cfopBreakdown } = await buildCompanySummary(id);

    res.status(200).json({
      company,
      summary,
      period,
      recentInvoices,
      monthlyTotals,
      cfopBreakdown,
      productOverview: await buildProductOverview(id),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/reports/warehouse-general', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const fromDate = parseOptionalSinceDate(from);
    const toDate = parseOptionalEndDate(to);

    if (fromDate && toDate && toDate < fromDate) {
      return res.status(400).json({ error: 'Parâmetros de período inválidos: "from" deve ser anterior a "to".' });
    }

    const report = await buildWarehouseGeneralReport({
      companyId: id,
      from: fromDate,
      to: toDate,
    });

    res.status(200).json({
      company,
      report,
    });
  } catch (error) {
    next(error);
  }
});


router.get('/:id/reports/warehouse-general.pdf', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to, mode: modeParam } = req.query;

    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, cnpj: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const fromDate = parseOptionalSinceDate(from);
    const toDate = parseOptionalEndDate(to);
    const mode = String(modeParam ?? 'fiscal').toLowerCase() === 'gerencial' ? 'gerencial' : 'fiscal';

    if (fromDate && toDate && toDate < fromDate) {
      return res.status(400).json({ error: 'Parâmetros de período inválidos: "from" deve ser anterior a "to".' });
    }

    const report = await buildWarehouseGeneralReport({
      companyId: id,
      from: fromDate,
      to: toDate,
    });

    const totalInvoices = report.groups.reduce((acc, group) => acc + group.remessas.length + group.retornos.length, 0);
    const outstandingEvents = report.mismatches.length;
    const conciliationPercent = totalInvoices > 0
      ? Math.max(0, ((totalInvoices - outstandingEvents) / totalInvoices) * 100)
      : 100;
    const inconsistentTotal = report.mismatches.reduce((acc, item) => {
      const numeric = Number(item.totalValue ?? item.deltaValue ?? 0);
      return acc + (Number.isFinite(numeric) ? Math.abs(numeric) : 0);
    }, 0);

    const logoPath = process.env.REPORT_LOGO_PATH ? path.resolve(process.env.REPORT_LOGO_PATH) : null;

    const filename = `warehouse-general-report-${mode}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200);

    return generateWarehouseReportPdf({
      res,
      company: {
        name: company.name,
        cnpj: formatCnpj(normalizeCnpj(company.cnpj ?? '')) || '--',
      },
      report,
      filters: {
        from: report.filters?.from ?? (fromDate ? fromDate.toISOString() : null),
        to: report.filters?.to ?? (toDate ? toDate.toISOString() : null),
      },
      mode,
      totals: {
        totalInvoices,
        conciliationPercent,
        inconsistentTotal,
      },
      assets: {
        logoPath,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/reports/unconditional-discounts', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    const fromDate = parseOptionalSinceDate(from);
    const toDate = parseOptionalEndDate(to);

    if (fromDate && toDate && toDate < fromDate) {
      return res.status(400).json({ error: 'Parâmetros de período inválidos: "from" deve ser anterior a "to".' });
    }

    const report = await buildUnconditionalDiscountReport({
      companyId: id,
      from: fromDate,
      to: toDate,
    });

    res.status(200).json({ report });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    return next(error);
  }
});

router.get('/:id/reports/unconditional-discounts.csv', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    const fromDate = parseOptionalSinceDate(from);
    const toDate = parseOptionalEndDate(to);

    if (fromDate && toDate && toDate < fromDate) {
      return res.status(400).json({ error: 'Parâmetros de período inválidos: "from" deve ser anterior a "to".' });
    }

    const report = await buildUnconditionalDiscountReport({
      companyId: id,
      from: fromDate,
      to: toDate,
    });

    const fromLabel = report.filters?.from ? report.filters.from.slice(0, 10) : 'inicio';
    const toLabel = report.filters?.to ? report.filters.to.slice(0, 10) : 'data';
    const filename = `descontos-incondicionais-${fromLabel}-a-${toLabel}.csv`;
    const csvContent = generateUnconditionalDiscountCsv(report);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    return next(error);
  }
});

router.post('/:id/reprocess-cfop', async (req, res, next) => {
  if (!CFOP_REPROCESS_ENABLED) {
    return res.status(404).json({ error: 'Recurso não disponível.' });
  }

  try {
    const { id } = req.params;
    const mode = req.body?.mode === 'commit' ? 'commit' : 'dry-run';
    const batchSizeRaw = req.body?.batchSize;
    const batchSize = Number.isFinite(batchSizeRaw) ? batchSizeRaw : Number.parseInt(batchSizeRaw, 10);
    const since = parseOptionalSinceDate(req.body?.since ?? null);
    const onlyMissing = Boolean(req.body?.onlyMissing);
    const actorId = req.body?.actorId ?? req.get('x-actor-id') ?? null;

    const summary = await reprocessCompanyCfops({
      companyId: id,
      mode,
      batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
      since,
      onlyMissing,
      actorId,
    });

    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/naturezas/merge', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const targetNaturezaOperacaoId = typeof body.targetNaturezaOperacaoId === 'string' ? body.targetNaturezaOperacaoId : null;
    const sourceNaturezaOperacaoIds = Array.isArray(body.sourceNaturezaOperacaoIds)
      ? body.sourceNaturezaOperacaoIds.filter((value) => typeof value === 'string')
      : [];
    const sourceNatOps = Array.isArray(body.sourceNatOps)
      ? body.sourceNatOps.filter((value) => typeof value === 'string')
      : [];
    const actorId = body.actorId ?? req.get('x-actor-id') ?? null;

    const result = await mergeNaturezas({
      companyId: id,
      targetNaturezaOperacaoId,
      sourceNaturezaOperacaoIds,
      sourceNatOps,
      actorId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Remapeamento completo: move itens/notas da origem para destino
router.post('/:id/naturezas/remap', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const targetNaturezaOperacaoId = typeof body.targetNaturezaOperacaoId === 'string' ? body.targetNaturezaOperacaoId : null;
    const sourceNaturezaOperacaoIds = Array.isArray(body.sourceNaturezaOperacaoIds)
      ? body.sourceNaturezaOperacaoIds.filter((value) => typeof value === 'string')
      : [];
    const sourceNatOps = Array.isArray(body.sourceNatOps)
      ? body.sourceNatOps.filter((value) => typeof value === 'string')
      : [];

    if (!targetNaturezaOperacaoId) {
      const err = new Error('Destino (targetNaturezaOperacaoId) é obrigatório.');
      err.status = 400;
      throw err;
    }
    if (sourceNaturezaOperacaoIds.length === 0 && sourceNatOps.length === 0) {
      const err = new Error('Informe ao menos uma natureza de origem ou NatOp bruta.');
      err.status = 400;
      throw err;
    }

    const target = await prisma.naturezaOperacao.findFirst({
      where: { id: targetNaturezaOperacaoId, companyId: id },
      select: {
        id: true,
        natOp: true,
        descricao: true,
        cfopCode: true,
        cfopType: true,
        isSelfIssuedEntrada: true,
      },
    });
    if (!target) {
      const err = new Error('Natureza destino não encontrada.');
      err.status = 404;
      throw err;
    }

    const sanitizedNatOps = [...new Set(sourceNatOps.map((n) => sanitizeNatOp(n)).filter(Boolean))];

    const sourceNaturezas = sourceNaturezaOperacaoIds.length
      ? await prisma.naturezaOperacao.findMany({
          where: { companyId: id, id: { in: sourceNaturezaOperacaoIds } },
          select: { id: true, natOp: true },
        })
      : [];

    sourceNaturezas.forEach((natureza) => {
      const nat = sanitizeNatOp(natureza.natOp);
      if (nat) sanitizedNatOps.push(nat);
    });

    const natOpsLower = [...new Set(sanitizedNatOps.map((n) => n.toLowerCase()))];

    const invoiceFilter = {
      companyId: id,
      OR: [
        ...(sourceNaturezaOperacaoIds.length ? [{ naturezaOperacaoId: { in: sourceNaturezaOperacaoIds } }] : []),
        ...(natOpsLower.length
          ? [
              {
                natOp: {
                  in: natOpsLower,
                  mode: 'insensitive',
                },
              },
            ]
          : []),
      ],
    };

    const result = await prisma.$transaction(async (tx) => {
      let aliasesConfigured = 0;

      if (target.cfopCode && target.cfopType) {
        for (const natOp of natOpsLower) {
          await tx.naturezaOperacaoAlias.upsert({
            where: {
              companyId_cfopCode_natOp_cfopType_isSelfIssuedEntrada: {
                companyId: id,
                cfopCode: target.cfopCode,
                natOp,
                cfopType: target.cfopType,
                isSelfIssuedEntrada: target.isSelfIssuedEntrada ?? false,
              },
            },
            update: {
              targetNaturezaOperacaoId: target.id,
            },
            create: {
              companyId: id,
              cfopCode: target.cfopCode,
              natOp,
              cfopType: target.cfopType,
              isSelfIssuedEntrada: target.isSelfIssuedEntrada ?? false,
              targetNaturezaOperacaoId: target.id,
            },
          });
          aliasesConfigured += 1;
        }
      }

      const updatedInvoices = await tx.invoice.updateMany({
        where: invoiceFilter,
        data: {
          naturezaOperacaoId: target.id,
          natOp: target.natOp ?? null,
          cfop: target.cfopCode ?? null,
        },
      });

      const invoiceIds = await tx.invoice
        .findMany({ where: invoiceFilter, select: { id: true } })
        .then((rows) => rows.map((row) => row.id));

      let itemsUpdated = 0;
      if (invoiceIds.length) {
        const items = await tx.invoiceItem.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: { id: true, cfopCode: true },
        });

        for (const item of items) {
          await tx.invoiceItem.update({
            where: { id: item.id },
            data: {
              cfopDescription: target.descricao ?? null,
              cfopComposite: buildCfopCompositeFromNatOp(target.cfopCode || item.cfopCode, target.descricao),
            },
          });
        }
        itemsUpdated = items.length;
      }

      return {
        updatedInvoices: updatedInvoices.count,
        itemsUpdated,
        aliasesConfigured,
      };
    });

    res.status(200).json({
      ...result,
      targetNaturezaOperacaoId,
      sourceNaturezaOperacaoIds,
      sourceNatOps: natOpsLower,
    });
  } catch (error) {
    next(error);
  }
});

// Reprocessa campos fiscais no item (preenche novos campos com base nos já armazenados)
router.post('/:id/reprocess-item-taxes', async (req, res, next) => {
  try {
    const { id } = req.params;
    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      const error = new Error('Empresa não encontrada.');
      error.status = 404;
      throw error;
    }

    const items = await prisma.invoiceItem.findMany({
      where: { invoice: { companyId: id } },
      select: {
        id: true,
        icmsValue: true,
        ipiValue: true,
        pisValue: true,
        cofinsValue: true,
        vBC: true,
        vICMS: true,
        vICMSDeson: true,
        vBCST: true,
        vST: true,
        vTotTrib: true,
      },
    });

    let updated = 0;
    for (const item of items) {
      const vICMS = item.vICMS ?? item.icmsValue ?? null;
      const vTotTrib =
        item.vTotTrib ??
        (item.icmsValue || item.ipiValue || item.pisValue || item.cofinsValue
          ? Number(item.icmsValue ?? 0) + Number(item.ipiValue ?? 0) + Number(item.pisValue ?? 0) + Number(item.cofinsValue ?? 0)
          : null);

      const needsUpdate =
        item.vBC == null ||
        item.vICMS == null ||
        item.vTotTrib == null;

      if (!needsUpdate) continue;

      await prisma.invoiceItem.update({
        where: { id: item.id },
        data: {
          vBC: item.vBC ?? null,
          vICMS,
          vICMSDeson: item.vICMSDeson ?? null,
          vBCST: item.vBCST ?? null,
          vST: item.vST ?? null,
          vTotTrib,
        },
      });
      updated += 1;
    }

    res.status(200).json({ updated, total: items.length });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/naturezas', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const natOp = typeof body.natOp === 'string' ? body.natOp.trim() : null;
    const descricao = typeof body.descricao === 'string' ? body.descricao.trim() : natOp;
    const cfopCode = typeof body.cfopCode === 'string' ? body.cfopCode.trim() : null;
    const cfopType = body.cfopType === 'IN' || body.cfopType === 'OUT' ? body.cfopType : 'OUT';
    const includeInReports = typeof body.includeInReports === 'boolean' ? body.includeInReports : true;

    if (!natOp) {
      const error = new Error('natOp é obrigatório');
      error.status = 400;
      throw error;
    }
    if (!cfopCode) {
      const error = new Error('cfopCode é obrigatório');
      error.status = 400;
      throw error;
    }

    const created = await prisma.naturezaOperacao.create({
      data: {
        companyId: id,
        natOp,
        descricao: descricao ?? natOp,
        cfopCode,
        cfopType,
        includeInReports,
      },
      select: {
        id: true,
        natOp: true,
        descricao: true,
        cfopCode: true,
        cfopType: true,
        includeInReports: true,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/naturezas', async (req, res, next) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const natureRows = await prisma.$queryRaw`
      WITH base AS (
        SELECT
          i."id" AS invoice_id,
          COALESCE(n."id", CONCAT('legacy:', COALESCE(TRIM(i."natOp"), ''), '::', COALESCE(i."cfop", ii."cfopCode"))) AS natureza_key,
          n."id" AS natureza_operacao_id,
          COALESCE(n."natOp", TRIM(i."natOp")) AS nat_op,
          COALESCE(n."descricao", TRIM(i."natOp")) AS descricao,
          COALESCE(n."cfopCode", i."cfop", ii."cfopCode") AS cfop_code,
          COALESCE(n."cfopType", i."type") AS cfop_type,
          COALESCE(n."isSelfIssuedEntrada", false) AS is_self_issued,
          COALESCE(n."includeInReports", true) AS include_in_reports,
          ii."id" AS item_id,
          ii."gross" AS gross
        FROM "Invoice" i
        INNER JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
        LEFT JOIN "NaturezaOperacao" n ON n."id" = i."naturezaOperacaoId"
        WHERE i."companyId" = ${id}
      )
      SELECT
        natureza_key,
        natureza_operacao_id,
        nat_op,
        descricao,
        cfop_code,
        cfop_type,
        is_self_issued,
        include_in_reports,
        COUNT(DISTINCT invoice_id) AS invoice_count,
        COUNT(item_id) AS item_count,
        COALESCE(SUM(gross), 0) AS gross_total
      FROM base
      GROUP BY
        natureza_key,
        natureza_operacao_id,
        nat_op,
        descricao,
        cfop_code,
        cfop_type,
        is_self_issued,
        include_in_reports
      ORDER BY descricao ASC NULLS LAST, cfop_code ASC NULLS LAST;
    `;

    const manualNaturezas = await prisma.naturezaOperacao.findMany({
      where: { companyId: id },
      select: {
        id: true,
        natOp: true,
        descricao: true,
        cfopCode: true,
        cfopType: true,
        isSelfIssuedEntrada: true,
        includeInReports: true,
      },
    });

    const aliasRows = await prisma.naturezaOperacaoAlias.findMany({
      where: { companyId: id },
      select: {
        id: true,
        natOp: true,
        cfopCode: true,
        cfopType: true,
        targetNaturezaOperacaoId: true,
        targetNaturezaOperacao: {
          select: {
            id: true,
            natOp: true,
            descricao: true,
          },
        },
      },
    });

    const aliasMap = new Map();
    aliasRows.forEach((alias) => {
      if (!alias.targetNaturezaOperacaoId) {
        return;
      }
      const list = aliasMap.get(alias.targetNaturezaOperacaoId) ?? [];
      if (!list.includes(alias.natOp)) {
        list.push(alias.natOp);
      }
      aliasMap.set(alias.targetNaturezaOperacaoId, list);
    });

    const items = natureRows.map((row) => {
      const naturezaOperacaoId = row.natureza_operacao_id ? String(row.natureza_operacao_id) : null;
      const cfopType = row.cfop_type === 'IN' ? 'IN' : 'OUT';
      const aliasNatOps = naturezaOperacaoId ? aliasMap.get(naturezaOperacaoId) ?? [] : [];
      const naturezaKey = String(row.natureza_key ?? (naturezaOperacaoId ?? 'legacy'));
      const descricao = row.descricao ? String(row.descricao).trim() || null : null;
      const natOp = row.nat_op ? String(row.nat_op).trim() || null : null;

      return {
        naturezaOperacaoId,
        naturezaKey,
        natOp,
        descricao,
        cfopCode: row.cfop_code ? String(row.cfop_code).trim() || null : null,
        cfopType,
        isSelfIssuedEntrada: Boolean(row.is_self_issued),
        invoiceCount: Number(row.invoice_count ?? 0),
        itemCount: Number(row.item_count ?? 0),
        grossTotal: toPlainDecimal(row.gross_total ?? '0'),
        aliasNatOps,
        isLegacy: naturezaOperacaoId == null,
        includeInReports: Boolean(row.include_in_reports ?? true),
      };
    });

    manualNaturezas.forEach((manual) => {
      const exists = items.some((item) => item.naturezaOperacaoId === manual.id);
      if (!exists) {
        items.push({
          naturezaOperacaoId: manual.id,
          naturezaKey: manual.id,
          natOp: manual.natOp,
          descricao: manual.descricao,
          cfopCode: manual.cfopCode,
          cfopType: manual.cfopType,
          isSelfIssuedEntrada: manual.isSelfIssuedEntrada,
          invoiceCount: 0,
          itemCount: 0,
          grossTotal: '0',
          aliasNatOps: aliasMap.get(manual.id) ?? [],
          isLegacy: false,
          includeInReports: manual.includeInReports,
        });
      }
    });

    const aliases = aliasRows.map((alias) => ({
      id: alias.id,
      natOp: alias.natOp,
      cfopCode: alias.cfopCode,
      cfopType: alias.cfopType,
      targetNaturezaOperacaoId: alias.targetNaturezaOperacaoId,
      targetNatOp: alias.targetNaturezaOperacao?.natOp ?? null,
      targetDescricao: alias.targetNaturezaOperacao?.descricao ?? null,
    }));

    res.status(200).json({
      company,
      items,
      aliases,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/cfop-usage', async (req, res, next) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const usageRows = await prisma.$queryRaw`
      WITH base AS (
        SELECT
          i."id" AS invoice_id,
          i."type" AS invoice_type,
          COALESCE(n."id", CONCAT('legacy:', COALESCE(TRIM(i."natOp"), ''), '::', COALESCE(i."cfop", ii."cfopCode"))) AS natureza_key,
          n."id" AS natureza_operacao_id,
          COALESCE(n."natOp", TRIM(i."natOp")) AS nat_op,
          COALESCE(n."descricao", TRIM(i."natOp")) AS descricao,
          COALESCE(n."cfopCode", i."cfop", ii."cfopCode") AS cfop_code,
          COALESCE(n."cfopType", i."type") AS cfop_type,
          COALESCE(n."isSelfIssuedEntrada", false) AS is_self_issued,
          ii."id" AS item_id,
          ii."gross" AS gross
        FROM "Invoice" i
        INNER JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
        LEFT JOIN "NaturezaOperacao" n ON n."id" = i."naturezaOperacaoId"
        WHERE i."companyId" = ${id}
      )
      SELECT
        natureza_key,
        natureza_operacao_id,
        nat_op,
        descricao,
        cfop_code,
        cfop_type,
        is_self_issued,
        invoice_type,
        COUNT(DISTINCT invoice_id) AS invoice_count,
        COUNT(item_id) AS item_count,
        COALESCE(SUM(gross), 0) AS gross_total
      FROM base
      GROUP BY
        natureza_key,
        natureza_operacao_id,
        nat_op,
        descricao,
        cfop_code,
        cfop_type,
        is_self_issued,
        invoice_type
      ORDER BY gross_total DESC;
    `;

    const rules = await prisma.cfopRule.findMany({
      where: { companyId: id },
      select: {
        cfopCode: true,
        type: true,
        description: true,
        icmsRate: true,
        ipiRate: true,
        pisRate: true,
        cofinsRate: true,
        funruralRate: true,
        updatedAt: true,
      },
    });

    const ruleMap = new Map();
    rules.forEach((rule) => {
      const key = `${rule.cfopCode}::${rule.type}`;
      ruleMap.set(key, {
        description: rule.description ?? null,
        icmsRate: toPlainDecimal(rule.icmsRate),
        ipiRate: toPlainDecimal(rule.ipiRate),
        pisRate: toPlainDecimal(rule.pisRate),
        cofinsRate: toPlainDecimal(rule.cofinsRate),
        funruralRate: toPlainDecimal(rule.funruralRate),
        updatedAt: rule.updatedAt.toISOString(),
        type: rule.type,
      });
    });

    const items = usageRows.map((row) => {
      const cfopCode = row.cfop_code ?? null;
      const grossTotal = toPlainDecimal(row.gross_total ?? '0');
      const invoiceCount = Number(row.invoice_count ?? 0);
      const itemCount = Number(row.item_count ?? 0);
      const type = row.invoice_type === 'IN' ? 'IN' : 'OUT';
      const key = `${cfopCode ?? ''}::${type}`;
      const ruleForKey = ruleMap.get(key) ?? null;
      const descricao = row.descricao ? String(row.descricao).trim() || null : null;
      const composite = (() => {
        if (cfopCode) {
          return descricao ? `${cfopCode} - ${descricao}` : cfopCode;
        }
        return descricao;
      })();

      return {
        naturezaOperacaoId: row.natureza_operacao_id ?? null,
        naturezaKey: row.natureza_key,
        natOp: row.nat_op ?? null,
        descricao,
        cfopCode,
        type,
        invoiceCount,
        itemCount,
        grossTotal,
        cfopComposite: composite,
        cfopDescription: descricao,
        rule: ruleForKey,
      };
    });

    let lastReprocessBatch = null;
    try {
      lastReprocessBatch = await prisma.reprocessBatch.findFirst({
        where: { companyId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2021' || err.code === 'P2022')
      ) {
        lastReprocessBatch = null;
      } else {
        throw err;
      }
    }

    res.status(200).json({
      company,
      items,
      reprocess: {
        enabled: CFOP_REPROCESS_ENABLED,
        lastBatchId: lastReprocessBatch?.id ?? null,
        lastBatchStatus: lastReprocessBatch?.status ?? null,
        lastBatchCreatedAt: lastReprocessBatch?.createdAt?.toISOString() ?? null,
        lastBatchStartedAt: lastReprocessBatch?.startedAt?.toISOString() ?? null,
        lastBatchFinishedAt: lastReprocessBatch?.finishedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/cfop-rules/:cfopCode', async (req, res, next) => {
  try {
    const { id, cfopCode } = req.params;
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    if (!cfopCode) {
      return res.status(400).json({ error: 'cfopCode é obrigatório' });
    }

    const description = req.body?.description?.toString()?.trim() || null;
    const rawType = req.body?.type;
    const normalizedType = typeof rawType === 'string' ? rawType.toUpperCase() : rawType;

    if (!['IN', 'OUT'].includes(normalizedType)) {
      return res.status(400).json({ error: 'Campo type deve ser IN ou OUT' });
    }

    const data = {
      description,
      icmsRate: parseOptionalDecimal(req.body?.icmsRate, 'ICMS'),
      ipiRate: parseOptionalDecimal(req.body?.ipiRate, 'IPI'),
      pisRate: parseOptionalDecimal(req.body?.pisRate, 'PIS'),
      cofinsRate: parseOptionalDecimal(req.body?.cofinsRate, 'COFINS'),
      funruralRate: parseOptionalDecimal(req.body?.funruralRate, 'Funrural'),
      type: normalizedType,
    };

    await prisma.cfop.upsert({
      where: { code: cfopCode },
      update: {},
      create: { code: cfopCode },
    });

    const rule = await prisma.cfopRule.upsert({
      where: {
        companyId_cfopCode_type: {
          companyId: id,
          cfopCode,
          type: normalizedType,
        },
      },
      update: data,
      create: {
        companyId: id,
        cfopCode,
        ...data,
      },
      select: {
        cfopCode: true,
        type: true,
        description: true,
        icmsRate: true,
        ipiRate: true,
        pisRate: true,
        cofinsRate: true,
        funruralRate: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      cfopCode: rule.cfopCode,
      type: rule.type,
      description: rule.description ?? null,
      icmsRate: toPlainDecimal(rule.icmsRate),
      ipiRate: toPlainDecimal(rule.ipiRate),
      pisRate: toPlainDecimal(rule.pisRate),
      cofinsRate: toPlainDecimal(rule.cofinsRate),
      funruralRate: toPlainDecimal(rule.funruralRate),
      updatedAt: rule.updatedAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/products', async (req, res, next) => {
  try {
    const { id } = req.params;
    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const products = await prisma.product.findMany({
      where: { companyId: id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        type: true,
        unit: true,
        packSizeKg: true,
        rawScPerUnit: true,
        brand: true,
        line: true,
        category: true,
        ncm: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            itemMappings: true,
          },
        },
      },
    });

    res.status(200).json({ items: products });
  } catch (error) {
    next(error);
  }
});

// Conciliações de itens para um produto (para revisão de conversão)
router.get('/:id/products/:productId/mappings', async (req, res, next) => {
  try {
    const { id, productId } = req.params;
    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const searchRaw = req.query.search ? String(req.query.search).trim() : '';

    const where = {
      productId,
      invoiceItem: {
        invoice: {
          companyId: id,
          ...(from || to
            ? {
                emissao: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
          ...(searchRaw
            ? {
                OR: [
                  { chave: { contains: searchRaw, mode: 'insensitive' } },
                  { numero: { contains: searchRaw, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
    };

    const mappings = await prisma.invoiceItemProductMapping.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        convertedQty: true,
        conversionFactor: true,
        notes: true,
        createdAt: true,
        invoiceItem: {
          select: {
            id: true,
            qty: true,
            unit: true,
            gross: true,
            description: true,
            cfopCode: true,
            ncm: true,
            invoice: {
              select: {
                id: true,
                chave: true,
                numero: true,
                emissao: true,
                type: true,
              },
            },
          },
        },
      },
    });

    res.status(200).json({ items: mappings });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/products/:productId/mappings/:mappingId', async (req, res, next) => {
  try {
    const { id, productId, mappingId } = req.params;
    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const conversionFactor =
      req.body?.conversionFactor != null ? new Prisma.Decimal(req.body.conversionFactor) : null;
    const convertedQty =
      req.body?.convertedQty != null ? new Prisma.Decimal(req.body.convertedQty) : null;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

    const mapping = await prisma.invoiceItemProductMapping.findFirst({
      where: {
        id: mappingId,
        productId,
        invoiceItem: { invoice: { companyId: id } },
      },
      select: { id: true },
    });
    if (!mapping) {
      return res.status(404).json({ error: 'Mapeamento não encontrado' });
    }

    const updated = await prisma.invoiceItemProductMapping.update({
      where: { id: mappingId },
      data: {
        conversionFactor,
        convertedQty,
        notes: notes || null,
      },
      select: {
        id: true,
        conversionFactor: true,
        convertedQty: true,
        notes: true,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/products', async (req, res, next) => {
  try {
    const { id } = req.params;
    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const requestedType = req.body?.type?.toString()?.toUpperCase();
    const normalizedType = requestedType === 'FINISHED' ? 'FINISHED' : 'RAW';
    const packSizeDecimal = parseNonNegativeDecimal(req.body?.packSizeKg, 'packSizeKg');
    const rawScPerUnitDecimal = parseNonNegativeDecimal(req.body?.rawScPerUnit, 'rawScPerUnit');

    const payload = {
      companyId: id,
      name,
      sku: req.body?.sku?.toString()?.trim() || null,
      description: req.body?.description?.toString()?.trim() || null,
      unit: req.body?.unit?.toString()?.trim() || null,
      ncm: req.body?.ncm?.toString()?.trim() || null,
      type: normalizedType,
      packSizeKg: packSizeDecimal,
      rawScPerUnit: rawScPerUnitDecimal,
      brand: req.body?.brand?.toString()?.trim() || null,
      line: req.body?.line?.toString()?.trim() || null,
      category: req.body?.category?.toString()?.trim() || null,
    };

    const product = await prisma.product.create({
      data: payload,
      select: {
        id: true,
        name: true,
        sku: true,
        type: true,
        description: true,
        unit: true,
        packSizeKg: true,
        rawScPerUnit: true,
        brand: true,
        line: true,
        category: true,
        ncm: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({ item: product });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Produto já cadastrado para esta empresa' });
    }
    next(error);
  }
});

router.patch('/:id/products/:productId', async (req, res, next) => {
  try {
    const { id, productId } = req.params;

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, companyId: true },
    });

    if (!existing || existing.companyId !== id) {
      return res.status(404).json({ error: 'Produto não encontrado para esta empresa' });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'name')) {
      const name = String(req.body.name ?? '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
      }
      updates.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'sku')) {
      updates.sku = req.body?.sku?.toString()?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'unit')) {
      updates.unit = req.body?.unit?.toString()?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ncm')) {
      updates.ncm = req.body?.ncm?.toString()?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'description')) {
      updates.description = req.body?.description?.toString()?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'type')) {
      const requestedType = req.body?.type?.toString()?.toUpperCase();
      if (requestedType !== 'RAW' && requestedType !== 'FINISHED') {
        return res.status(400).json({ error: 'Tipo inválido. Use RAW ou FINISHED.' });
      }
      updates.type = requestedType;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'packSizeKg')) {
      updates.packSizeKg = parseNonNegativeDecimal(req.body?.packSizeKg, 'packSizeKg');
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'rawScPerUnit')) {
      updates.rawScPerUnit = parseNonNegativeDecimal(req.body?.rawScPerUnit, 'rawScPerUnit');
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'brand')) {
      updates.brand = req.body?.brand?.toString()?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'line')) {
      updates.line = req.body?.line?.toString()?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'category')) {
      updates.category = req.body?.category?.toString()?.trim() || null;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nenhum campo válido informado para atualização.' });
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: updates,
      select: {
        id: true,
        name: true,
        sku: true,
        type: true,
        unit: true,
        packSizeKg: true,
        rawScPerUnit: true,
        brand: true,
        line: true,
        category: true,
        ncm: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ item: product });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/inventory-openings', async (req, res, next) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const items = await loadInventoryOpenings(id);
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/inventory-openings', async (req, res, next) => {
  try {
    const { id } = req.params;
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;

    if (!entries || !entries.length) {
      return res.status(400).json({ error: 'Informe ao menos um registro em entries.' });
    }

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const productIds = [...new Set(entries.map((entry) => entry?.productId).filter(Boolean))];
    if (!productIds.length) {
      return res.status(400).json({ error: 'Cada registro deve informar productId válido.' });
    }

    const products = await prisma.product.findMany({
      where: { companyId: id, id: { in: productIds } },
      select: { id: true },
    });
    const validProducts = new Set(products.map((product) => product.id));
    const missingProducts = productIds.filter((productId) => !validProducts.has(productId));
    if (missingProducts.length) {
      return res.status(404).json({
        error: 'Alguns produtos não foram encontrados para esta empresa.',
        details: { missingProductIds: missingProducts },
      });
    }

    const operations = [];

    for (const entry of entries) {
      const productId = entry?.productId;
      if (!productId || !validProducts.has(productId)) {
        continue;
      }

      const scEquivalent = parseNonNegativeDecimal(entry?.scEquivalent, 'scEquivalent');
      const totalValue = parseNonNegativeDecimal(entry?.totalValue, 'totalValue');
      const qtyNative = parseNonNegativeDecimal(entry?.qtyNative, 'qtyNative');
      const notes = entry?.notes != null ? String(entry.notes).trim() || null : null;

      const shouldDelete = !scEquivalent || scEquivalent.isZero();

      if (shouldDelete) {
        operations.push(
          prisma.inventoryOpening.deleteMany({
            where: { companyId: id, productId },
          })
        );
        continue;
      }

      if (!totalValue || totalValue.isZero()) {
        const error = new Error('Valor total deve ser maior que zero para o estoque inicial.');
        error.status = 400;
        throw error;
      }

      let unitCost = parseNonNegativeDecimal(entry?.unitCost, 'unitCost');
      if (!unitCost || unitCost.isZero()) {
        unitCost = totalValue.div(scEquivalent);
      }

      const date = parseInventoryOpeningDate(entry?.date);

      operations.push(
        prisma.inventoryOpening.upsert({
          where: { companyId_productId: { companyId: id, productId } },
          update: {
            date,
            qtyNative,
            scEquivalent,
            totalValue,
            unitCost,
            notes,
          },
          create: {
            companyId: id,
            productId,
            date,
            qtyNative,
            scEquivalent,
            totalValue,
            unitCost,
            notes,
          },
        })
      );
    }

    if (!operations.length) {
      const items = await loadInventoryOpenings(id);
      return res.status(200).json({ items });
    }

    await prisma.$transaction(operations);

    const items = await loadInventoryOpenings(id);
    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/inventory-openings/:productId', async (req, res, next) => {
  try {
    const { id, productId } = req.params;

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    await prisma.inventoryOpening.deleteMany({ where: { companyId: id, productId } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/:id/products/preview', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cfop, search, type, mapped } = req.body ?? {};
    const normalizedType = typeof type === 'string' ? String(type).toUpperCase() : 'ALL';
    const mappedFilter = typeof mapped === 'boolean' ? mapped : null;

    const whereClause = {
      invoice: {
        companyId: id,
        ...(normalizedType !== 'ALL'
          ? {
              type: normalizedType === 'IN' ? 'IN' : 'OUT',
            }
          : {}),
      },
      ...(cfop ? { cfopCode: cfop } : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              { productCode: { contains: search, mode: 'insensitive' } },
              { ncm: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(mappedFilter === true ? { productMapping: { isNot: null } } : {}),
      ...(mappedFilter === false ? { productMapping: { is: null } } : {}),
    };

    const items = await prisma.invoiceItem.findMany({
      where: whereClause,
      select: {
        id: true,
        invoiceId: true,
        cfopCode: true,
        ncm: true,
        productCode: true,
        description: true,
        unit: true,
        qty: true,
        unitPrice: true,
        gross: true,
        productMapping: {
          select: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            notes: true,
          },
        },
        invoice: {
          select: {
            emissao: true,
            type: true,
            issuerCnpj: true,
            recipientCnpj: true,
            chave: true,
          },
        },
      },
      take: 100,
    });

    res.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/products/map', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { invoiceItemId, productId, notes, convertedQty } = req.body ?? {};

    if (!invoiceItemId || !productId) {
      return res.status(400).json({ error: 'invoiceItemId e productId são obrigatórios' });
    }

    const invoiceItem = await prisma.invoiceItem.findUnique({
      where: { id: invoiceItemId },
      select: {
        qty: true,
        unit: true,
        description: true,
        invoice: { select: { companyId: true } },
      },
    });

    if (!invoiceItem || invoiceItem.invoice.companyId !== id) {
      return res.status(404).json({ error: 'Item não encontrado para esta empresa' });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { companyId: true, unit: true },
    });

    if (!product || product.companyId !== id) {
      return res.status(404).json({ error: 'Produto não encontrado para esta empresa' });
    }

    const parsedConvertedQty = parseOptionalDecimal(convertedQty, 'quantidade convertida');
    if (parsedConvertedQty && parsedConvertedQty.lte(0)) {
      return res.status(400).json({ error: 'Quantidade convertida deve ser maior que zero' });
    }

    const invoiceUnit = normalizeUnit(invoiceItem.unit);
    const productUnit = normalizeUnit(product.unit);
    const unitsMismatch = invoiceUnit && productUnit && invoiceUnit !== productUnit;
    if (unitsMismatch && !parsedConvertedQty) {
      return res.status(400).json({
        error: `Unidade do item (${invoiceItem.unit || 'não informada'}) é incompatível com a unidade do produto (${product.unit || 'não informada'}).` ,
      });
    }

    const invoiceQty = new Prisma.Decimal(invoiceItem.qty ?? 0);
    const multiplier = parsedConvertedQty && !invoiceQty.isZero()
      ? parsedConvertedQty.div(invoiceQty)
      : null;
    const conversionFactor = parsedConvertedQty && !invoiceQty.isZero()
      ? invoiceQty.div(parsedConvertedQty)
      : null;

    const mapping = await prisma.invoiceItemProductMapping.upsert({
      where: { invoiceItemId },
      update: {
        productId,
        notes: notes?.toString()?.trim() || null,
        convertedQty: parsedConvertedQty,
        conversionFactor,
      },
      create: {
        invoiceItemId,
        productId,
        notes: notes?.toString()?.trim() || null,
        convertedQty: parsedConvertedQty,
        conversionFactor,
      },
      select: {
        id: true,
        invoiceItemId: true,
        productId: true,
        notes: true,
        convertedQty: true,
        conversionFactor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (
      unitsMismatch &&
      parsedConvertedQty &&
      !parsedConvertedQty.isZero() &&
      invoiceUnit &&
      productUnit &&
      !invoiceQty.isZero() &&
      multiplier &&
      !multiplier.isZero()
    ) {
      const sourceUnit = invoiceUnit;
      const targetUnit = productUnit;

      try {
        await prisma.productUnitConversion.upsert({
          where: {
            companyId_productId_sourceUnit_targetUnit: {
              companyId: id,
              productId,
              sourceUnit,
              targetUnit,
            },
          },
          update: {
            multiplier,
          },
          create: {
            companyId: id,
            productId,
            sourceUnit,
            targetUnit,
            multiplier,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    }

    if (invoiceItem.description && invoiceItem.unit) {
      await upsertInvoiceItemMappingRule({
        companyId: id,
        productId,
        description: invoiceItem.description,
        unit: invoiceItem.unit,
        conversionMultiplier: multiplier,
      });
    }

    res.status(200).json({ item: mapping });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/products/unit-conversions', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { productId: rawProductId } = req.query ?? {};

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const where = { companyId: id };
    if (typeof rawProductId === 'string' && rawProductId.trim()) {
      where.productId = rawProductId;
    }

    const items = await prisma.productUnitConversion.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, unit: true } },
      },
      orderBy: [
        { product: { name: 'asc' } },
        { sourceUnit: 'asc' },
        { targetUnit: 'asc' },
      ],
    });

    res.status(200).json({ items: items.map(serializeUnitConversion) });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/products/unit-conversions', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { productId: rawProductId, sourceUnit, targetUnit, multiplier } = req.body ?? {};

    const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const normalizedSource = requireUnit(sourceUnit, 'unidade de origem');
    const normalizedTarget = requireUnit(targetUnit, 'unidade de destino');
    const multiplierValue = parseOptionalDecimal(multiplier, 'fator de conversão');
    if (!multiplierValue || multiplierValue.lte(0)) {
      const error = new Error('Fator de conversão deve ser maior que zero.');
      error.status = 400;
      throw error;
    }

    let productId = null;
    if (rawProductId && typeof rawProductId === 'string' && rawProductId.trim()) {
      const product = await prisma.product.findUnique({
        where: { id: rawProductId },
        select: { companyId: true },
      });
      if (!product || product.companyId !== id) {
        return res.status(404).json({ error: 'Produto não encontrado para esta empresa' });
      }
      productId = rawProductId;
    }

    const conversion = await prisma.productUnitConversion.create({
      data: {
        companyId: id,
        productId,
        sourceUnit: normalizedSource,
        targetUnit: normalizedTarget,
        multiplier: multiplierValue,
      },
      include: {
        product: { select: { id: true, name: true, unit: true } },
      },
    });

    res.status(201).json({ item: serializeUnitConversion(conversion) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        error: 'Já existe uma regra de conversão para essa combinação.',
      });
    }
    next(error);
  }
});

router.patch('/:id/products/unit-conversions/:conversionId', async (req, res, next) => {
  try {
    const { id, conversionId } = req.params;
    const { productId: rawProductId, sourceUnit, targetUnit, multiplier } = req.body ?? {};

    const existing = await prisma.productUnitConversion.findUnique({
      where: { id: conversionId },
      select: {
        id: true,
        companyId: true,
        productId: true,
        sourceUnit: true,
        targetUnit: true,
        multiplier: true,
        createdAt: true,
        updatedAt: true,
        product: { select: { id: true, name: true, unit: true } },
      },
    });

    if (!existing || existing.companyId !== id) {
      return res.status(404).json({ error: 'Regra de conversão não encontrada.' });
    }

    const data = {};

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'productId')) {
      if (rawProductId == null || rawProductId === '') {
        data.productId = null;
      } else if (typeof rawProductId === 'string') {
        const product = await prisma.product.findUnique({
          where: { id: rawProductId },
          select: { companyId: true },
        });
        if (!product || product.companyId !== id) {
          return res.status(404).json({ error: 'Produto não encontrado para esta empresa' });
        }
        data.productId = rawProductId;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'sourceUnit')) {
      data.sourceUnit = requireUnit(sourceUnit, 'unidade de origem');
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'targetUnit')) {
      data.targetUnit = requireUnit(targetUnit, 'unidade de destino');
    }

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'multiplier')) {
      const multiplierValue = parseOptionalDecimal(multiplier, 'fator de conversão');
      if (!multiplierValue || multiplierValue.lte(0)) {
        const error = new Error('Fator de conversão deve ser maior que zero.');
        error.status = 400;
        throw error;
      }
      data.multiplier = multiplierValue;
    }

    if (!Object.keys(data).length) {
      return res.status(200).json({ item: serializeUnitConversion(existing) });
    }

    const updated = await prisma.productUnitConversion.update({
      where: { id: conversionId },
      data,
      include: {
        product: { select: { id: true, name: true, unit: true } },
      },
    });

    res.status(200).json({ item: serializeUnitConversion(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({
        error: 'Já existe uma regra de conversão para essa combinação.',
      });
    }
    next(error);
  }
});

router.delete('/:id/products/unit-conversions/:conversionId', async (req, res, next) => {
  try {
    const { id, conversionId } = req.params;

    const existing = await prisma.productUnitConversion.findUnique({
      where: { id: conversionId },
      select: { id: true, companyId: true },
    });

    if (!existing || existing.companyId !== id) {
      return res.status(404).json({ error: 'Regra de conversão não encontrada.' });
    }

    await prisma.productUnitConversion.delete({ where: { id: conversionId } });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/:id/products/auto-map', async (req, res, next) => {
  try {
    const { id } = req.params;
    const payload = req.body ?? {};
    const previewMode = payload.preview === true || payload.preview === 'true';

    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const products = await prisma.product.findMany({
      where: { companyId: id },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
      },
    });

    if (!products.length) {
      return res.status(200).json({
        preview: previewMode,
        mapped: 0,
        total: 0,
        skipped: 0,
        cleaned: 0,
        conversionsApplied: 0,
        ruleMatches: 0,
        convertedTotal: '0',
        appliedMappings: [],
        reason: 'Nenhum produto cadastrado',
      });
    }

    const skuMap = new Map();
    const nameMap = new Map();
    const productInfo = new Map(products.map((product) => [product.id, product]));

    products.forEach((product) => {
      if (product.sku) {
        const key = normalizeKey(product.sku);
        if (key) {
          const list = skuMap.get(key) || [];
          list.push(product.id);
          skuMap.set(key, list);
        }
      }

      const nameKey = normalizeKey(product.name);
      if (nameKey) {
        const list = nameMap.get(nameKey) || [];
        list.push(product.id);
        nameMap.set(nameKey, list);
      }
    });

    const conversionRules = await prisma.productUnitConversion.findMany({
      where: { companyId: id },
      select: {
        id: true,
        productId: true,
        sourceUnit: true,
        targetUnit: true,
        multiplier: true,
      },
    });

    const mappingRules = await prisma.invoiceItemMappingRule.findMany({
      where: { companyId: id },
      select: {
        descriptionKey: true,
        unitKey: true,
        productId: true,
        conversionMultiplier: true,
      },
    });

    const removedMappings = await cleanupIncompatibleMappings(id);

    const productUnits = new Map(products.map((product) => [product.id, normalizeUnit(product.unit)]));

    const productConversionMap = new Map();
    const generalConversionMap = new Map();

    conversionRules.forEach((rule) => {
      const sourceUnit = normalizeUnit(rule.sourceUnit);
      const targetUnit = normalizeUnit(rule.targetUnit);
      if (!sourceUnit || !targetUnit || !rule.multiplier || rule.multiplier.isZero()) {
        return;
      }
      const payloadEntry = {
        id: rule.id,
        productId: rule.productId,
        sourceUnit,
        targetUnit,
        multiplier: rule.multiplier,
      };
      if (rule.productId) {
        const key = `${rule.productId}|${sourceUnit}|${targetUnit}`;
        productConversionMap.set(key, payloadEntry);
      } else {
        const key = `*|${sourceUnit}|${targetUnit}`;
        generalConversionMap.set(key, payloadEntry);
      }
    });

    const mappingRuleMap = new Map();
    mappingRules.forEach((rule) => {
      const key = buildMappingRuleKey(rule.descriptionKey, rule.unitKey);
      if (key) {
        mappingRuleMap.set(key, rule);
      }
    });

    const findConversionRule = (productId, sourceUnit, targetUnit) => {
      if (!sourceUnit || !targetUnit) return null;
      if (productId) {
        const specificKey = `${productId}|${sourceUnit}|${targetUnit}`;
        if (productConversionMap.has(specificKey)) {
          return productConversionMap.get(specificKey);
        }
      }
      const generalKey = `*|${sourceUnit}|${targetUnit}`;
      return generalConversionMap.get(generalKey) ?? null;
    };

    const items = await prisma.invoiceItem.findMany({
      where: {
        invoice: { companyId: id },
        productMapping: { is: null },
      },
      select: {
        id: true,
        productCode: true,
        description: true,
        unit: true,
        qty: true,
      },
    });

    let mapped = 0;
    let skipped = 0;
    let conversionsApplied = 0;
    let ruleMatches = 0;
    let convertedTotal = new Prisma.Decimal(0);
    const operations = [];
    const appliedMappings = [];

    for (const item of items) {
      const descriptionKey = normalizeKey(item.description);
      const unitKey = normalizeUnit(item.unit);

      let targetProductId = null;
      let appliedRule = null;
      let reason = null;

      const ruleKey = buildMappingRuleKey(descriptionKey, unitKey);
      if (ruleKey && mappingRuleMap.has(ruleKey)) {
        const rule = mappingRuleMap.get(ruleKey);
        if (productInfo.has(rule.productId)) {
          targetProductId = rule.productId;
          appliedRule = rule;
          reason = 'RULE';
          ruleMatches += 1;
        }
      }

      if (!targetProductId) {
        const codeKey = normalizeKey(item.productCode);
        if (!targetProductId && codeKey && skuMap.has(codeKey)) {
          const candidates = skuMap.get(codeKey) || [];
          if (candidates.length === 1) {
            targetProductId = candidates[0];
            reason = 'SKU';
          } else {
            skipped += 1;
            continue;
          }
        }
      }

      if (!targetProductId) {
        const nameKey = normalizeKey(item.description);
        if (!targetProductId && nameKey && nameMap.has(nameKey)) {
          const candidates = nameMap.get(nameKey) || [];
          if (candidates.length === 1) {
            targetProductId = candidates[0];
            reason = 'NAME';
          } else {
            skipped += 1;
            continue;
          }
        }
      }

      if (!targetProductId || !productInfo.has(targetProductId)) {
        skipped += 1;
        continue;
      }

      const invoiceQty = new Prisma.Decimal(item.qty ?? 0);
      if (invoiceQty.isZero()) {
        skipped += 1;
        continue;
      }

      const productUnit = productUnits.get(targetProductId);
      const itemUnitNormalized = normalizeUnit(item.unit);

      let convertedQty = null;
      let conversionFactor = null;
      let conversionUsed = false;

      if (productUnit && itemUnitNormalized && productUnit !== itemUnitNormalized) {
        const conversionRule = findConversionRule(targetProductId, itemUnitNormalized, productUnit);
        let multiplier = null;
        if (conversionRule) {
          multiplier = conversionRule.multiplier;
        } else if (appliedRule?.conversionMultiplier && !appliedRule.conversionMultiplier.isZero()) {
          multiplier = appliedRule.conversionMultiplier;
        }

        if (!multiplier || multiplier.isZero()) {
          skipped += 1;
          continue;
        }

        const converted = invoiceQty.mul(multiplier);
        if (converted.isZero()) {
          skipped += 1;
          continue;
        }

        convertedQty = converted;
        conversionFactor = invoiceQty.div(converted);
        conversionsApplied += 1;
        conversionUsed = true;
        convertedTotal = convertedTotal.add(converted);
      }

      operations.push({
        invoiceItemId: item.id,
        productId: targetProductId,
        convertedQty,
        conversionFactor,
        reason,
      });

      appliedMappings.push({
        invoiceItemId: item.id,
        description: item.description,
        unit: item.unit,
        productId: targetProductId,
        productName: productInfo.get(targetProductId)?.name ?? '',
        convertedQty: convertedQty ? convertedQty.toString() : null,
        conversionApplied: conversionUsed,
        reason: reason ?? (appliedRule ? 'RULE' : 'NAME'),
      });

      mapped += 1;
    }

    if (!previewMode && operations.length) {
      await prisma.$transaction(
        operations.map((operation) =>
          prisma.invoiceItemProductMapping.upsert({
            where: { invoiceItemId: operation.invoiceItemId },
            update: {
              productId: operation.productId,
              convertedQty: operation.convertedQty,
              conversionFactor: operation.conversionFactor,
            },
            create: {
              invoiceItemId: operation.invoiceItemId,
              productId: operation.productId,
              convertedQty: operation.convertedQty,
              conversionFactor: operation.conversionFactor,
            },
          })
        )
      );

      console.info('[auto-map] applied', {
        companyId: id,
        mapped,
        skipped,
        conversionsApplied,
        ruleMatches,
      });

      console.info('[auto-map] applied-items', {
        companyId: id,
        total: operations.length,
        items: operations.slice(0, 50).map((operation) => ({
          invoiceItemId: operation.invoiceItemId,
          productId: operation.productId,
          reason: operation.reason,
        })),
      });
    }

    if (previewMode) {
      console.info('[auto-map] preview', {
        companyId: id,
        mapped,
        skipped,
        conversionsApplied,
        ruleMatches,
      });
    }

    const responsePayload = {
      preview: previewMode,
      mapped,
      skipped,
      total: items.length,
      cleaned: removedMappings,
      conversionsApplied,
      ruleMatches,
      convertedTotal: conversionsApplied ? convertedTotal.toString() : '0',
      appliedMappings,
    };

    if (!previewMode) {
      responsePayload.undo = {
        invoiceItemIds: operations.map((operation) => operation.invoiceItemId),
      };
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/products/auto-map/revert', async (req, res, next) => {
  try {
    const { id } = req.params;
    const entries = Array.isArray(req.body?.invoiceItemIds) ? req.body.invoiceItemIds : [];
    const invoiceItemIds = Array.from(
      new Set(
        entries
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0),
      ),
    );

    if (!invoiceItemIds.length) {
      return res.status(400).json({ error: 'invoiceItemIds são obrigatórios.' });
    }

    const result = await prisma.invoiceItemProductMapping.deleteMany({
      where: {
        invoiceItemId: { in: invoiceItemIds },
        invoiceItem: {
          invoice: { companyId: id },
        },
      },
    });

    console.info('[auto-map] revert', {
      companyId: id,
      invoiceItemCount: invoiceItemIds.length,
      deleted: result.count,
    });

    res.status(200).json({ undone: result.count });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reset-data', async (req, res, next) => {
  try {
    const { id } = req.params;
    const company = await prisma.company.findUnique({
      where: { id },
      select: { id: true, name: true, cnpj: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const cnpjDigits = normalizeCnpj(company.cnpj);
    const expectedConfirmation = `ZERAR ${cnpjDigits}`;
    const providedConfirmation = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : '';

    if (!cnpjDigits || providedConfirmation !== expectedConfirmation) {
      return res.status(400).json({
        error: `Confirmação inválida. Digite exatamente "${expectedConfirmation}".`,
      });
    }

    const summary = await prisma.$transaction(async (tx) => {
      const counts = {
        invoices: await tx.invoice.count({ where: { companyId: id } }),
        invoiceItems: await tx.invoiceItem.count({
          where: { invoice: { companyId: id } },
        }),
        mappings: await tx.invoiceItemProductMapping.count({
          where: { invoiceItem: { invoice: { companyId: id } } },
        }),
        unitConversions: await tx.productUnitConversion.count({ where: { companyId: id } }),
        mappingRules: await tx.invoiceItemMappingRule.count({ where: { companyId: id } }),
        naturezaAliases: await tx.naturezaOperacaoAlias.count({ where: { companyId: id } }),
        naturezas: await tx.naturezaOperacao.count({ where: { companyId: id } }),
        cfopRules: await tx.cfopRule.count({ where: { companyId: id } }),
        uploadBatches: await tx.uploadBatch.count({ where: { companyId: id } }),
        reprocessBatches: await tx.reprocessBatch.count({ where: { companyId: id } }),
        cancellations: await tx.invoiceCancellation.count({ where: { companyId: id } }),
        stockMovements: await tx.stockMovement.count({ where: { companyId: id } }),
      };

      await tx.invoiceItemProductMapping.deleteMany({
        where: { invoiceItem: { invoice: { companyId: id } } },
      });
      await tx.stockMovement.deleteMany({ where: { companyId: id } });
      await tx.invoiceCancellation.deleteMany({ where: { companyId: id } });
      await tx.uploadBatch.deleteMany({ where: { companyId: id } });
      await tx.reprocessBatch.deleteMany({ where: { companyId: id } });
      await tx.invoiceItemMappingRule.deleteMany({ where: { companyId: id } });
      await tx.productUnitConversion.deleteMany({ where: { companyId: id } });
      await tx.naturezaOperacaoAlias.deleteMany({ where: { companyId: id } });
      await tx.naturezaOperacao.deleteMany({ where: { companyId: id } });
      await tx.cfopRule.deleteMany({ where: { companyId: id } });
      await tx.invoice.deleteMany({ where: { companyId: id } });

      return counts;
    });

    console.info('[company-reset]', {
      companyId: company.id,
      companyName: company.name,
      companyCnpj: company.cnpj,
      summary,
      actorId: req.user?.id ?? null,
    });

    res.status(200).json({
      message: `Dados operacionais da empresa ${company.name} foram removidos.`,
      summary,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
