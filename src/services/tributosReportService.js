const { Prisma } = require('@prisma/client');
const { prisma } = require('../prisma');

const Decimal = Prisma.Decimal;

const TARGET_COMPANY_CNPJ_DIGITS = '30404512000184';
const TARGET_COMPANY_NAME = 'OLG INDUSTRIA E COMERCIO';

const TRIBUTO_1_RATES = Object.freeze({
  icms: new Decimal('0.195'),
  discount: new Decimal('0.75'),
  funcafe: new Decimal('0.10'),
  pisCofins: new Decimal('0.0925'),
  st: new Decimal('0.0585'),
});

const TRIBUTO_2_RATES = Object.freeze({
  icms: new Decimal('0.12'),
  discount: new Decimal('0.75'),
  funcafe: new Decimal('0.10'),
  pisCofins: new Decimal('0.0925'),
});

const FUNRURAL_RATE = new Decimal('0.015');

function normalizeDigits(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

function normalizeText(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function ensureDate(date) {
  if (!date) return null;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function startOfDay(date) {
  if (!date) return null;
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  if (!date) return null;
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function toDecimal(value) {
  if (value instanceof Decimal) return value;
  if (value == null) return new Decimal(0);
  try {
    return new Decimal(value);
  } catch (error) {
    return new Decimal(0);
  }
}

function formatMoney(decimal) {
  return toDecimal(decimal).toFixed(2);
}

function formatQuantity(decimal) {
  return toDecimal(decimal).toFixed(4);
}

function formatPercent(decimal) {
  return toDecimal(decimal).toFixed(2);
}

function resolveUnitPrice(item) {
  if (item.unitPrice != null) {
    return toDecimal(item.unitPrice);
  }
  const qty = toDecimal(item.qty ?? 0);
  if (qty.isZero()) {
    return new Decimal(0);
  }
  if (item.gross != null) {
    return toDecimal(item.gross).div(qty);
  }
  return new Decimal(0);
}

function addToTotals(totals, key, value) {
  if (!totals[key]) {
    totals[key] = new Decimal(0);
  }
  totals[key] = totals[key].add(value);
}

function accumulateProductSummary(map, key, initializer) {
  if (!map.has(key)) {
    map.set(key, initializer());
  }
  return map.get(key);
}

async function resolveTargetCompany() {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, cnpj: true },
  });

  const match = companies.find((company) => {
    const digits = normalizeDigits(company.cnpj);
    if (digits === TARGET_COMPANY_CNPJ_DIGITS) {
      return true;
    }
    const name = normalizeText(company.name);
    return name === TARGET_COMPANY_NAME || name.includes(TARGET_COMPANY_NAME);
  });

  if (!match) {
    const error = new Error('Empresa alvo (OLG Indústria e Comércio) não encontrada.');
    error.status = 404;
    throw error;
  }

  return match;
}

async function fetchInvoiceItems({ companyId, cfops, type, from, to }) {
  const where = {
    cfopCode: { in: cfops },
    invoice: {
      companyId,
      type,
    },
  };

  if (from || to) {
    where.invoice.emissao = {};
    if (from) {
      where.invoice.emissao.gte = startOfDay(from);
    }
    if (to) {
      where.invoice.emissao.lte = endOfDay(to);
    }
  }

  return prisma.invoiceItem.findMany({
    where,
    select: {
      id: true,
      invoiceId: true,
      cfopCode: true,
      description: true,
      productCode: true,
      unit: true,
      qty: true,
      unitPrice: true,
      gross: true,
      ncm: true,
      productMapping: {
        select: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
        },
      },
      invoice: {
        select: {
          id: true,
          numero: true,
          emissao: true,
          type: true,
          issuerCnpj: true,
          recipientCnpj: true,
        },
      },
    },
    orderBy: [
      { invoice: { emissao: 'asc' } },
      { invoiceId: 'asc' },
      { id: 'asc' },
    ],
  });
}

function resolveProductIdentity(item) {
  const fallbackName = item.description?.trim()
    || item.productMapping?.product?.name?.trim()
    || item.productCode
    || 'Item sem descrição';
  const productName = item.productMapping?.product?.name?.trim() || fallbackName;
  const productId = item.productMapping?.product?.id ?? null;
  const key = productId ?? `UNMAPPED:${normalizeDigits(item.invoiceId)}:${fallbackName}`;
  return {
    key,
    productId,
    productName,
  };
}

function buildSalesSection(items, rates, { includeSt }) {
  const lines = [];
  const totals = {};
  const productMap = new Map();
  const ncmMap = new Map();

  items.forEach((item) => {
    const qty = toDecimal(item.qty ?? 0);
    if (qty.isZero()) {
      return;
    }

    const unitValue = resolveUnitPrice(item);
    const baseTotal = unitValue.mul(qty);

    const icmsBrutoUnit = unitValue.mul(rates.icms);
    const icmsBrutoTotal = icmsBrutoUnit.mul(qty);

    const icmsDiscountUnit = icmsBrutoUnit.mul(rates.discount);
    const icmsDiscountTotal = icmsDiscountUnit.mul(qty);

    const icmsLiquidoUnit = icmsBrutoUnit.sub(icmsDiscountUnit);
    const icmsLiquidoTotal = icmsLiquidoUnit.mul(qty);

    const funcafeUnit = icmsDiscountUnit.mul(rates.funcafe);
    const funcafeTotal = funcafeUnit.mul(qty);

    const pisCofinsUnit = icmsDiscountUnit.mul(rates.pisCofins);
    const pisCofinsTotal = pisCofinsUnit.mul(qty);

    const stUnit = includeSt ? unitValue.mul(rates.st) : new Decimal(0);
    const stTotal = includeSt ? stUnit.mul(qty) : new Decimal(0);

    const finalUnit = includeSt
      ? icmsLiquidoUnit.add(funcafeUnit).add(pisCofinsUnit).add(stUnit)
      : icmsLiquidoUnit.add(funcafeUnit).add(pisCofinsUnit);
    const finalTotal = finalUnit.mul(qty);

    addToTotals(totals, 'quantity', qty);
    addToTotals(totals, 'salesValue', baseTotal);
    addToTotals(totals, 'icmsBruto', icmsBrutoTotal);
    addToTotals(totals, 'icmsDiscount', icmsDiscountTotal);
    addToTotals(totals, 'icmsLiquido', icmsLiquidoTotal);
    addToTotals(totals, 'funcafe', funcafeTotal);
    addToTotals(totals, 'pisCofins', pisCofinsTotal);
    if (includeSt) {
      addToTotals(totals, 'st', stTotal);
    }
    addToTotals(totals, 'finalTax', finalTotal);

    const productIdentity = resolveProductIdentity(item);
    const productSummary = accumulateProductSummary(productMap, productIdentity.key, () => ({
      productId: productIdentity.productId,
      productName: productIdentity.productName,
      ncm: item.ncm ?? null,
      quantity: new Decimal(0),
      salesValue: new Decimal(0),
      icmsBruto: new Decimal(0),
      icmsDiscount: new Decimal(0),
      icmsLiquido: new Decimal(0),
      funcafe: new Decimal(0),
      pisCofins: new Decimal(0),
      st: new Decimal(0),
      finalTax: new Decimal(0),
    }));

    productSummary.quantity = productSummary.quantity.add(qty);
    productSummary.salesValue = productSummary.salesValue.add(baseTotal);
    productSummary.icmsBruto = productSummary.icmsBruto.add(icmsBrutoTotal);
    productSummary.icmsDiscount = productSummary.icmsDiscount.add(icmsDiscountTotal);
    productSummary.icmsLiquido = productSummary.icmsLiquido.add(icmsLiquidoTotal);
    productSummary.funcafe = productSummary.funcafe.add(funcafeTotal);
    productSummary.pisCofins = productSummary.pisCofins.add(pisCofinsTotal);
    if (includeSt) {
      productSummary.st = productSummary.st.add(stTotal);
    }
    productSummary.finalTax = productSummary.finalTax.add(finalTotal);

    const ncmKey = item.ncm?.trim() || 'SEM_NCM';
    const ncmSummary = accumulateProductSummary(ncmMap, ncmKey, () => ({
      ncm: item.ncm?.trim() || null,
      quantity: new Decimal(0),
      salesValue: new Decimal(0),
      finalTax: new Decimal(0),
    }));

    ncmSummary.quantity = ncmSummary.quantity.add(qty);
    ncmSummary.salesValue = ncmSummary.salesValue.add(baseTotal);
    ncmSummary.finalTax = ncmSummary.finalTax.add(finalTotal);

    const effectiveRate = baseTotal.isZero()
      ? new Decimal(0)
      : finalTotal.div(baseTotal).mul(100);

    lines.push({
      id: item.id,
      invoiceId: item.invoiceId,
      invoiceNumber: item.invoice?.numero ?? null,
      issueDate: item.invoice?.emissao ? new Date(item.invoice.emissao).toISOString() : null,
      cfop: item.cfopCode ?? null,
      productId: productIdentity.productId,
      productName: productIdentity.productName,
      productCode: item.productCode ?? null,
      ncm: item.ncm ?? null,
      quantity: formatQuantity(qty),
      unitValue: formatMoney(unitValue),
      baseValueTotal: formatMoney(baseTotal),
      icmsBruto: {
        unit: formatMoney(icmsBrutoUnit),
        total: formatMoney(icmsBrutoTotal),
      },
      icmsDiscount: {
        unit: formatMoney(icmsDiscountUnit),
        total: formatMoney(icmsDiscountTotal),
      },
      icmsLiquido: {
        unit: formatMoney(icmsLiquidoUnit),
        total: formatMoney(icmsLiquidoTotal),
      },
      funcafe: {
        unit: formatMoney(funcafeUnit),
        total: formatMoney(funcafeTotal),
      },
      pisCofins: {
        unit: formatMoney(pisCofinsUnit),
        total: formatMoney(pisCofinsTotal),
      },
      st: includeSt
        ? {
            unit: formatMoney(stUnit),
            total: formatMoney(stTotal),
          }
        : null,
      finalTax: {
        unit: formatMoney(finalUnit),
        total: formatMoney(finalTotal),
      },
      effectiveTaxRate: formatPercent(effectiveRate),
    });
  });

  const totalsOutput = {
    quantity: formatQuantity(totals.quantity ?? 0),
    salesValue: formatMoney(totals.salesValue ?? 0),
    icmsBruto: formatMoney(totals.icmsBruto ?? 0),
    icmsDiscount: formatMoney(totals.icmsDiscount ?? 0),
    icmsLiquido: formatMoney(totals.icmsLiquido ?? 0),
    funcafe: formatMoney(totals.funcafe ?? 0),
    pisCofins: formatMoney(totals.pisCofins ?? 0),
    finalTax: formatMoney(totals.finalTax ?? 0),
  };

  if (includeSt) {
    totalsOutput.st = formatMoney(totals.st ?? 0);
  }

  const productSummary = Array.from(productMap.values()).map((entry) => {
    const averageUnit = entry.quantity.isZero()
      ? new Decimal(0)
      : entry.salesValue.div(entry.quantity);
    const taxPerUnit = entry.quantity.isZero()
      ? new Decimal(0)
      : entry.finalTax.div(entry.quantity);
    const effectiveRate = entry.salesValue.isZero()
      ? new Decimal(0)
      : entry.finalTax.div(entry.salesValue).mul(100);

    return {
      productId: entry.productId,
      productName: entry.productName,
      ncm: entry.ncm,
      totalQuantity: formatQuantity(entry.quantity),
      totalSalesValue: formatMoney(entry.salesValue),
      totalFinalTax: formatMoney(entry.finalTax),
      icmsBruto: formatMoney(entry.icmsBruto),
      icmsDiscount: formatMoney(entry.icmsDiscount),
      icmsLiquido: formatMoney(entry.icmsLiquido),
      funcafe: formatMoney(entry.funcafe),
      pisCofins: formatMoney(entry.pisCofins),
      st: includeSt ? formatMoney(entry.st) : null,
      averageUnitPrice: formatMoney(averageUnit),
      taxPerUnit: formatMoney(taxPerUnit),
      effectiveTaxRate: formatPercent(effectiveRate),
    };
  });

  productSummary.sort((a, b) => Number(b.totalFinalTax) - Number(a.totalFinalTax));

  const ncmRanking = Array.from(ncmMap.values())
    .map((entry) => {
      const effectiveRate = entry.salesValue.isZero()
        ? new Decimal(0)
        : entry.finalTax.div(entry.salesValue).mul(100);
      return {
        ncm: entry.ncm,
        totalQuantity: formatQuantity(entry.quantity),
        totalSalesValue: formatMoney(entry.salesValue),
        totalFinalTax: formatMoney(entry.finalTax),
        effectiveTaxRate: formatPercent(effectiveRate),
      };
    })
    .sort((a, b) => Number(b.totalFinalTax) - Number(a.totalFinalTax));

  return {
    lines,
    totals: totalsOutput,
    productSummary,
    ncmRanking,
  };
}

function buildFunruralSection(items, companyCnpjDigits) {
  const lines = [];
  const totals = {};
  const productMap = new Map();

  items.forEach((item) => {
    const issuerDigits = normalizeDigits(item.invoice?.issuerCnpj);
    const recipientDigits = normalizeDigits(item.invoice?.recipientCnpj);

    let counterpartyDigits = null;
    if (issuerDigits === companyCnpjDigits && recipientDigits.length === 11) {
      counterpartyDigits = recipientDigits;
    } else if (recipientDigits === companyCnpjDigits && issuerDigits.length === 11) {
      counterpartyDigits = issuerDigits;
    } else if (issuerDigits.length === 11) {
      counterpartyDigits = issuerDigits;
    } else if (recipientDigits.length === 11) {
      counterpartyDigits = recipientDigits;
    }

    if (!counterpartyDigits) {
      return;
    }

    const qty = toDecimal(item.qty ?? 0);
    if (qty.isZero()) {
      return;
    }

    const unitValue = resolveUnitPrice(item);
    const baseTotal = unitValue.mul(qty);

    const funruralUnit = unitValue.mul(FUNRURAL_RATE);
    const funruralTotal = funruralUnit.mul(qty);

    addToTotals(totals, 'quantity', qty);
    addToTotals(totals, 'purchaseValue', baseTotal);
    addToTotals(totals, 'funrural', funruralTotal);

    const productIdentity = resolveProductIdentity(item);
    const productSummary = accumulateProductSummary(productMap, productIdentity.key, () => ({
      productId: productIdentity.productId,
      productName: productIdentity.productName,
      ncm: item.ncm ?? null,
      quantity: new Decimal(0),
      purchaseValue: new Decimal(0),
      funrural: new Decimal(0),
    }));

    productSummary.quantity = productSummary.quantity.add(qty);
    productSummary.purchaseValue = productSummary.purchaseValue.add(baseTotal);
    productSummary.funrural = productSummary.funrural.add(funruralTotal);

    const effectiveRate = baseTotal.isZero()
      ? new Decimal(0)
      : funruralTotal.div(baseTotal).mul(100);

    lines.push({
      id: item.id,
      invoiceId: item.invoiceId,
      invoiceNumber: item.invoice?.numero ?? null,
      issueDate: item.invoice?.emissao ? new Date(item.invoice.emissao).toISOString() : null,
      cfop: item.cfopCode ?? null,
      productId: productIdentity.productId,
      productName: productIdentity.productName,
      productCode: item.productCode ?? null,
      ncm: item.ncm ?? null,
      quantity: formatQuantity(qty),
      unitValue: formatMoney(unitValue),
      baseValueTotal: formatMoney(baseTotal),
      funrural: {
        unit: formatMoney(funruralUnit),
        total: formatMoney(funruralTotal),
      },
      effectiveTaxRate: formatPercent(effectiveRate),
    });
  });

  const productSummary = Array.from(productMap.values()).map((entry) => {
    const averageUnit = entry.quantity.isZero()
      ? new Decimal(0)
      : entry.purchaseValue.div(entry.quantity);
    const taxPerUnit = entry.quantity.isZero()
      ? new Decimal(0)
      : entry.funrural.div(entry.quantity);
    const effectiveRate = entry.purchaseValue.isZero()
      ? new Decimal(0)
      : entry.funrural.div(entry.purchaseValue).mul(100);

    return {
      productId: entry.productId,
      productName: entry.productName,
      ncm: entry.ncm,
      totalQuantity: formatQuantity(entry.quantity),
      totalPurchaseValue: formatMoney(entry.purchaseValue),
      totalFunrural: formatMoney(entry.funrural),
      averageUnitPrice: formatMoney(averageUnit),
      taxPerUnit: formatMoney(taxPerUnit),
      effectiveTaxRate: formatPercent(effectiveRate),
    };
  });

  productSummary.sort((a, b) => Number(b.totalFunrural) - Number(a.totalFunrural));

  const totalsOutput = {
    quantity: formatQuantity(totals.quantity ?? 0),
    purchaseValue: formatMoney(totals.purchaseValue ?? 0),
    funrural: formatMoney(totals.funrural ?? 0),
  };

  return {
    lines,
    totals: totalsOutput,
    productSummary,
  };
}

async function buildTributosReport({ from, to }) {
  const fromDate = ensureDate(from);
  const toDate = ensureDate(to);

  const company = await resolveTargetCompany();

  const [tributo1Items, tributo2Items, funruralItems] = await Promise.all([
    fetchInvoiceItems({
      companyId: company.id,
      cfops: ['5401'],
      type: 'OUT',
      from: fromDate,
      to: toDate,
    }),
    fetchInvoiceItems({
      companyId: company.id,
      cfops: ['6101'],
      type: 'OUT',
      from: fromDate,
      to: toDate,
    }),
    fetchInvoiceItems({
      companyId: company.id,
      cfops: ['1101'],
      type: 'IN',
      from: fromDate,
      to: toDate,
    }),
  ]);

  const companyDigits = normalizeDigits(company.cnpj);

  const tributo1 = buildSalesSection(tributo1Items, TRIBUTO_1_RATES, { includeSt: true });
  const tributo2 = buildSalesSection(tributo2Items, TRIBUTO_2_RATES, { includeSt: false });
  const tributo3 = buildFunruralSection(funruralItems, companyDigits);

  const totalSalesTax = toDecimal(tributo1.totals.finalTax ?? 0).add(toDecimal(tributo2.totals.finalTax ?? 0));
  const totalFunrural = toDecimal(tributo3.totals.funrural ?? 0);
  const totalDiscount = toDecimal(tributo1.totals.icmsDiscount ?? 0).add(toDecimal(tributo2.totals.icmsDiscount ?? 0));

  return {
    generatedAt: new Date().toISOString(),
    company,
    filters: {
      from: fromDate ? startOfDay(fromDate).toISOString() : null,
      to: toDate ? endOfDay(toDate).toISOString() : null,
    },
    tributo1,
    tributo2,
    tributo3,
    overall: {
      totalSalesTax: formatMoney(totalSalesTax),
      totalFunrural: formatMoney(totalFunrural),
      totalDiscountIcms: formatMoney(totalDiscount),
      grandTotalTax: formatMoney(totalSalesTax.add(totalFunrural)),
    },
  };
}

function formatDateForCsv(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('pt-BR');
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const string = String(value);
  if (/[;"\n]/.test(string)) {
    return `"${string.replace(/"/g, '""')}"`;
  }
  return string;
}

function convertRowsToCsv(rows) {
  return rows
    .map((row) => row.map(escapeCsvValue).join(';'))
    .join('\n');
}

function buildSalesCsvSection(title, section, includeSt) {
  const rows = [
    [title],
    [
      'Data NF',
      'Nº NF',
      'CFOP',
      'Produto',
      'Qtd (un/fardo)',
      'Valor unitário',
      'ICMS bruto',
      'Desconto ICMS',
      'ICMS líquido',
      'FUNCAFÉ',
      'PIS/COFINS',
      'ST',
      'Imposto final por unidade',
      'Imposto final total',
    ],
  ];

  section.lines.forEach((line) => {
    rows.push([
      formatDateForCsv(line.issueDate),
      line.invoiceNumber ?? '',
      line.cfop ?? '',
      line.productName,
      line.quantity,
      line.unitValue,
      line.icmsBruto.unit,
      line.icmsDiscount.unit,
      line.icmsLiquido.unit,
      line.funcafe.unit,
      line.pisCofins.unit,
      includeSt && line.st ? line.st.unit : '',
      line.finalTax.unit,
      line.finalTax.total,
    ]);
  });

  rows.push([
    'Totais',
    '',
    '',
    '',
    section.totals.quantity ?? '',
    '',
    section.totals.icmsBruto ?? '',
    section.totals.icmsDiscount ?? '',
    section.totals.icmsLiquido ?? '',
    section.totals.funcafe ?? '',
    section.totals.pisCofins ?? '',
    includeSt ? section.totals.st ?? '' : '',
    '',
    section.totals.finalTax ?? '',
  ]);

  rows.push([]);
  return rows;
}

function buildFunruralCsvSection(title, section) {
  const rows = [
    [title],
    [
      'Data NF',
      'Nº NF',
      'CFOP',
      'Produto',
      'Qtd (un/fardo)',
      'Valor unitário',
      'Valor total',
      'FUNRURAL por unidade',
      'FUNRURAL total',
    ],
  ];

  section.lines.forEach((line) => {
    rows.push([
      formatDateForCsv(line.issueDate),
      line.invoiceNumber ?? '',
      line.cfop ?? '',
      line.productName,
      line.quantity,
      line.unitValue,
      line.baseValueTotal,
      line.funrural.unit,
      line.funrural.total,
    ]);
  });

  rows.push([
    'Totais',
    '',
    '',
    '',
    section.totals.quantity ?? '',
    '',
    section.totals.purchaseValue ?? '',
    '',
    section.totals.funrural ?? '',
  ]);

  rows.push([]);
  return rows;
}

function generateTributosCsv(report) {
  const rows = [
    ['Relatório de Tributos — OLG Indústria e Comércio'],
    ['Empresa', report.company.name, report.company.cnpj],
    ['Período', formatDateForCsv(report.filters.from), formatDateForCsv(report.filters.to)],
    ['Gerado em', formatDateForCsv(report.generatedAt)],
    [],
  ];

  rows.push(
    ...buildSalesCsvSection('Tributo 1 — Venda de Café Torrado em Rondônia (CFOP 5.401)', report.tributo1, true),
  );
  rows.push(
    ...buildSalesCsvSection('Tributo 2 — Venda de Café Torrado para fora de Rondônia (CFOP 6.101)', report.tributo2, false),
  );
  rows.push(
    ...buildFunruralCsvSection('Tributo 3 — FUNRURAL (CFOP 1.101)', report.tributo3),
  );

  rows.push(
    [],
    ['Resumo geral'],
    ['Tributos sobre vendas', report.overall.totalSalesTax],
    ['Desconto de ICMS aplicado', report.overall.totalDiscountIcms],
    ['FUNRURAL (compras)', report.overall.totalFunrural],
    ['Total geral de tributos', report.overall.grandTotalTax],
  );

  return convertRowsToCsv(rows);
}

module.exports = {
  buildTributosReport,
  generateTributosCsv,
};
