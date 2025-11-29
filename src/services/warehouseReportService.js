const { Prisma } = require('@prisma/client');
const { prisma } = require('../prisma');

const Decimal = Prisma.Decimal;

function toDecimal(value) {
  if (value instanceof Decimal) {
    return value;
  }
  if (value == null) {
    return new Decimal(0);
  }
  try {
    return new Decimal(value);
  } catch (error) {
    return new Decimal(0);
  }
}

function decimalToString(value) {
  return toDecimal(value).toString();
}

function mergeProductInfo(base, incoming) {
  if (!base) {
    return { ...incoming };
  }
  const result = { ...base };
  Object.keys(incoming).forEach((key) => {
    if ((result[key] == null || result[key] === '') && incoming[key] != null) {
      result[key] = incoming[key];
    }
  });
  return result;
}

function normalizeKey(value) {
  if (!value) return null;
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
}

function normalizeUnit(value) {
  if (!value) return null;
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
}

function extractProductIdentity(item) {
  const mapping = item.productMapping ?? null;
  const product = mapping?.product ?? null;

  const mappedId = product?.id ?? mapping?.productId ?? null;
  const normalizedSku = normalizeKey(product?.sku ?? item.productCode ?? null);
  const normalizedCode = normalizeKey(item.productCode ?? product?.sku ?? null);
  const normalizedDescription = normalizeKey(product?.name ?? item.description ?? null);
  const normalizedUnit = normalizeUnit(product?.unit ?? item.unit ?? null);

  let productKey = null;
  if (mappedId) {
    productKey = `PID:${mappedId}`;
  } else {
    const keyFields = [normalizedCode, normalizedSku, normalizedDescription, normalizedUnit];
    productKey = keyFields.filter(Boolean).join('|');
    if (!productKey) {
      productKey = `ITEM:${item.id}`;
    }
  }

  const productInfo = {
    productId: product?.id ?? mapping?.productId ?? null,
    productName: product?.name ?? item.description ?? null,
    productSku: product?.sku ?? null,
    productCode: item.productCode ?? product?.sku ?? null,
    productDescription: item.description ?? product?.name ?? null,
    unit: product?.unit ?? item.unit ?? null,
  };

  return {
    productKey,
    productInfo,
  };
}

function buildDetail(item, qtyDecimal, unitPriceDecimal, totalDecimal) {
  return {
    invoiceId: item.invoiceId,
    invoiceChave: item.invoice?.chave ?? null,
    invoiceNumero: item.invoice?.numero ?? null,
    invoiceEmissao: item.invoice?.emissao ? item.invoice.emissao.toISOString() : null,
    natOp: item.invoice?.natOp ?? null,
    quantity: decimalToString(qtyDecimal),
    unitPrice: decimalToString(unitPriceDecimal),
    totalValue: decimalToString(totalDecimal),
  };
}

function ensureGroup(storage, key, payload) {
  if (!storage.has(key)) {
    storage.set(key, {
      key,
      productKey: payload.productKey,
      product: { ...payload.productInfo },
      unitPrice: payload.unitPrice,
      openingQty: new Decimal(0),
      openingValue: new Decimal(0),
      remessaQty: new Decimal(0),
      remessaValue: new Decimal(0),
      retornoQty: new Decimal(0),
      retornoValue: new Decimal(0),
      availableQty: new Decimal(0),
      availableValue: new Decimal(0),
      remessas: [],
      retornos: [],
      hasRemessa: false,
      hasRetorno: false,
      hadHistoricRemessa: false,
      flags: {
        unmatchedReturnValue: false,
        returnWithoutRemessa: false,
        valueDrift: false,
      },
    });
  } else {
    const group = storage.get(key);
    group.product = mergeProductInfo(group.product, payload.productInfo);
    if (!group.unitPrice && payload.unitPrice) {
      group.unitPrice = payload.unitPrice;
    }
    group.openingQty = group.openingQty instanceof Decimal ? group.openingQty : toDecimal(group.openingQty);
    group.openingValue = group.openingValue instanceof Decimal ? group.openingValue : toDecimal(group.openingValue);
    group.remessaQty = group.remessaQty instanceof Decimal ? group.remessaQty : toDecimal(group.remessaQty);
    group.remessaValue = group.remessaValue instanceof Decimal ? group.remessaValue : toDecimal(group.remessaValue);
    group.retornoQty = group.retornoQty instanceof Decimal ? group.retornoQty : toDecimal(group.retornoQty);
    group.retornoValue = group.retornoValue instanceof Decimal ? group.retornoValue : toDecimal(group.retornoValue);
    group.availableQty = group.availableQty instanceof Decimal ? group.availableQty : toDecimal(group.availableQty);
    group.availableValue = group.availableValue instanceof Decimal ? group.availableValue : toDecimal(group.availableValue);
  }
  return storage.get(key);
}

async function buildWarehouseGeneralReport({ companyId, from, to }) {
  if (!companyId) {
    throw new Error('companyId é obrigatório');
  }

  const invoiceDateFilter = {};
  if (from) {
    invoiceDateFilter.gte = from;
  }
  if (to) {
    invoiceDateFilter.lte = to;
  }

  const invoiceFilter = {
    companyId,
    ...(Object.keys(invoiceDateFilter).length ? { emissao: invoiceDateFilter } : {}),
  };

  const remessaFilter = {
    cfopCode: '5905',
    invoice: {
      ...invoiceFilter,
      AND: [
        { natOp: { contains: 'ARMAZEM', mode: 'insensitive' } },
        { natOp: { contains: 'REMESS', mode: 'insensitive' } },
      ],
    },
  };

  const retornoFilter = {
    cfopCode: '5906',
    invoice: {
      ...invoiceFilter,
      AND: [
        { natOp: { contains: 'ARMAZEM', mode: 'insensitive' } },
        { natOp: { contains: 'RETORN', mode: 'insensitive' } },
      ],
    },
  };

  const commonSelect = {
    id: true,
    invoiceId: true,
    cfopCode: true,
    qty: true,
    unitPrice: true,
    gross: true,
    productCode: true,
    description: true,
    unit: true,
    invoice: {
      select: {
        id: true,
        emissao: true,
        chave: true,
        numero: true,
        natOp: true,
      },
    },
    productMapping: {
      select: {
        productId: true,
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
          },
        },
      },
    },
  };

  const buildWhere = (cfopCode, dateConstraint) => ({
    cfopCode,
    invoice: {
      companyId,
      ...(dateConstraint ? { emissao: dateConstraint } : {}),
    },
  });

  const orderBy = [{ invoice: { emissao: 'asc' } }, { id: 'asc' }];

  const periodDateConstraint = Object.keys(invoiceDateFilter).length ? invoiceDateFilter : null;
  const historicDateConstraint = from ? { lt: from } : null;

  const fetchItems = (where) => {
    if (!where) return Promise.resolve([]);
    return prisma.invoiceItem.findMany({ where, orderBy, select: commonSelect });
  };

  const [
    remessas,
    retornos,
    historicRemessas,
    historicRetornos,
  ] = await Promise.all([
    fetchItems(buildWhere('5905', periodDateConstraint)),
    fetchItems(buildWhere('5906', periodDateConstraint)),
    fetchItems(historicDateConstraint ? buildWhere('5905', historicDateConstraint) : null),
    fetchItems(historicDateConstraint ? buildWhere('5906', historicDateConstraint) : null),
  ]);

  const groups = new Map();
  const mismatches = [];
  const anomalies = [];

  const ZERO = new Decimal(0);
  const VALUE_TOLERANCE = new Decimal('0.01');

  const totalsPeriod = {
    remessaQty: ZERO,
    remessaValue: ZERO,
    retornoQty: ZERO,
    retornoValue: ZERO,
  };

  const totalsOpening = {
    qty: ZERO,
    value: ZERO,
  };

  const recordAnomaly = (type, item, message) => {
    anomalies.push({
      type,
      message,
      invoice: {
        id: item.invoiceId,
        chave: item.invoice?.chave ?? null,
        numero: item.invoice?.numero ?? null,
        emissao: item.invoice?.emissao ? item.invoice.emissao.toISOString() : null,
        natOp: item.invoice?.natOp ?? null,
      },
      cfop: item.cfopCode,
      product: {
        code: item.productCode ?? null,
        description: item.description ?? null,
        unit: item.unit ?? null,
      },
      qty: item.qty,
      unitPrice: item.unitPrice,
      gross: item.gross,
    });
  };

  const applyRemessa = (item, scope) => {
    const qty = toDecimal(item.qty);
    if (qty.lte(0)) {
      recordAnomaly('INVALID_QUANTITY', item, 'Quantidade de remessa vazia ou negativa. Item desconsiderado.');
      return;
    }

    let unitPrice = toDecimal(item.unitPrice);
    if (unitPrice.lte(0) && item.gross != null) {
      const gross = toDecimal(item.gross);
      if (!qty.isZero()) {
        unitPrice = gross.dividedBy(qty);
      }
    }
    if (unitPrice.lte(0)) {
      recordAnomaly('INVALID_UNIT_PRICE', item, 'Valor unitário da remessa ausente. Item desconsiderado.');
      return;
    }

    const totalValue = item.gross != null ? toDecimal(item.gross) : unitPrice.times(qty);
    const { productKey, productInfo } = extractProductIdentity(item);
    const unitPriceKey = unitPrice.toString();
    const groupKey = `${productKey}::${unitPriceKey}`;

    const group = ensureGroup(groups, groupKey, {
      productKey,
      productInfo,
      unitPrice,
    });

    group.hadHistoricRemessa = true;

    if (scope === 'opening') {
      group.openingQty = group.openingQty.plus(qty);
      group.openingValue = group.openingValue.plus(totalValue);
      group.availableQty = group.availableQty.plus(qty);
      group.availableValue = group.availableValue.plus(totalValue);
      totalsOpening.qty = totalsOpening.qty.plus(qty);
      totalsOpening.value = totalsOpening.value.plus(totalValue);
      return;
    }

    group.hasRemessa = true;
    group.remessaQty = group.remessaQty.plus(qty);
    group.remessaValue = group.remessaValue.plus(totalValue);
    group.remessas.push(buildDetail(item, qty, unitPrice, totalValue));
    group.availableQty = group.availableQty.plus(qty);
    group.availableValue = group.availableValue.plus(totalValue);

    totalsPeriod.remessaQty = totalsPeriod.remessaQty.plus(qty);
    totalsPeriod.remessaValue = totalsPeriod.remessaValue.plus(totalValue);
  };

  const applyRetorno = (item, scope) => {
    const qty = toDecimal(item.qty);
    if (qty.lte(0)) {
      recordAnomaly('INVALID_QUANTITY', item, 'Quantidade de retorno vazia ou negativa. Item desconsiderado.');
      return;
    }

    let unitPrice = toDecimal(item.unitPrice);
    if (unitPrice.lte(0) && item.gross != null) {
      const gross = toDecimal(item.gross);
      if (!qty.isZero()) {
        unitPrice = gross.dividedBy(qty);
      }
    }
    if (unitPrice.lte(0)) {
      recordAnomaly('INVALID_UNIT_PRICE', item, 'Valor unitário do retorno ausente. Item desconsiderado.');
      return;
    }

    const totalValue = item.gross != null ? toDecimal(item.gross) : unitPrice.times(qty);
    const { productKey, productInfo } = extractProductIdentity(item);
    const unitPriceKey = unitPrice.toString();
    const groupKey = `${productKey}::${unitPriceKey}`;

    const group = ensureGroup(groups, groupKey, {
      productKey,
      productInfo,
      unitPrice,
    });

    if (scope === 'opening') {
      group.openingQty = group.openingQty.minus(qty);
      group.openingValue = group.openingValue.minus(totalValue);
      group.availableQty = group.availableQty.minus(qty);
      group.availableValue = group.availableValue.minus(totalValue);
      totalsOpening.qty = totalsOpening.qty.minus(qty);
      totalsOpening.value = totalsOpening.value.minus(totalValue);
      return;
    }

    group.hasRetorno = true;
    const priceDiff = unitPrice.minus(group.unitPrice).abs();
    const hadRemessa = group.availableQty.gt(0) || group.hasRemessa || group.hadHistoricRemessa;

    if (!hadRemessa || group.availableQty.lte(0)) {
      group.flags.returnWithoutRemessa = true;
      mismatches.push({
        type: 'RETURN_WITHOUT_REMESSA',
        message: 'Retorno sem remessa correspondente.',
        product: { ...group.product },
        unitPrice: decimalToString(unitPrice),
        quantity: decimalToString(qty),
        totalValue: decimalToString(totalValue),
        invoice: {
          id: item.invoiceId,
          chave: item.invoice?.chave ?? null,
          numero: item.invoice?.numero ?? null,
          emissao: item.invoice?.emissao ? item.invoice.emissao.toISOString() : null,
          natOp: item.invoice?.natOp ?? null,
        },
      });
    } else if (priceDiff.gt(VALUE_TOLERANCE)) {
      group.flags.unmatchedReturnValue = true;
      mismatches.push({
        type: 'UNIT_PRICE_MISMATCH',
        message: 'Retorno com valor unitário diferente das remessas registradas.',
        product: { ...group.product },
        unitPrice: decimalToString(unitPrice),
        quantity: decimalToString(qty),
        totalValue: decimalToString(totalValue),
        invoice: {
          id: item.invoiceId,
          chave: item.invoice?.chave ?? null,
          numero: item.invoice?.numero ?? null,
          emissao: item.invoice?.emissao ? item.invoice.emissao.toISOString() : null,
          natOp: item.invoice?.natOp ?? null,
        },
      });
    }

    group.retornoQty = group.retornoQty.plus(qty);
    group.retornoValue = group.retornoValue.plus(totalValue);
    group.retornos.push(buildDetail(item, qty, unitPrice, totalValue));
    group.availableQty = group.availableQty.minus(qty);
    group.availableValue = group.availableValue.minus(totalValue);

    totalsPeriod.retornoQty = totalsPeriod.retornoQty.plus(qty);
    totalsPeriod.retornoValue = totalsPeriod.retornoValue.plus(totalValue);
  };

  historicRemessas.forEach((item) => applyRemessa(item, 'opening'));
  historicRetornos.forEach((item) => applyRetorno(item, 'opening'));
  remessas.forEach((item) => applyRemessa(item, 'period'));
  retornos.forEach((item) => applyRetorno(item, 'period'));

  const groupList = Array.from(groups.values()).map((group) => {
    const closingQtyDecimal = group.availableQty;
    const closingValueDecimal = group.availableValue;
    const expectedClosingValue = toDecimal(group.unitPrice).times(closingQtyDecimal);
    const valueDelta = closingValueDecimal.minus(expectedClosingValue).abs();
    const negativeBalance = closingQtyDecimal.isNegative();

    if (valueDelta.gt(VALUE_TOLERANCE)) {
      group.flags.valueDrift = true;
      mismatches.push({
        type: 'VALUE_DRIFT',
        message: 'Saldo financeiro não condiz com a multiplicação da quantidade pelo valor unitário.',
        product: { ...group.product },
        unitPrice: decimalToString(group.unitPrice),
        quantity: decimalToString(closingQtyDecimal),
        totalValue: decimalToString(closingValueDecimal),
        deltaValue: decimalToString(valueDelta),
        invoice: null,
      });
    }

    return {
      product: group.product,
      unitPrice: decimalToString(group.unitPrice),
      openingQty: decimalToString(group.openingQty),
      openingValue: decimalToString(group.openingValue),
      remessaQty: decimalToString(group.remessaQty),
      remessaValue: decimalToString(group.remessaValue),
      retornoQty: decimalToString(group.retornoQty),
      retornoValue: decimalToString(group.retornoValue),
      closingQty: decimalToString(closingQtyDecimal),
      closingValue: decimalToString(closingValueDecimal),
      hasRemessa: group.hasRemessa || group.hadHistoricRemessa,
      hasRetorno: group.hasRetorno,
      flags: {
        unmatchedReturnValue: group.flags.unmatchedReturnValue,
        returnWithoutRemessa: group.flags.returnWithoutRemessa,
        negativeBalance,
        valueDrift: Boolean(group.flags.valueDrift),
      },
      remessas: group.remessas,
      retornos: group.retornos,
    };
  });

  groupList.sort((a, b) => {
    const nameA = (a.product.productName ?? a.product.productDescription ?? a.product.productCode ?? '').toUpperCase();
    const nameB = (b.product.productName ?? b.product.productDescription ?? b.product.productCode ?? '').toUpperCase();
    if (nameA > nameB) return 1;
    if (nameA < nameB) return -1;
    const priceA = toDecimal(a.unitPrice);
    const priceB = toDecimal(b.unitPrice);
    if (!priceA.equals(priceB)) {
      return priceA.comparedTo(priceB);
    }
    return 0;
  });

  const totals = {
    openingQty: decimalToString(totalsOpening.qty),
    openingValue: decimalToString(totalsOpening.value),
    remessaQty: decimalToString(totalsPeriod.remessaQty),
    remessaValue: decimalToString(totalsPeriod.remessaValue),
    retornoQty: decimalToString(totalsPeriod.retornoQty),
    retornoValue: decimalToString(totalsPeriod.retornoValue),
  };

  const closingQtyTotal = totalsOpening.qty.plus(totalsPeriod.remessaQty).minus(totalsPeriod.retornoQty);
  const closingValueTotal = totalsOpening.value.plus(totalsPeriod.remessaValue).minus(totalsPeriod.retornoValue);

  totals.closingQty = decimalToString(closingQtyTotal);
  totals.closingValue = decimalToString(closingValueTotal);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      remessaCfop: '5905',
      retornoCfop: '5906',
    },
    totals,
    groups: groupList,
    mismatches,
    issues: anomalies,
  };
}

module.exports = {
  buildWarehouseGeneralReport,
};
