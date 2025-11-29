const express = require('express');
const {
  buildConsolidatedKardexReport,
  generateKardexConsolidatedCsv,
} = require('../services/kardexConsolidatedService');
const { generateKardexConsolidatedPdf } = require('../services/kardexConsolidatedPdf');
const { generateDrePdf } = require('../services/drePdf');
const { generateDrePdfHtml } = require('../services/drePdfHtml');
const { buildTributosReport, generateTributosCsv } = require('../services/tributosReportService');
const {
  buildSalesByPeriodReport,
  generateSalesByPeriodCsv,
} = require('../services/salesByPeriodReportService');
const { generateSalesByPeriodPdf } = require('../services/salesByPeriodReportPdf');
const { buildUnconditionalDiscountReport } = require('../services/unconditionalDiscountReportService');
const { prisma } = require('../prisma');

const router = express.Router();

function parseEndDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error('Parâmetro "to" inválido. Use o formato YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  return parsed;
}

function parseStartDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error('Parâmetro "from" inválido. Use o formato YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  return parsed;
}

router.get('/kardex-consolidado', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const until = parseEndDate(req.query.to ?? null);
    const report = await buildConsolidatedKardexReport({ from, until });
    res.status(200).json({
      report,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/kardex-consolidado.csv', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const until = parseEndDate(req.query.to ?? null);
    const report = await buildConsolidatedKardexReport({ from, until });
    const csvContent = generateKardexConsolidatedCsv(report);

    const fromLabel = report.filters?.from ? report.filters.from.slice(0, 10) : '2025-01-01';
    const toLabel = report.filters?.to ? report.filters.to.slice(0, 10) : 'data';
    const filename = `kardex-consolidado-${fromLabel}-a-${toLabel}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
});

router.get('/kardex-consolidado.pdf', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const until = parseEndDate(req.query.to ?? null);
    const requestedBy = req.query?.requestedBy ? String(req.query.requestedBy) : null;
    const reference = req.query?.reference ? String(req.query.reference) : null;

    const report = await buildConsolidatedKardexReport({ from, until });
    const fromLabel = report.filters?.from ? report.filters.from.slice(0, 10) : '2025-01-01';
    const toLabel = report.filters?.to ? report.filters.to.slice(0, 10) : 'data';
    const filename = `kardex-consolidado-${fromLabel}-a-${toLabel}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200);

    await generateKardexConsolidatedPdf({
      res,
      report,
      filters: {
        from: report.filters?.from,
        to: report.filters?.to,
      },
      metadata: {
        requestedBy,
        reference,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tributos-olg', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    const report = await buildTributosReport({ from, to });
    res.status(200).json({ report });
  } catch (error) {
    next(error);
  }
});

router.get('/tributos-olg.csv', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    const report = await buildTributosReport({ from, to });
    const csvContent = generateTributosCsv(report);

    const fromLabel = report.filters?.from ? report.filters.from.slice(0, 10) : 'inicio';
    const toLabel = report.filters?.to ? report.filters.to.slice(0, 10) : 'fim';
    const filename = `tributos-olg-${fromLabel}-a-${toLabel}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
});

router.get('/vendas-por-periodo', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    if (!from || !to) {
      const error = new Error('Os parâmetros "from" e "to" são obrigatórios.');
      error.status = 400;
      throw error;
    }

    const report = await buildSalesByPeriodReport({ from, to });
    res.status(200).json({ report });
  } catch (error) {
    next(error);
  }
});

router.get('/vendas-por-periodo.csv', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    if (!from || !to) {
      const error = new Error('Os parâmetros "from" e "to" são obrigatórios.');
      error.status = 400;
      throw error;
    }

    const report = await buildSalesByPeriodReport({ from, to });
    const csvContent = generateSalesByPeriodCsv(report);
    const fromLabel = report.filters.from.slice(0, 10);
    const toLabel = report.filters.to.slice(0, 10);
    const filename = `vendas-por-periodo-${fromLabel}-a-${toLabel}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
});

router.get('/vendas-por-periodo.pdf', async (req, res, next) => {
  try {
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    if (!from || !to) {
      const error = new Error('Os parâmetros "from" e "to" são obrigatórios.');
      error.status = 400;
      throw error;
    }

    const report = await buildSalesByPeriodReport({ from, to });
    const fromLabel = report.filters.from.slice(0, 10);
    const toLabel = report.filters.to.slice(0, 10);
    const filename = `vendas-por-periodo-${fromLabel}-a-${toLabel}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200);

    await generateSalesByPeriodPdf({ res, report });
  } catch (error) {
    next(error);
  }
});

router.get('/management/summary', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    if (!companyId || typeof companyId !== 'string') {
      const error = new Error('Parâmetro companyId é obrigatório');
      error.status = 400;
      throw error;
    }
    const invoiceFilter = {
      companyId,
      ...(from || to
        ? {
            emissao: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [invoiceTotals, itemCounts, pendingByCfopRaw, cfopAggregates, ncmAggregatesRaw, cancellationCount, duplicateCount, conversionCount, uploads] =
      await Promise.all([
        prisma.invoice.findMany({
          where: invoiceFilter,
          select: { totalNFe: true, type: true },
        }),
        Promise.all([
          prisma.invoiceItem.count({ where: { invoice: invoiceFilter } }),
          prisma.invoiceItemProductMapping.count({
            where: { invoiceItem: { invoice: invoiceFilter } },
          }),
        ]),
        prisma.invoiceItem.groupBy({
          by: ['cfopCode'],
          where: { invoice: invoiceFilter, productMapping: null },
          _count: { _all: true },
        }),
        prisma.invoice.findMany({
          where: invoiceFilter,
          select: { cfop: true, totalNFe: true, id: true },
        }),
        prisma.invoiceItem.groupBy({
          by: ['ncm'],
          where: { invoice: invoiceFilter },
          _count: { _all: true },
        }),
        prisma.invoiceCancellation.count({
          where: {
            companyId,
            ...(to || from
              ? {
                  eventTimestamp: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
          },
        }),
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS duplicates FROM (SELECT chave, COUNT(*) FROM "Invoice" WHERE "companyId" = $1 GROUP BY chave HAVING COUNT(*) > 1) t`,
          companyId,
        ),
        prisma.invoiceItemProductMapping.count({
          where: {
            conversionFactor: { not: null },
            invoiceItem: { invoice: invoiceFilter },
          },
        }),
        prisma.uploadBatch.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true },
        }),
      ]);

    const totalItems = itemCounts[0] ?? 0;
    const mappedItems = itemCounts[1] ?? 0;
    const pendingItems = Math.max(0, totalItems - mappedItems);
    const pendingByCfop = pendingByCfopRaw
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 5)
      .map((row) => ({ cfopCode: row.cfopCode, count: row._count._all }));
    const inboundTotal = invoiceTotals
      .filter((inv) => inv.type === 'IN')
      .reduce((acc, inv) => acc + Number(inv.totalNFe ?? 0), 0);
    const outboundTotal = invoiceTotals
      .filter((inv) => inv.type === 'OUT')
      .reduce((acc, inv) => acc + Number(inv.totalNFe ?? 0), 0);
    const cfopTop = cfopAggregates.reduce((acc, inv) => {
      const key = inv.cfop || '—';
      if (!acc[key]) {
        acc[key] = { cfop: key, invoices: 0, total: 0 };
      }
      acc[key].invoices += 1;
      acc[key].total += Number(inv.totalNFe ?? 0);
      return acc;
    }, {});

    const duplicateRow = Array.isArray(duplicateCount) && duplicateCount[0] ? duplicateCount[0].duplicates : 0;

    const response = {
      filters: { companyId, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      mapping: {
        totalItems,
        mappedItems,
        pendingItems,
        pendingByCfop: pendingByCfop.map((row) => ({
          cfopCode: row.cfopCode,
          count: row._count._all,
        })),
      },
      cfop: {
        inboundTotal: inboundTotal.toString(),
        outboundTotal: outboundTotal.toString(),
        invoices: invoiceTotals.length,
        cfopTop: Object.values(cfopTop).map((row) => ({
          cfop: row.cfop,
          invoices: row.invoices,
          total: row.total.toString(),
        })),
      },
      cancellations: {
        cancelled: cancellationCount,
        duplicates: duplicateRow ?? 0,
        uploads: uploads.length,
        lastUpload: uploads[0]?.createdAt ?? null,
      },
      conversions: {
        converted: conversionCount,
      },
      ncm: {
        missing: await prisma.invoiceItem.count({ where: { invoice: invoiceFilter, ncm: null } }),
        top: ncmAggregatesRaw
          .sort((a, b) => b._count._all - a._count._all)
          .slice(0, 5)
          .map((row) => ({
            ncm: row.ncm,
            count: row._count._all,
          })),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/product-ledger', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    const cfopFilter = req.query.cfop ? String(req.query.cfop).trim() : null;
    const groupBy = req.query.groupBy === 'cfop' ? 'cfop' : 'product';
    const naturezaIds = req.query.naturezaIds
      ? String(req.query.naturezaIds)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      : [];
    const natOpFiltersRaw = req.query.natOps
      ? String(req.query.natOps)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      : [];
    const natOpFilters = natOpFiltersRaw.map((n) => n.toLowerCase());
    if (!companyId || typeof companyId !== 'string') {
      const error = new Error('Parâmetro companyId é obrigatório');
      error.status = 400;
      throw error;
    }

    const dateFilter = from || to
      ? {
          emissao: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const natOpsFromNaturezas = naturezaIds.length
      ? await prisma.naturezaOperacao.findMany({
          where: { companyId, id: { in: naturezaIds } },
          select: { natOp: true, aliases: { select: { natOp: true } } },
        })
      : [];

    const natOpsResolved = new Set(natOpFilters);
    natOpsFromNaturezas.forEach((n) => {
      if (n.natOp) natOpsResolved.add(n.natOp.toLowerCase());
      (n.aliases || []).forEach((alias) => {
        if (alias.natOp) natOpsResolved.add(alias.natOp.toLowerCase());
      });
    });

    const orFilters = [];
    if (naturezaIds.length) {
      orFilters.push({ naturezaOperacaoId: { in: naturezaIds } });
    }
    if (natOpsResolved.size) {
      orFilters.push(
        ...Array.from(natOpsResolved).map((n) => ({
          natOp: {
            equals: n,
            mode: 'insensitive',
          },
        })),
      );
    }

    const [products, mappings, stockGrouped] = await Promise.all([
      prisma.product.findMany({
        where: { companyId },
        select: { id: true, name: true, sku: true, unit: true },
      }),
      prisma.invoiceItemProductMapping.findMany({
        where: {
          invoiceItem: {
            invoice: {
              companyId,
              ...dateFilter,
              ...(orFilters.length ? { OR: orFilters } : {}),
            },
            ...(cfopFilter ? { cfopCode: cfopFilter } : {}),
          },
        },
        select: {
          productId: true,
          convertedQty: true,
          invoiceItem: {
            select: {
              gross: true,
              discount: true,
              qty: true,
              cfopCode: true,
              invoice: { select: { type: true, naturezaOperacaoId: true, natOp: true } },
            },
          },
        },
      }),
      prisma.stockMovement.groupBy({
        by: ['productId', 'direction'],
        where: {
          companyId,
          ...(from || to
            ? {
                date: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
        _sum: { qty: true, totalValue: true },
      }),
    ]);

    const stockByProduct = stockGrouped.reduce((acc, row) => {
      const key = row.productId ?? 'unknown';
      if (!acc[key]) acc[key] = { inQty: 0, inValue: 0, outQty: 0, outValue: 0 };
      const qty = Number(row._sum.qty ?? 0);
      const val = Number(row._sum.totalValue ?? 0);
      if (row.direction === 'IN') {
        acc[key].inQty += qty;
        acc[key].inValue += val;
      } else {
        acc[key].outQty += qty;
        acc[key].outValue += val;
      }
      return acc;
    }, {});

    const byProduct = mappings.reduce((acc, row) => {
      const key = groupBy === 'cfop' ? (row.invoiceItem.cfopCode || '—') : row.productId;
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          inQty: 0,
          inValue: 0,
          outQty: 0,
          outGross: 0,
          outNet: 0,
          cfop: row.invoiceItem.cfopCode || null,
          productId: groupBy === 'cfop' ? null : row.productId,
        };
      }
      const qty = row.convertedQty ? Number(row.convertedQty) : Number(row.invoiceItem.qty ?? 0);
      const gross = Number(row.invoiceItem.gross ?? 0);
      const discount = Number(row.invoiceItem.discount ?? 0);
      if (row.invoiceItem.invoice.type === 'IN') {
        acc[key].inQty += qty;
        acc[key].inValue += gross;
      } else {
        acc[key].outQty += qty;
        acc[key].outGross += gross;
        acc[key].outNet += gross - discount;
      }
      return acc;
    }, {});

    const result =
      groupBy === 'cfop'
        ? Object.entries(byProduct).map(([cfop, agg]) => ({
            productId: agg.productId,
            cfopCode: cfop,
            name: `CFOP ${cfop}`,
            sku: null,
            unit: null,
            inQty: agg.inQty,
            inValue: agg.inValue,
            outQty: agg.outQty,
            outGross: agg.outGross,
            outNet: agg.outNet,
            cogs: agg.inQty > 0 ? agg.inValue / agg.inQty : 0,
          }))
        : products.map((product) => {
            const agg = byProduct[product.id] || { inQty: 0, inValue: 0, outQty: 0, outGross: 0, outNet: 0 };
            return {
              productId: product.id,
              cfopCode: null,
              name: product.name,
              sku: product.sku,
              unit: product.unit,
              inQty: agg.inQty,
              inValue: agg.inValue,
              outQty: agg.outQty,
              outGross: agg.outGross,
              outNet: agg.outNet,
              cogs: agg.inQty > 0 ? agg.inValue / agg.inQty : 0,
            };
          });

    res.status(200).json({
      items: result,
      filters: { companyId, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, cfop: cfopFilter, groupBy },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/fiscal-close', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    const naturezaIds = req.query.naturezaIds
      ? String(req.query.naturezaIds)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      : [];

    if (!companyId || typeof companyId !== 'string') {
      const error = new Error('Parâmetro companyId é obrigatório');
      error.status = 400;
      throw error;
    }

    const dateFilter = from || to
      ? {
          emissao: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const naturezas = await prisma.naturezaOperacao.findMany({
      where: { companyId },
      select: { id: true, descricao: true, natOp: true, cfopCode: true, cfopType: true },
    });
    const naturezaLabel = new Map(
      naturezas.map((n) => [
        n.id,
        `${n.descricao || n.natOp || 'Sem descrição'}${n.cfopCode ? ` · CFOP ${n.cfopCode}` : ''}`,
      ]),
    );

    const items = await prisma.invoiceItem.findMany({
      where: {
        invoice: {
          companyId,
          ...(naturezaIds.length ? { naturezaOperacaoId: { in: naturezaIds } } : {}),
          ...dateFilter,
        },
      },
      select: {
        id: true,
        qty: true,
        gross: true,
        discount: true,
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
        description: true,
        productMapping: {
          select: {
            product: { select: { name: true, sku: true } },
            convertedQty: true,
          },
        },
        invoice: {
          select: {
            id: true,
            numero: true,
            emissao: true,
            type: true,
            naturezaOperacaoId: true,
            natOp: true,
            totalNFe: true,
          },
        },
      },
    });

    const rows = items.map((item) => {
      const invoice = item.invoice;
      const direction = invoice.type === 'IN' ? 'IN' : 'OUT';
      const naturezaKey = invoice.naturezaOperacaoId || invoice.natOp || 'sem-natureza';
      const natureza = invoice.naturezaOperacaoId
        ? naturezaLabel.get(invoice.naturezaOperacaoId) || 'Natureza sem descrição'
        : invoice.natOp || 'Natureza não definida';
      const productLabel =
        item.productMapping?.product?.name ||
        item.description ||
        'Produto não mapeado';
      const sku = item.productMapping?.product?.sku;

      const vTotTribRaw = item.vTotTrib != null
        ? Number(item.vTotTrib)
        : Number(item.icmsValue ?? 0) + Number(item.ipiValue ?? 0) + Number(item.pisValue ?? 0) + Number(item.cofinsValue ?? 0);
      const effectiveQty = item.productMapping?.convertedQty != null
        ? Number(item.productMapping.convertedQty)
        : Number(item.qty ?? 0);

      return {
        id: item.id,
        direction,
        naturezaKey,
        natureza,
        invoiceNumber: invoice.numero || invoice.id,
        emissao: invoice.emissao,
        product: productLabel,
        sku: sku || null,
        productKey: item.productMapping?.product?.id || productLabel,
        qty: effectiveQty,
        total: Number(item.gross ?? 0),
        vTotTrib: vTotTribRaw,
        vBC: item.vBC != null ? Number(item.vBC) : null,
        vICMS: item.vICMS != null ? Number(item.vICMS) : Number(item.icmsValue ?? 0),
        vICMSDeson: item.vICMSDeson != null ? Number(item.vICMSDeson) : null,
        vBCST: item.vBCST != null ? Number(item.vBCST) : null,
        vST: item.vST != null ? Number(item.vST) : null,
        vDesc: item.discount ? Number(item.discount) : 0,
        // Para evitar duplicar total da NF quando há vários itens, usamos o valor bruto do item aqui
        vNF: Number(item.gross ?? 0),
      };
    });

    const grouped = rows.reduce(
      (acc, row) => {
        const target = row.direction === 'IN' ? acc.entradas : acc.saidas;
        if (!target[row.naturezaKey]) {
          target[row.naturezaKey] = { natureza: row.natureza, rows: [], totalsByProduct: {} };
        }
        target[row.naturezaKey].rows.push(row);

        const pk = row.productKey || row.product || 'Produto não mapeado';
        if (!target[row.naturezaKey].totalsByProduct[pk]) {
          target[row.naturezaKey].totalsByProduct[pk] = {
            product: row.product,
            sku: row.sku,
            qty: 0,
            total: 0,
            vTotTrib: 0,
            vBC: 0,
            vICMS: 0,
            vICMSDeson: 0,
            vBCST: 0,
            vST: 0,
            vDesc: 0,
            vNF: 0,
          };
        }
        const agg = target[row.naturezaKey].totalsByProduct[pk];
        agg.qty += row.qty || 0;
        agg.total += row.total || 0;
        agg.vTotTrib += row.vTotTrib || 0;
        agg.vBC += row.vBC || 0;
        agg.vICMS += row.vICMS || 0;
        agg.vICMSDeson += row.vICMSDeson || 0;
        agg.vBCST += row.vBCST || 0;
        agg.vST += row.vST || 0;
        agg.vDesc += row.vDesc || 0;
        agg.vNF += row.vNF || 0;

        return acc;
      },
      { entradas: {}, saidas: {} },
    );

    res.status(200).json({
      filters: { companyId, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, naturezaIds },
      grouped,
    });
  } catch (error) {
    next(error);
  }
});

async function buildDreReport(companyId, from, to) {
  const naturezasDre = await prisma.naturezaOperacao.findMany({
    where: { companyId, dreInclude: true },
    select: {
      id: true,
      dreCategory: true,
      dreLabel: true,
      descricao: true,
      natOp: true,
    },
  });

  const dreMap = new Map();
  naturezasDre.forEach((n) => {
    const label = n.dreLabel || n.descricao || n.natOp || 'Natureza';
    dreMap.set(n.id, { category: n.dreCategory, label });
  });

  const dateFilter = from || to
    ? {
        emissao: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : {};

  const mappings = await prisma.invoiceItemProductMapping.findMany({
    where: {
      invoiceItem: {
        invoice: {
          companyId,
          ...(dateFilter ? { ...dateFilter } : {}),
          naturezaOperacaoId: { in: Array.from(dreMap.keys()) },
        },
      },
    },
    select: {
      convertedQty: true,
      invoiceItem: {
        select: {
          gross: true,
          cfopCode: true,
          qty: true,
          invoice: { select: { naturezaOperacaoId: true } },
        },
      },
      product: { select: { id: true, name: true, sku: true } },
    },
  });

  const aggregates = {};
  const revenueQtyByProduct = {};
  const returnQtyByProduct = {};
  const cmvByProduct = {};

  mappings.forEach((row) => {
    const naturezaId = row.invoiceItem.invoice.naturezaOperacaoId;
    const cfg = dreMap.get(naturezaId);
    if (!cfg || !cfg.category) return;
    const category = cfg.category;
    if (!aggregates[category]) aggregates[category] = {};
    const productKey = row.product?.id || cfg.label;
    if (!aggregates[category][cfg.label]) aggregates[category][cfg.label] = {};
    if (!aggregates[category][cfg.label][productKey]) {
      aggregates[category][cfg.label][productKey] = {
        product: row.product?.name || cfg.label,
        sku: row.product?.sku || null,
        qty: 0,
        total: 0,
      };
    }
    const agg = aggregates[category][cfg.label][productKey];
    const qty = row.convertedQty != null ? Number(row.convertedQty) : Number(row.invoiceItem.qty ?? 0);
    const gross = Number(row.invoiceItem.gross ?? 0);
    agg.qty += qty;
    agg.total += gross;

    if (category === 'REVENUE') {
      revenueQtyByProduct[productKey] = (revenueQtyByProduct[productKey] || 0) + qty;
    }
    if (category === 'RETURN') {
      returnQtyByProduct[productKey] = (returnQtyByProduct[productKey] || 0) + qty;
    }
    if (category === 'CMV') {
      if (!cmvByProduct[productKey]) cmvByProduct[productKey] = { total: 0, qty: 0, product: agg.product, sku: agg.sku };
      cmvByProduct[productKey].qty += qty;
      cmvByProduct[productKey].total += gross;
    }
  });

  const formatCategory = (categoryKey) =>
    Object.entries(aggregates[categoryKey] || {}).map(([label, products]) => {
      const items = Object.values(products).map((p) => ({
        ...p,
        avgPrice: p.qty > 0 ? p.total / p.qty : 0,
      }));
      const total = items.reduce((sum, p) => sum + p.total, 0);
      return { label, total, items };
    });

  const cmvAdjustedItems = Object.entries(cmvByProduct).map(([productKey, info]) => {
    const revenueQty = revenueQtyByProduct[productKey] || 0;
    const returnQty = returnQtyByProduct[productKey] || 0;
    const effectiveQty = Math.max(revenueQty - returnQty, 0);
    const unitCost = info.qty > 0 ? info.total / info.qty : 0;
    const total = effectiveQty * unitCost;
    return {
      label: 'CMV ajustado',
      productKey,
      product: info.product,
      sku: info.sku,
      qty: effectiveQty,
      total,
      avgPrice: unitCost,
    };
  });

  const cmvAdjustedGroup = [
    {
      label: 'CMV ajustado',
      total: cmvAdjustedItems.reduce((sum, i) => sum + i.total, 0),
      items: cmvAdjustedItems.map((i) => ({
        product: i.product,
        sku: i.sku,
        qty: i.qty,
        total: i.total,
        avgPrice: i.avgPrice,
      })),
    },
  ];

  const deducoes = await prisma.dREDeduction.findMany({
    where: {
      companyId,
      ...(from || to
        ? {
            OR: [
              {
                AND: [
                  { startDate: { lte: to || new Date() } },
                  { endDate: { gte: from || new Date(0) } },
                ],
              },
            ],
          }
        : {}),
    },
    select: { id: true, title: true, startDate: true, endDate: true, amount: true },
    orderBy: { startDate: 'asc' },
  });

  const cteWhere = {
    companyId,
    isCancelled: false,
    ...(from || to
      ? {
          emissao: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };
  const cteFreteSum = await prisma.cte.aggregate({
    where: cteWhere,
    _sum: { valorPrestacao: true },
  });
  const freteValor = Number(cteFreteSum._sum.valorPrestacao ?? 0);
  const cteFirst = await prisma.cte.findFirst({
    where: cteWhere,
    orderBy: [{ emissao: 'asc' }],
    select: { emissao: true },
  });
  const cteLast = await prisma.cte.findFirst({
    where: cteWhere,
    orderBy: [{ emissao: 'desc' }],
    select: { emissao: true },
  });

  let unconditionalDiscountReport = null;
  try {
    unconditionalDiscountReport = await buildUnconditionalDiscountReport({ companyId, from, to });
  } catch (error) {
    if (error?.status !== 404) {
      throw error;
    }
  }

  const manualDeductionsTotal = deducoes.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  let unconditionalDeductionItem = null;
  let unconditionalDeductionTotal = 0;

  if (unconditionalDiscountReport) {
    const parsedDiscount = Number(unconditionalDiscountReport?.totals?.discountValue ?? 0);
    unconditionalDeductionTotal = Number.isFinite(parsedDiscount) ? parsedDiscount : 0;

    const issueDates = (unconditionalDiscountReport.rows || [])
      .map((row) => (row.issueDate ? new Date(row.issueDate) : null))
      .filter((date) => date && !Number.isNaN(date.getTime()));

    const fallbackDateIso = new Date().toISOString();
    const startDateIso =
      from?.toISOString() ??
      unconditionalDiscountReport.filters?.from ??
      (issueDates[0]?.toISOString() ?? fallbackDateIso);
    const endDateIso =
      to?.toISOString() ??
      unconditionalDiscountReport.filters?.to ??
      (issueDates.length ? issueDates[issueDates.length - 1].toISOString() : fallbackDateIso);

    unconditionalDeductionItem = {
      id: 'unconditional-discounts',
      title: 'Descontos incondicionais',
      startDate: startDateIso,
      endDate: endDateIso,
      amount: unconditionalDiscountReport.totals?.discountValue ?? '0',
    };
  }

  const freteDeductionItem = freteValor > 0
    ? {
        id: 'cte-fretes',
        title: 'Fretes (CT-e)',
        startDate:
          from?.toISOString()
          ?? cteFirst?.emissao?.toISOString()
          ?? new Date().toISOString(),
        endDate:
          to?.toISOString()
          ?? cteLast?.emissao?.toISOString()
          ?? new Date().toISOString(),
        amount: freteValor.toString(),
      }
    : null;

  const freteDeductionTotal = freteDeductionItem ? freteValor : 0;

  return {
    filters: { companyId, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    revenue: formatCategory('REVENUE'),
    returns: formatCategory('RETURN'),
    cmv: cmvAdjustedGroup,
    deductions: {
      total: manualDeductionsTotal + unconditionalDeductionTotal + freteDeductionTotal,
      items: [
        ...deducoes,
        ...(unconditionalDeductionItem ? [unconditionalDeductionItem] : []),
        ...(freteDeductionItem ? [freteDeductionItem] : []),
      ],
    },
  };
}

router.get('/dre', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);

    if (!companyId || typeof companyId !== 'string') {
      const error = new Error('Parâmetro companyId é obrigatório');
      error.status = 400;
      throw error;
    }

    const response = await buildDreReport(companyId, from, to);

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

router.get('/dre.pdf', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const from = parseStartDate(req.query.from ?? null);
    const to = parseEndDate(req.query.to ?? null);
    if (!companyId || typeof companyId !== 'string') {
      const error = new Error('Parâmetro companyId é obrigatório');
      error.status = 400;
      throw error;
    }
    const report = await buildDreReport(companyId, from, to);

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, cnpj: true },
    });

    const filename = `dre-${report.filters.from ?? 'inicio'}-a-${report.filters.to ?? 'fim'}.pdf`;
    const buffer = await generateDrePdfHtml({ report, company });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
