const { Prisma } = require('@prisma/client');
const { prisma } = require('../prisma');
const {
  MIN_START_DATE_ISO,
  PRODUCT_ALIAS,
  PRODUCT_NORMALIZATION_MAP,
  CONSUMPTION_RATIO_SC_PER_UNIT,
  BLOCKED_CNPJS,
  TARGET_COMPANY_MATCHERS,
  INITIAL_STOCK_SC,
  INITIAL_COST_PER_SC,
} = require('../constants/kardexConsolidated');

const Decimal = Prisma.Decimal;
const BLOCKED_CNPJ_SET = new Set(
  BLOCKED_CNPJS.map((value) => normalizeCnpj(value)).filter((value) => value.length === 14),
);
const MOVEMENT_STATUS = Object.freeze({
  NORMAL: 'NORMAL',
  BLOCKED_ZERO_BALANCE: 'BLOCKED_ZERO_BALANCE',
});

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

function decimalToNumber(value, fractionDigits = 2) {
  const decimal = toDecimal(value);
  return Number(decimal.toFixed(fractionDigits));
}

function decimalToString(value, fractionDigits = 2) {
  const decimal = toDecimal(value);
  return decimal.toFixed(fractionDigits);
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

function normalizeKey(value) {
  if (!value) return '';
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function normalizeUnit(value) {
  if (!value) return '';
  return normalizeText(value);
}

function normalizeCnpj(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

function parseTargetCompanyIdsFromEnv() {
  const raw = process.env.KARDEX_CONSOLIDATED_COMPANY_IDS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch (error) {
    // ignore malformed value
  }
  return null;
}

function parseTargetCompanyCnpjsFromEnv() {
  const raw = process.env.KARDEX_CONSOLIDATED_COMPANY_CNPJS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const normalized = parsed
        .map((value) => {
          if (!value) return null;
          const digits = normalizeCnpj(value);
          return digits.length === 14 ? digits : null;
        })
        .filter(Boolean);
      if (normalized.length) {
        return normalized;
      }
    }
  } catch (error) {
    // ignore malformed value
  }
  return null;
}

function normalizeTokens(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function companyMatchesTokens(company, matcher) {
  const companyTokens = normalizeTokens(company.name);
  const expectedTokens = matcher.nameTokens.map(normalizeText);
  return expectedTokens.every((token) => companyTokens.includes(token));
}

async function resolveTargetCompanies() {
  const envIds = parseTargetCompanyIdsFromEnv();
  if (envIds && envIds.length) {
    const records = await prisma.company.findMany({
      where: { id: { in: envIds } },
      select: { id: true, name: true, cnpj: true },
    });
    const map = new Map(records.map((record) => [record.id, record]));
    const ordered = envIds.map((id) => map.get(id)).filter(Boolean);
    if (!ordered.length) {
      const error = new Error('Nenhuma empresa correspondente aos IDs fornecidos em KARDEX_CONSOLIDATED_COMPANY_IDS.');
      error.status = 400;
      throw error;
    }
    if (ordered.length !== envIds.length) {
      const missingIds = envIds.filter((id) => !map.has(id));
      const error = new Error(`Empresas não encontradas para os IDs: ${missingIds.join(', ')}`);
      error.status = 400;
      throw error;
    }
    return ordered.map((company) => ({
      ...company,
      alias: TARGET_COMPANY_MATCHERS.find((matcher) => companyMatchesTokens(company, matcher))?.alias ?? null,
      cnpjDigits: normalizeCnpj(company.cnpj),
    }));
  }

  const envCnpjs = parseTargetCompanyCnpjsFromEnv();
  if (envCnpjs && envCnpjs.length) {
    const records = await prisma.company.findMany({
      where: { cnpj: { in: envCnpjs } },
      select: { id: true, name: true, cnpj: true },
    });
    const map = new Map(records.map((record) => [normalizeCnpj(record.cnpj), record]));
    const ordered = envCnpjs.map((cnpj) => map.get(cnpj)).filter(Boolean);
    if (!ordered.length) {
      const error = new Error('Nenhuma empresa correspondente aos CNPJs fornecidos em KARDEX_CONSOLIDATED_COMPANY_CNPJS.');
      error.status = 400;
      throw error;
    }
    if (ordered.length !== envCnpjs.length) {
      const missingCnpjs = envCnpjs.filter((cnpj) => !map.has(cnpj));
      const error = new Error(`Empresas não encontradas para os CNPJs: ${missingCnpjs.join(', ')}`);
      error.status = 400;
      throw error;
    }
    return ordered.map((company) => ({
      ...company,
      alias: TARGET_COMPANY_MATCHERS.find((matcher) => companyMatchesTokens(company, matcher))?.alias ?? null,
      cnpjDigits: normalizeCnpj(company.cnpj),
    }));
  }

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, cnpj: true },
  });

  const matched = [];
  TARGET_COMPANY_MATCHERS.forEach((matcher) => {
    const candidate = companies.find((company) => companyMatchesTokens(company, matcher));
    if (candidate) {
      matched.push({
        ...candidate,
        alias: matcher.alias,
        cnpjDigits: normalizeCnpj(candidate.cnpj),
      });
    }
  });

  if (!matched.length) {
    const error = new Error('Nenhuma empresa alvo encontrada para o Kardex consolidado.');
    error.status = 400;
    throw error;
  }

  if (matched.length < TARGET_COMPANY_MATCHERS.length) {
    const matchedAliases = matched.map((company) => company.alias);
    const missingAliases = TARGET_COMPANY_MATCHERS
      .map((matcher) => matcher.alias)
      .filter((alias) => !matchedAliases.includes(alias));
    const error = new Error(`Empresas alvo não encontradas: ${missingAliases.join(', ')}`);
    error.status = 400;
    throw error;
  }

  return matched;
}

function buildProductAliasLookup() {
  const lookup = new Map();
  Object.entries(PRODUCT_NORMALIZATION_MAP).forEach(([alias, values]) => {
    values.forEach((entry) => {
      const key = normalizeKey(entry);
      if (key) {
        lookup.set(key, alias);
      }
    });
  });
  return lookup;
}

function resolveAliasByHeuristics(normalizedKey) {
  if (!normalizedKey) return null;

  const mpNeedles = ['CAFECONILON', 'CAFECONILLON', 'CAFECANILON'];
  const hasMpNeedle = mpNeedles.some((needle) => normalizedKey.includes(needle));
  if (hasMpNeedle && normalizedKey.includes('BENEFICIAD')) {
    return PRODUCT_ALIAS.MP_CONILON;
  }

  return null;
}

function resolveProductAlias(item, aliasLookup) {
  const candidates = [
    item.productMapping?.product?.name,
    item.productMapping?.product?.description,
    item.description,
    item.productCode,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalizedKey = normalizeKey(candidate);
    if (aliasLookup.has(normalizedKey)) {
      return aliasLookup.get(normalizedKey);
    }
    const heuristicAlias = resolveAliasByHeuristics(normalizedKey);
    if (heuristicAlias) {
      return heuristicAlias;
    }
  }

  return null;
}

function convertQtyToSc(quantity, unitRaw) {
  const qty = toDecimal(quantity);
  const unit = normalizeUnit(unitRaw);

  if (unit === 'KG' || unit === 'KILOGRAMA' || unit === 'KILOGRAMAS') {
    return qty.div(60);
  }

  if (unit === 'SC' || unit === 'SACA' || unit === 'SACAS' || unit === 'SC60KG' || unit === 'SACAS DE 60KG') {
    return qty;
  }

  if (unit === 'TON' || unit === 'TONELADA' || unit === 'TONELADAS') {
    return qty.mul(1000).div(60);
  }

  return qty;
}

function roundDecimal(value, fractionDigits = 6) {
  return toDecimal(toDecimal(value).toFixed(fractionDigits));
}

function buildEventSortKey(event) {
  return [
    event.timestamp ? new Date(event.timestamp).getTime() : 0,
    event.invoiceId ?? '',
    event.itemId ?? '',
    event.eventOrder ?? 0,
  ];
}

function compareEvents(a, b) {
  const keyA = buildEventSortKey(a);
  const keyB = buildEventSortKey(b);
  for (let i = 0; i < keyA.length; i += 1) {
    if (keyA[i] === keyB[i]) continue;
    if (keyA[i] == null) return -1;
    if (keyB[i] == null) return 1;
    if (keyA[i] < keyB[i]) return -1;
    if (keyA[i] > keyB[i]) return 1;
  }
  return 0;
}

function formatDateOnlyKey(date) {
  const normalized = new Date(date);
  if (Number.isNaN(normalized.getTime())) {
    return null;
  }
  const year = normalized.getUTCFullYear();
  const month = (normalized.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = normalized.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildInitialStockEntry(startDateIso) {
  const balanceQty = toDecimal(INITIAL_STOCK_SC);
  const costAverage = toDecimal(INITIAL_COST_PER_SC);
  const balanceValue = balanceQty.mul(costAverage);
  return {
    type: 'SALDO_INICIAL',
    timestamp: startDateIso,
    document: null,
    partner: null,
    cfop: null,
    qtySc: new Decimal(0),
    requestedQtySc: new Decimal(0),
    unitCostSc: costAverage,
    movingAverageCost: costAverage,
    balanceSc: balanceQty,
    balanceValue,
    notes: 'Saldo inicial',
    invoiceId: null,
    itemId: null,
    status: MOVEMENT_STATUS.NORMAL,
    costRestart: false,
  };
}

function computeUnitNetPrice(item) {
  const qty = toDecimal(item.qty);
  if (qty.isZero()) {
    return new Decimal(0);
  }
  const gross = toDecimal(item.gross);
  const discount = toDecimal(item.discount ?? 0);
  const netTotal = gross.sub(discount);
  return netTotal.div(qty);
}

async function fetchPartnersMap(companyIds) {
  const partners = await prisma.partner.findMany({
    where: { companyId: { in: companyIds } },
    select: { companyId: true, cnpjCpf: true, name: true },
  });
  const map = new Map();
  partners.forEach((partner) => {
    const normalized = normalizeCnpj(partner.cnpjCpf);
    if (!normalized) return;
    map.set(`${partner.companyId}:${normalized}`, partner.name);
  });
  return map;
}

function resolvePartnerName({ invoice, companyInfo, partnerMap }) {
  if (!invoice) return null;
  const company = companyInfo.get(invoice.companyId);
  const issuer = normalizeCnpj(invoice.issuerCnpj);
  const recipient = normalizeCnpj(invoice.recipientCnpj);

  let partnerCnpj = null;
  if (invoice.type === 'IN') {
    partnerCnpj = issuer !== company?.cnpjDigits ? issuer : recipient;
  } else {
    partnerCnpj = recipient !== company?.cnpjDigits ? recipient : issuer;
  }

  if (!partnerCnpj) return null;
  const partnerKey = `${invoice.companyId}:${partnerCnpj}`;
  if (partnerMap.has(partnerKey)) {
    return partnerMap.get(partnerKey);
  }
  return partnerCnpj;
}

function resolvePartnerCnpj({ invoice, companyInfo }) {
  if (!invoice) return null;
  const issuer = normalizeCnpj(invoice.issuerCnpj);
  const recipient = normalizeCnpj(invoice.recipientCnpj);
  const company = companyInfo.get(invoice.companyId);
  if (invoice.type === 'IN') {
    return issuer !== company?.cnpjDigits ? issuer : recipient;
  }
  return recipient !== company?.cnpjDigits ? recipient : issuer;
}

function shouldExcludeInvoice(invoice, companyCnpjs) {
  const issuer = normalizeCnpj(invoice.issuerCnpj);
  const recipient = normalizeCnpj(invoice.recipientCnpj);
  if ((issuer && BLOCKED_CNPJ_SET.has(issuer)) || (recipient && BLOCKED_CNPJ_SET.has(recipient))) {
    return true;
  }

  const values = Array.from(companyCnpjs.values());
  if (values.length >= 2) {
    const [first, second] = values;
    const pairA = issuer === first && recipient === second;
    const pairB = issuer === second && recipient === first;
    if (pairA || pairB) {
      return true;
    }
  }

  return false;
}

function ensureDate(date) {
  return date instanceof Date ? date : new Date(date);
}

function prepareJsonDecimal(dec, options = {}) {
  const { fractionDigits = 2, asNumber = false } = options;
  const formatted = decimalToString(dec, fractionDigits);
  if (asNumber) {
    return Number(formatted);
  }
  return formatted;
}

function describeMovementStatus(status) {
  switch (status) {
    case MOVEMENT_STATUS.BLOCKED_ZERO_BALANCE:
      return 'Bloqueada (saldo zero)';
    case MOVEMENT_STATUS.NORMAL:
    default:
      return 'Normal';
  }
}

async function buildConsolidatedKardexReport({ from, until }) {
  const companies = await resolveTargetCompanies();
  const companyIds = companies.map((company) => company.id);
  const companyInfo = new Map(companies.map((company) => [company.id, company]));
  const companyCnpjs = new Map(companies.map((company) => [company.id, company.cnpjDigits]));

  const minStart = new Date(MIN_START_DATE_ISO);
  const fromDate = from ? ensureDate(from) : null;
  const untilDate = until
    ? ensureDate(until)
    : new Date();
  untilDate.setUTCHours(23, 59, 59, 999);

  const earliestInvoice = await prisma.invoice.findFirst({
    where: {
      companyId: { in: companyIds },
      emissao: { gte: minStart, lte: untilDate },
    },
    orderBy: { emissao: 'asc' },
    select: { emissao: true },
  });

  const queryStartCandidate = earliestInvoice?.emissao ?? minStart;
  const queryStartDate = queryStartCandidate < minStart ? minStart : queryStartCandidate;
  const queryStartDateUtc = new Date(queryStartDate);
  queryStartDateUtc.setUTCHours(0, 0, 0, 0);

  const partnerMap = await fetchPartnersMap(companyIds);
  const aliasLookup = buildProductAliasLookup();

  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        companyId: { in: companyIds },
        emissao: { gte: queryStartDateUtc, lte: untilDate },
      },
      cfopCode: { notIn: ['5905', '5906'] },
    },
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
      discount: true,
      productMapping: {
        select: {
          productId: true,
          product: {
            select: {
              id: true,
              name: true,
              description: true,
              unit: true,
            },
          },
        },
      },
      invoice: {
        select: {
          id: true,
          emissao: true,
          numero: true,
          type: true,
          issuerCnpj: true,
          recipientCnpj: true,
          natOp: true,
          chave: true,
          companyId: true,
        },
      },
    },
    orderBy: [
      { invoice: { emissao: 'asc' } },
      { invoiceId: 'asc' },
      { id: 'asc' },
    ],
  });

  const relevantItems = [];
  const excludedInvoices = new Set();
  items.forEach((item) => {
    if (!item.invoice) return;
    if (excludedInvoices.has(item.invoice.id)) {
      return;
    }
    if (shouldExcludeInvoice(item.invoice, companyCnpjs)) {
      excludedInvoices.add(item.invoice.id);
      return;
    }
    const alias = resolveProductAlias(item, aliasLookup);
    if (!alias) {
      return;
    }
    relevantItems.push({
      ...item,
      productAlias: alias,
    });
  });

  const initialEntry = buildInitialStockEntry(queryStartDateUtc.toISOString());

  let currentBalanceQty = toDecimal(initialEntry.balanceSc);
  let currentBalanceValue = toDecimal(initialEntry.balanceValue);
  let movingAverageCost = currentBalanceQty.isZero()
    ? toDecimal(0)
    : currentBalanceValue.div(currentBalanceQty);

  const mpMovements = [initialEntry];
  const finishedSales = [];
  const events = [];

  relevantItems.forEach((item) => {
    const alias = item.productAlias;
    const invoiceDateIso = item.invoice?.emissao?.toISOString() ?? null;
    const partnerName = resolvePartnerName({ invoice: item.invoice, companyInfo, partnerMap });
    const partnerCnpj = resolvePartnerCnpj({ invoice: item.invoice, companyInfo });
    const document = item.invoice?.numero ?? item.invoice?.chave ?? null;

    if (alias === PRODUCT_ALIAS.MP_CONILON) {
      const qtyNative = toDecimal(item.qty);
      const qtySc = convertQtyToSc(qtyNative, item.unit);
      const unitPriceNative = computeUnitNetPrice(item);
      const netTotal = unitPriceNative.mul(qtyNative);
      const unitCostSc = qtySc.isZero() ? new Decimal(0) : netTotal.div(qtySc);

      if (item.invoice.type === 'IN') {
  events.push({
    type: 'ENTRY',
    timestamp: invoiceDateIso,
    invoiceId: item.invoice.id,
    itemId: item.id,
    qtySc,
    qtyNative,
    netTotal,
    unitCostSc,
    unitPriceNative,
          partnerName,
          partnerCnpj,
          document,
          cfop: item.cfopCode ?? null,
          notes: 'Entrada MP',
          eventOrder: 0,
        });
      } else {
  events.push({
    type: 'EXIT',
    timestamp: invoiceDateIso,
    invoiceId: item.invoice.id,
    itemId: item.id,
    qtySc,
    qtyNative,
    netTotal,
    unitCostSc,
    unitPriceNative,
          partnerName,
          partnerCnpj,
          document,
          cfop: item.cfopCode ?? null,
          notes: 'Venda MP',
          eventOrder: 1,
        });
      }
      return;
    }

    if (
      alias === PRODUCT_ALIAS.ACABADO_RANCHO_10X500
      || alias === PRODUCT_ALIAS.ACABADO_RANCHO_20X250
      || alias === PRODUCT_ALIAS.ACABADO_NOVAERA_10X500
    ) {
      if (item.invoice.type !== 'OUT') {
        return;
      }
      const qtyUnits = toDecimal(item.qty);
      if (qtyUnits.isZero()) {
        return;
      }

      const unitNetPrice = computeUnitNetPrice(item);
      const mpConsumedSc = qtyUnits.mul(CONSUMPTION_RATIO_SC_PER_UNIT);
      const saleRecord = {
        timestamp: invoiceDateIso,
        invoiceId: item.invoice.id,
        itemId: item.id,
        productAlias: alias,
        qtyUnits,
        unitNetPrice,
        mpConsumedSc,
        partnerName,
        partnerCnpj,
        document,
        cfop: item.cfopCode ?? null,
        natOp: item.invoice.natOp ?? null,
        costAverageSc: null,
        mpCostValue: null,
        valuePerSc: unitNetPrice.mul(9.6),
      };
      finishedSales.push(saleRecord);

      events.push({
        type: 'CONSUMPTION',
        timestamp: invoiceDateIso,
        invoiceId: item.invoice.id,
        itemId: item.id,
        qtySc: mpConsumedSc,
        partnerName,
        partnerCnpj,
        document,
        cfop: item.cfopCode ?? null,
        notes: `Consumo por ${alias}`,
        saleRecord,
        eventOrder: 2,
      });
    }
  });

  events.sort(compareEvents);

events.forEach((event) => {
  if (event.type === 'ENTRY') {
    const entryQty = roundDecimal(event.qtySc, 6);
    const requestedQty = entryQty;
    let movementUnitCost = event.unitCostSc ?? null;
    if (!movementUnitCost) {
      if (event.netTotal) {
        movementUnitCost = entryQty.isZero() ? new Decimal(0) : roundDecimal(event.netTotal.div(entryQty), 6);
      } else {
        movementUnitCost = movingAverageCost;
      }
    }
    const entryValue = event.netTotal
      ? roundDecimal(event.netTotal, 6)
      : roundDecimal(movementUnitCost.mul(entryQty), 6);
    const previousBalanceQty = currentBalanceQty;
    const previousBalanceValue = currentBalanceValue;

    const costRestart = previousBalanceQty.isZero() && entryQty.gt(0);

    currentBalanceQty = roundDecimal(currentBalanceQty.add(entryQty), 6);
    currentBalanceValue = roundDecimal(currentBalanceValue.add(entryValue), 6);
    if (costRestart && entryQty.gt(0)) {
      movingAverageCost = movementUnitCost;
    } else if (!currentBalanceQty.isZero()) {
      movingAverageCost = roundDecimal(currentBalanceValue.div(currentBalanceQty), 6);
    }

    const movement = {
      type: 'ENTRADA',
      timestamp: event.timestamp,
      document: event.document,
      partner: event.partnerName ?? event.partnerCnpj ?? null,
      partnerCnpj: event.partnerCnpj ?? null,
      cfop: event.cfop,
      qtySc: entryQty,
      requestedQtySc: requestedQty,
      unitCostSc: movementUnitCost,
      movingAverageCost,
      balanceSc: currentBalanceQty,
      balanceValue: currentBalanceValue,
      notes: event.notes,
      invoiceId: event.invoiceId,
      itemId: event.itemId,
      previousBalanceQty,
      previousBalanceValue,
      status: MOVEMENT_STATUS.NORMAL,
      costRestart,
    };
    mpMovements.push(movement);
    return;
  }

  if (event.type === 'EXIT' || event.type === 'CONSUMPTION') {
    const requestedQty = roundDecimal(event.qtySc.abs(), 6);
    const previousBalanceQty = currentBalanceQty;
    const previousBalanceValue = currentBalanceValue;

    if (previousBalanceQty.isZero()) {
      if (event.saleRecord) {
        event.saleRecord.costAverageSc = null;
        event.saleRecord.mpCostValue = null;
        event.saleRecord.mpConsumedSc = new Decimal(0);
      }
      const blockedNotes = event.notes
        ? `${event.notes} | Movimentação não aplicada (saldo zero)`
        : 'Movimentação não aplicada (saldo zero)';
      const blockedMovement = {
        type: 'SAIDA',
        timestamp: event.timestamp,
        document: event.document,
        partner: event.partnerName ?? event.partnerCnpj ?? null,
        partnerCnpj: event.partnerCnpj ?? null,
        cfop: event.cfop,
        qtySc: new Decimal(0),
        requestedQtySc: requestedQty.neg(),
        unitCostSc: movingAverageCost,
        movingAverageCost,
        balanceSc: currentBalanceQty,
        balanceValue: currentBalanceValue,
        notes: blockedNotes,
        invoiceId: event.invoiceId,
        itemId: event.itemId,
        previousBalanceQty,
        previousBalanceValue,
        status: MOVEMENT_STATUS.BLOCKED_ZERO_BALANCE,
        costRestart: false,
      };
      mpMovements.push(blockedMovement);
      return;
    }

    const appliedQty = requestedQty.gt(previousBalanceQty) ? previousBalanceQty : requestedQty;
    const exitValueAtCost = roundDecimal(movingAverageCost.mul(appliedQty), 6);

    currentBalanceQty = roundDecimal(currentBalanceQty.sub(appliedQty), 6);
    if (currentBalanceQty.lt(0)) {
      currentBalanceQty = new Decimal(0);
    }
    currentBalanceValue = roundDecimal(currentBalanceValue.sub(exitValueAtCost), 6);
    if (currentBalanceValue.lt(0)) {
      currentBalanceValue = new Decimal(0);
    }
    if (currentBalanceQty.isZero()) {
      currentBalanceValue = new Decimal(0);
    }

    if (event.saleRecord) {
      event.saleRecord.mpConsumedSc = appliedQty;
      if (appliedQty.isZero()) {
        event.saleRecord.costAverageSc = null;
        event.saleRecord.mpCostValue = null;
      } else {
        event.saleRecord.costAverageSc = movingAverageCost;
        event.saleRecord.mpCostValue = exitValueAtCost;
      }
    }

    const notesParts = [];
    if (event.notes) {
      notesParts.push(event.notes);
    }
    if (requestedQty.gt(appliedQty)) {
      notesParts.push('Quantidade limitada ao saldo disponível');
    }
    const movementNotes = notesParts.length ? notesParts.join(' | ') : null;

    const movement = {
      type: 'SAIDA',
      timestamp: event.timestamp,
      document: event.document,
      partner: event.partnerName ?? event.partnerCnpj ?? null,
      partnerCnpj: event.partnerCnpj ?? null,
      cfop: event.cfop,
      qtySc: appliedQty.neg(),
      requestedQtySc: requestedQty.neg(),
      unitCostSc: movingAverageCost,
      movingAverageCost,
      balanceSc: currentBalanceQty,
      balanceValue: currentBalanceValue,
      notes: movementNotes,
      invoiceId: event.invoiceId,
      itemId: event.itemId,
      previousBalanceQty,
      previousBalanceValue,
      status: MOVEMENT_STATUS.NORMAL,
      costRestart: false,
    };
    mpMovements.push(movement);

    const remainingQty = requestedQty.sub(appliedQty);
    if (remainingQty.gt(0)) {
      const blockedNotesParts = ['Movimentação não aplicada (saldo zero)'];
      if (event.notes) {
        blockedNotesParts.unshift(event.notes);
      }
      blockedNotesParts.push(`Quantidade bloqueada: ${remainingQty.toFixed(4)} SC`);
      const blockedMovement = {
        type: 'SAIDA',
        timestamp: event.timestamp,
        document: event.document,
        partner: event.partnerName ?? event.partnerCnpj ?? null,
        partnerCnpj: event.partnerCnpj ?? null,
        cfop: event.cfop,
        qtySc: new Decimal(0),
        requestedQtySc: remainingQty.neg(),
        unitCostSc: movingAverageCost,
        movingAverageCost,
        balanceSc: currentBalanceQty,
        balanceValue: currentBalanceValue,
        notes: blockedNotesParts.join(' | '),
        invoiceId: event.invoiceId,
        itemId: event.itemId,
        previousBalanceQty: currentBalanceQty,
        previousBalanceValue: currentBalanceValue,
        status: MOVEMENT_STATUS.BLOCKED_ZERO_BALANCE,
        costRestart: false,
      };
      mpMovements.push(blockedMovement);
    }
    return;
  }
  });

  const mpTotalsByDay = new Map();
  mpMovements.forEach((movement) => {
    if (movement.type === 'SALDO_INICIAL') return;
    const dateKey = movement.timestamp ? formatDateOnlyKey(movement.timestamp) : null;
    if (!dateKey) return;

    if (!mpTotalsByDay.has(dateKey)) {
      mpTotalsByDay.set(dateKey, {
        date: dateKey,
        entriesSc: new Decimal(0),
        exitsSc: new Decimal(0),
        balanceSc: movement.balanceSc,
        movingAverageCost: movement.movingAverageCost,
      });
    }

    const dayBucket = mpTotalsByDay.get(dateKey);
    if (movement.qtySc.gt(0)) {
      dayBucket.entriesSc = dayBucket.entriesSc.add(movement.qtySc);
    } else if (movement.qtySc.lt(0)) {
      dayBucket.exitsSc = dayBucket.exitsSc.add(movement.qtySc.abs());
    }
    dayBucket.balanceSc = movement.balanceSc;
    dayBucket.movingAverageCost = movement.movingAverageCost;
  });

  const finishedTotalsByProduct = new Map();
  finishedSales.forEach((sale) => {
    if (!finishedTotalsByProduct.has(sale.productAlias)) {
      finishedTotalsByProduct.set(sale.productAlias, {
        productAlias: sale.productAlias,
        qtyUnits: new Decimal(0),
        mpConsumedSc: new Decimal(0),
        revenuePerSc: new Decimal(0),
        mpCostValue: new Decimal(0),
      });
    }
    const bucket = finishedTotalsByProduct.get(sale.productAlias);
    bucket.qtyUnits = bucket.qtyUnits.add(sale.qtyUnits);
    bucket.mpConsumedSc = bucket.mpConsumedSc.add(sale.mpConsumedSc);
    if (sale.valuePerSc) {
      bucket.revenuePerSc = bucket.revenuePerSc.add(sale.valuePerSc);
    }
    if (sale.mpCostValue != null) {
      bucket.mpCostValue = bucket.mpCostValue.add(sale.mpCostValue);
    }
  });

  const filterStartDate = fromDate ? ensureDate(fromDate) : null;
  if (filterStartDate) {
    filterStartDate.setUTCHours(0, 0, 0, 0);
  }

  let filteredMpMovements = mpMovements.slice();
  let filteredFinishedSales = finishedSales.slice();

  if (filterStartDate) {
    filteredMpMovements = mpMovements.filter((movement) => {
      if (!movement.timestamp) return true;
      return new Date(movement.timestamp) >= filterStartDate;
    });

    let previousMovement = null;
    for (let index = mpMovements.length - 1; index >= 0; index -= 1) {
      const candidate = mpMovements[index];
      if (!candidate.timestamp) {
        continue;
      }
      if (new Date(candidate.timestamp) < filterStartDate) {
        previousMovement = candidate;
        break;
      }
    }

    if (previousMovement) {
      const previousBalanceQty = toDecimal(previousMovement.balanceSc);
      const previousBalanceValue = toDecimal(previousMovement.balanceValue);
      const previousMovingAverageCost = toDecimal(previousMovement.movingAverageCost);

      const saldoAnterior = {
        type: 'SALDO_ANTERIOR',
        timestamp: filterStartDate.toISOString(),
        document: null,
        partner: null,
        partnerCnpj: null,
        cfop: null,
        qtySc: new Decimal(0),
        requestedQtySc: new Decimal(0),
        unitCostSc: previousMovingAverageCost,
        movingAverageCost: previousMovingAverageCost,
        balanceSc: previousBalanceQty,
        balanceValue: previousBalanceValue,
        notes: 'Saldo anterior ao período selecionado.',
        invoiceId: null,
        itemId: null,
        previousBalanceQty,
        previousBalanceValue,
        status: MOVEMENT_STATUS.NORMAL,
        costRestart: false,
      };

      filteredMpMovements.unshift(saldoAnterior);
    }

    filteredFinishedSales = finishedSales.filter((sale) => {
      if (!sale.timestamp) return true;
      return new Date(sale.timestamp) >= filterStartDate;
    });
  }

  const filteredMpTotals = filteredMpMovements.reduce((acc, movement) => {
    if (movement.type === 'SALDO_INICIAL' || movement.type === 'SALDO_ANTERIOR') {
      return acc;
    }
    const qty = movement.qtySc instanceof Decimal ? movement.qtySc : toDecimal(movement.qtySc);
    if (qty.gt(0)) {
      acc.entriesSc = acc.entriesSc.add(qty);
    } else if (qty.lt(0)) {
      acc.exitsSc = acc.exitsSc.add(qty.abs());
    }
    return acc;
  }, { entriesSc: new Decimal(0), exitsSc: new Decimal(0) });

  const filteredFinishedTotalsByProduct = new Map();
  filteredFinishedSales.forEach((sale) => {
    if (!filteredFinishedTotalsByProduct.has(sale.productAlias)) {
      filteredFinishedTotalsByProduct.set(sale.productAlias, {
        productAlias: sale.productAlias,
        qtyUnits: new Decimal(0),
        mpConsumedSc: new Decimal(0),
        revenuePerSc: new Decimal(0),
        mpCostValue: new Decimal(0),
      });
    }
    const bucket = filteredFinishedTotalsByProduct.get(sale.productAlias);
    bucket.qtyUnits = bucket.qtyUnits.add(sale.qtyUnits);
    bucket.mpConsumedSc = bucket.mpConsumedSc.add(sale.mpConsumedSc);
    if (sale.valuePerSc) {
      bucket.revenuePerSc = bucket.revenuePerSc.add(sale.valuePerSc);
    }
    if (sale.mpCostValue != null) {
      bucket.mpCostValue = bucket.mpCostValue.add(sale.mpCostValue);
    }
  });

  const filteredFinishedTotals = Array.from(filteredFinishedTotalsByProduct.values()).reduce((acc, bucket) => ({
    qtyUnits: acc.qtyUnits.add(bucket.qtyUnits),
    mpConsumedSc: acc.mpConsumedSc.add(bucket.mpConsumedSc),
    revenuePerSc: acc.revenuePerSc.add(bucket.revenuePerSc),
    mpCostValue: acc.mpCostValue.add(bucket.mpCostValue),
  }), {
    qtyUnits: new Decimal(0),
    mpConsumedSc: new Decimal(0),
    revenuePerSc: new Decimal(0),
    mpCostValue: new Decimal(0),
  });

  let filteredMpDailyTotals = Array.from(mpTotalsByDay.values());
  if (filterStartDate) {
    filteredMpDailyTotals = filteredMpDailyTotals.filter((day) => {
      const dayDate = ensureDate(day.date);
      dayDate.setUTCHours(0, 0, 0, 0);
      return dayDate >= filterStartDate;
    });
  }

  return {
    filters: {
      from: filterStartDate ? filterStartDate.toISOString() : null,
      to: untilDate.toISOString(),
      companies: companies.map((company) => ({
        id: company.id,
        name: company.name,
        cnpj: company.cnpj,
      })),
    },
    mpMovements: filteredMpMovements.map((movement) => ({
      type: movement.type,
      timestamp: movement.timestamp,
      document: movement.document,
      partner: movement.partner ?? null,
      partnerCnpj: movement.partnerCnpj ?? null,
      cfop: movement.cfop ?? null,
      qtySc: prepareJsonDecimal(movement.qtySc, { fractionDigits: 4 }),
      requestedQtySc: prepareJsonDecimal(movement.requestedQtySc ?? movement.qtySc, { fractionDigits: 4 }),
      unitCostSc: prepareJsonDecimal(movement.unitCostSc, { fractionDigits: 2 }),
      movingAverageCost: prepareJsonDecimal(movement.movingAverageCost, { fractionDigits: 2 }),
      balanceSc: prepareJsonDecimal(movement.balanceSc, { fractionDigits: 4 }),
      balanceValue: prepareJsonDecimal(movement.balanceValue, { fractionDigits: 2 }),
      notes: movement.notes,
      invoiceId: movement.invoiceId,
      itemId: movement.itemId,
      status: movement.status ?? MOVEMENT_STATUS.NORMAL,
      statusLabel: describeMovementStatus(movement.status ?? MOVEMENT_STATUS.NORMAL),
      costRestart: Boolean(movement.costRestart),
      costRestartLabel: movement.costRestart ? 'Sim' : 'Não',
    })),
    finishedSales: filteredFinishedSales.map((sale) => ({
      timestamp: sale.timestamp,
      document: sale.document,
      partner: sale.partnerName ?? sale.partnerCnpj ?? null,
      partnerCnpj: sale.partnerCnpj ?? null,
      productAlias: sale.productAlias,
      qtyUnits: prepareJsonDecimal(sale.qtyUnits, { fractionDigits: 4 }),
      unitPrice: prepareJsonDecimal(sale.unitNetPrice, { fractionDigits: 2 }),
      mpConsumedSc: prepareJsonDecimal(sale.mpConsumedSc, { fractionDigits: 4 }),
      costAverageSc: sale.costAverageSc != null ? prepareJsonDecimal(sale.costAverageSc, { fractionDigits: 2 }) : null,
      mpCostValue: sale.mpCostValue != null ? prepareJsonDecimal(sale.mpCostValue, { fractionDigits: 2 }) : null,
      valuePerSc: prepareJsonDecimal(sale.valuePerSc, { fractionDigits: 2 }),
      cfop: sale.cfop ?? null,
      natOp: sale.natOp ?? null,
      invoiceId: sale.invoiceId,
      itemId: sale.itemId,
    })),
    mpDailyTotals: filteredMpDailyTotals.map((day) => ({
      date: day.date,
      entriesSc: prepareJsonDecimal(day.entriesSc, { fractionDigits: 4 }),
      exitsSc: prepareJsonDecimal(day.exitsSc, { fractionDigits: 4 }),
      balanceSc: prepareJsonDecimal(day.balanceSc, { fractionDigits: 4 }),
      movingAverageCost: prepareJsonDecimal(day.movingAverageCost, { fractionDigits: 2 }),
    })),
    mpTotals: {
      entriesSc: prepareJsonDecimal(filteredMpTotals.entriesSc, { fractionDigits: 4 }),
      exitsSc: prepareJsonDecimal(filteredMpTotals.exitsSc, { fractionDigits: 4 }),
      balanceSc: prepareJsonDecimal(currentBalanceQty, { fractionDigits: 4 }),
      balanceValue: prepareJsonDecimal(currentBalanceValue, { fractionDigits: 2 }),
      movingAverageCost: prepareJsonDecimal(movingAverageCost, { fractionDigits: 2 }),
    },
    finishedTotalsByProduct: Array.from(filteredFinishedTotalsByProduct.values()).map((bucket) => ({
      productAlias: bucket.productAlias,
      qtyUnits: prepareJsonDecimal(bucket.qtyUnits, { fractionDigits: 4 }),
      mpConsumedSc: prepareJsonDecimal(bucket.mpConsumedSc, { fractionDigits: 4 }),
      revenuePerSc: prepareJsonDecimal(bucket.revenuePerSc, { fractionDigits: 2 }),
      mpCostValue: prepareJsonDecimal(bucket.mpCostValue, { fractionDigits: 2 }),
    })),
    finishedTotals: {
      qtyUnits: prepareJsonDecimal(filteredFinishedTotals.qtyUnits, { fractionDigits: 4 }),
      mpConsumedSc: prepareJsonDecimal(filteredFinishedTotals.mpConsumedSc, { fractionDigits: 4 }),
      revenuePerSc: prepareJsonDecimal(filteredFinishedTotals.revenuePerSc, { fractionDigits: 2 }),
      mpCostValue: prepareJsonDecimal(filteredFinishedTotals.mpCostValue, { fractionDigits: 2 }),
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

function buildMpCsvRows(movements) {
  const header = [
    'Data/Hora',
    'Documento',
    'Parceiro',
    'CFOP',
    'Tipo',
    'Status',
    'Qtd (SC)',
    'Custo Unitário (R$/SC)',
    'Custo Médio Após Movimento (R$/SC)',
    'Saldo (SC)',
    'Reinício de custo',
    'Observações',
  ];

  const rows = movements.map((movement) => {
    if (movement.type === 'SALDO_INICIAL') {
      return [
        movement.timestamp ?? '',
        '',
        '',
        '',
        'Saldo Inicial',
        describeMovementStatus(MOVEMENT_STATUS.NORMAL),
        movement.balanceSc ?? '',
        movement.movingAverageCost ?? '',
        movement.movingAverageCost ?? '',
        movement.balanceSc ?? '',
        'Não',
        movement.notes ?? '',
      ];
    }
    return [
      movement.timestamp ?? '',
      movement.document ?? '',
      movement.partner ?? '',
      movement.cfop ?? '',
      movement.type ?? '',
      movement.statusLabel ?? describeMovementStatus(movement.status ?? MOVEMENT_STATUS.NORMAL),
      movement.qtySc ?? '',
      movement.unitCostSc ?? '',
      movement.movingAverageCost ?? '',
      movement.balanceSc ?? '',
      movement.costRestartLabel ?? (movement.costRestart ? 'Sim' : 'Não'),
      movement.notes ?? '',
    ];
  });

  return [header, ...rows];
}

function buildFinishedCsvRows(finishedSales) {
  const header = [
    'Data/Hora',
    'Documento',
    'Parceiro',
    'Produto',
    'Qtd (unid)',
    'Preço Unitário Venda (R$)',
    'MP Consumida (SC)',
    'Custo Médio SC na Data/Hora (R$)',
    'Valor da Saca Bruta (R$)',
  ];

  const rows = finishedSales.map((sale) => [
    sale.timestamp ?? '',
    sale.document ?? '',
    sale.partner ?? '',
    sale.productAlias ?? '',
    sale.qtyUnits ?? '',
    sale.unitPrice ?? '',
    sale.mpConsumedSc ?? '',
    sale.costAverageSc ?? '',
    sale.valuePerSc ?? '',
  ]);

  return [header, ...rows];
}

function convertRowsToCsv(rows) {
  return rows
    .map((row) => row.map(escapeCsvValue).join(';'))
    .join('\n');
}

function generateKardexConsolidatedCsv(report) {
  const mpRows = buildMpCsvRows(report.mpMovements);
  const finishedRows = buildFinishedCsvRows(report.finishedSales);

  const sections = [
    ['Relatório Kardex Consolidado JM + OLG'],
    ['Bloco 1 — Kardex da Matéria-Prima (MP_CONILON)'],
    ...mpRows,
    [''],
    ['Bloco 2 — Vendas de Produtos Acabados'],
    ...finishedRows,
  ];

  return convertRowsToCsv(sections);
}

module.exports = {
  buildConsolidatedKardexReport,
  generateKardexConsolidatedCsv,
};
