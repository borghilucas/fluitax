const { Prisma } = require('@prisma/client');
const { buildConsolidatedKardexReport } = require('./kardexConsolidatedService');
const { PRODUCT_ALIAS } = require('../constants/kardexConsolidated');

const Decimal = Prisma.Decimal;

const PRODUCT_ORDER = [
  PRODUCT_ALIAS.ACABADO_RANCHO_10X500,
  PRODUCT_ALIAS.ACABADO_RANCHO_20X250,
  PRODUCT_ALIAS.ACABADO_NOVAERA_10X500,
];

const PRODUCT_LABELS = Object.freeze({
  [PRODUCT_ALIAS.ACABADO_RANCHO_10X500]: 'CAFE DO RANCHO 10X500',
  [PRODUCT_ALIAS.ACABADO_RANCHO_20X250]: 'CAFE DO RANCHO 20X250',
  [PRODUCT_ALIAS.ACABADO_NOVAERA_10X500]: 'CAFE NOVA ERA 10X500',
});

const UNITS_PER_SC_DECIMAL = new Decimal('9.6'); // 1 saca corresponde a 9,6 unidades acabadas

function toDecimal(value) {
  if (value instanceof Decimal) {
    return value;
  }
  if (value == null) {
    return new Decimal(0);
  }
  if (typeof value === 'string' && value.trim() === '') {
    return new Decimal(0);
  }
  try {
    return new Decimal(value);
  } catch (error) {
    return new Decimal(0);
  }
}

function formatDecimal(value, fractionDigits = 2) {
  return toDecimal(value).toFixed(fractionDigits);
}

function ensureDate(value) {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function validatePeriod({ from, to }) {
  if (!from || !to) {
    const error = new Error('Os parâmetros "from" e "to" são obrigatórios.');
    error.status = 400;
    throw error;
  }

  const start = ensureDate(from);
  const end = ensureDate(to);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const error = new Error('Período inválido. Utilize datas válidas.');
    error.status = 400;
    throw error;
  }

  if (start.getTime() > end.getTime()) {
    const error = new Error('A data inicial deve ser anterior ou igual à data final.');
    error.status = 400;
    throw error;
  }

  return { start, end };
}

function isWithinPeriod(timestamp, start, end) {
  if (!timestamp) return false;
  const date = ensureDate(timestamp);
  if (Number.isNaN(date.getTime())) return false;
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function buildProductRow(bucket) {
  const avgUnitPrice = bucket.qtyUnits.isZero()
    ? new Decimal(0)
    : bucket.netValue.div(bucket.qtyUnits);
  const pricePerSc = avgUnitPrice.mul(UNITS_PER_SC_DECIMAL);
  const avgMpCostSc = bucket.mpConsumed.isZero()
    ? new Decimal(0)
    : bucket.mpCostValue.div(bucket.mpConsumed);

  return {
    productAlias: bucket.alias,
    productLabel: PRODUCT_LABELS[bucket.alias] ?? bucket.alias,
    quantityUnits: formatDecimal(bucket.qtyUnits, 2),
    averageUnitPrice: formatDecimal(avgUnitPrice, 2),
    pricePerSc: formatDecimal(pricePerSc, 2),
    mpConsumedSc: formatDecimal(bucket.mpConsumed, 2),
    averageMpCostSc: formatDecimal(avgMpCostSc, 2),
  };
}

async function buildSalesByPeriodReport({ from, to }) {
  const { start, end } = validatePeriod({ from, to });
  const inclusiveStart = new Date(start);
  inclusiveStart.setUTCHours(0, 0, 0, 0);
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setUTCHours(23, 59, 59, 999);

  const baseReport = await buildConsolidatedKardexReport({ until: inclusiveEnd });
  const finishedSales = Array.isArray(baseReport?.finishedSales)
    ? baseReport.finishedSales
    : [];

  const aggregates = new Map();
  const totals = {
    qtyUnits: new Decimal(0),
    netValue: new Decimal(0),
    mpConsumed: new Decimal(0),
    mpCostValue: new Decimal(0),
  };

  finishedSales.forEach((sale) => {
    if (!isWithinPeriod(sale.timestamp, inclusiveStart, inclusiveEnd)) {
      return;
    }
    if (!PRODUCT_ORDER.includes(sale.productAlias)) {
      return;
    }

    const qtyUnits = toDecimal(sale.qtyUnits);
    const unitPrice = toDecimal(sale.unitPrice);
    const netValue = unitPrice.mul(qtyUnits);
    const mpConsumed = toDecimal(sale.mpConsumedSc);
    const mpCostValue = sale.mpCostValue != null ? toDecimal(sale.mpCostValue) : new Decimal(0);

    if (!aggregates.has(sale.productAlias)) {
      aggregates.set(sale.productAlias, {
        alias: sale.productAlias,
        qtyUnits: new Decimal(0),
        netValue: new Decimal(0),
        mpConsumed: new Decimal(0),
        mpCostValue: new Decimal(0),
        hasEntries: false,
      });
    }

    const bucket = aggregates.get(sale.productAlias);
    bucket.qtyUnits = bucket.qtyUnits.add(qtyUnits);
    bucket.netValue = bucket.netValue.add(netValue);
    bucket.mpConsumed = bucket.mpConsumed.add(mpConsumed);
    bucket.mpCostValue = bucket.mpCostValue.add(mpCostValue);
    bucket.hasEntries = true;

    totals.qtyUnits = totals.qtyUnits.add(qtyUnits);
    totals.netValue = totals.netValue.add(netValue);
    totals.mpConsumed = totals.mpConsumed.add(mpConsumed);
    totals.mpCostValue = totals.mpCostValue.add(mpCostValue);
  });

  const products = PRODUCT_ORDER
    .map((alias) => aggregates.get(alias))
    .filter((bucket) => bucket && bucket.hasEntries)
    .map((bucket) => buildProductRow(bucket));

  const averageMpCostGlobal = totals.mpConsumed.isZero()
    ? new Decimal(0)
    : totals.mpCostValue.div(totals.mpConsumed);

  return {
    filters: {
      from: inclusiveStart.toISOString(),
      to: inclusiveEnd.toISOString(),
    },
    products,
    totals: {
      quantityUnits: formatDecimal(totals.qtyUnits, 2),
      mpConsumedSc: formatDecimal(totals.mpConsumed, 2),
      averageMpCostSc: formatDecimal(averageMpCostGlobal, 2),
    },
  };
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const stringValue = String(value);
  if (stringValue.includes('"') || stringValue.includes(';') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function generateSalesByPeriodCsv(report) {
  const rows = [
    ['Relatório Vendas por Período — FluiTax Kardex'],
    [
      'Período',
      `${report.filters.from.slice(0, 10)} a ${report.filters.to.slice(0, 10)}`,
    ],
    [''],
    [
      'Produto',
      'Quantidade vendida (unid)',
      'Preço médio venda (R$/unid)',
      'Preço por saca (R$/SC)',
      'MP consumida (SC)',
      'Custo médio MP (R$/SC)',
    ],
    ...report.products.map((product) => [
      product.productLabel,
      product.quantityUnits,
      product.averageUnitPrice,
      product.pricePerSc,
      product.mpConsumedSc,
      product.averageMpCostSc,
    ]),
  ];

  if (report.products.length) {
    rows.push([
      'Totais',
      report.totals.quantityUnits,
      '',
      '',
      report.totals.mpConsumedSc,
      report.totals.averageMpCostSc,
    ]);
  }

  return rows
    .map((row) => row.map(escapeCsvValue).join(';'))
    .join('\n');
}

module.exports = {
  buildSalesByPeriodReport,
  generateSalesByPeriodCsv,
};
