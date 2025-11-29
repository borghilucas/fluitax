const { Prisma } = require('@prisma/client');
const { prisma } = require('../prisma');
const { UNCONDITIONAL_DISCOUNT_PROFILES } = require('../constants/unconditionalDiscounts');

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

function decimalToString(value, fractionDigits = 2) {
  return toDecimal(value).toFixed(fractionDigits);
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

function normalizeTokens(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function normalizeCnpj(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

function formatCnpj(value) {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) {
    return digits;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function formatDateIso(dateString) {
  if (!dateString) return '';
  return dateString.slice(0, 10);
}

function formatDateTimePtBr(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(/\u00A0/g, ' ');
}

function companyMatchesProfile(company, profile) {
  const profileCnpj = profile.cnpjDigits ? normalizeCnpj(profile.cnpjDigits) : null;
  if (profileCnpj) {
    const companyDigits = normalizeCnpj(company.cnpj);
    if (companyDigits && companyDigits === profileCnpj) {
      return true;
    }
  }
  const companyTokens = normalizeTokens(company.name);
  return profile.nameTokens.every((token) => companyTokens.includes(normalizeText(token)));
}

function resolveProfile(company) {
  return UNCONDITIONAL_DISCOUNT_PROFILES.find((profile) => companyMatchesProfile(company, profile)) ?? null;
}

function buildCustomerRateMap(profile) {
  const entries = Object.entries(profile.customerRates ?? {});
  const map = new Map();
  entries.forEach(([cnpj, rate]) => {
    const digits = normalizeCnpj(cnpj);
    if (digits.length !== 14) {
      return;
    }
    const decimalRate = toDecimal(rate);
    if (decimalRate.lt(0)) {
      return;
    }
    map.set(digits, decimalRate);
  });
  return map;
}

function resolvePartnerName(recipientDigits, profile, partnerMap) {
  if (partnerMap.has(recipientDigits)) {
    return partnerMap.get(recipientDigits);
  }
  if (profile.customerLabels && profile.customerLabels[recipientDigits]) {
    return profile.customerLabels[recipientDigits];
  }
  const formatted = formatCnpj(recipientDigits);
  return formatted ? `Cliente ${formatted}` : recipientDigits || null;
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const stringValue = String(value);
  if (stringValue.includes('"') || stringValue.includes(';') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatCurrencyPtBr(value) {
  const decimal = toDecimal(value);
  const asNumber = Number(decimal.toFixed(2));
  if (!Number.isFinite(asNumber)) {
    return decimal.toFixed(2);
  }
  return asNumber
    .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\u00A0/g, ' ');
}

function formatPercentPtBr(value) {
  const decimal = toDecimal(value);
  const asNumber = Number(decimal.toString());
  if (!Number.isFinite(asNumber)) {
    return decimal.toString();
  }
  return `${(asNumber * 100).toFixed(2)}%`;
}

async function buildUnconditionalDiscountReport({ companyId, from = null, to = null }) {
  if (!companyId || typeof companyId !== 'string') {
    const error = new Error('companyId é obrigatório.');
    error.status = 400;
    throw error;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, cnpj: true },
  });

  if (!company) {
    const error = new Error('Empresa não encontrada.');
    error.status = 404;
    throw error;
  }

  const profile = resolveProfile(company);
  if (!profile) {
    const error = new Error('Não há configuração de descontos incondicionais para esta empresa.');
    error.status = 404;
    throw error;
  }

  const customerRateMap = buildCustomerRateMap(profile);
  const targetCustomerIds = Array.from(customerRateMap.keys());

  const companyCnpjDigits = normalizeCnpj(company.cnpj);

  const where = {
    companyId,
    type: 'OUT',
    recipientCnpj: { in: targetCustomerIds },
  };

  if (companyCnpjDigits.length === 14) {
    where.issuerCnpj = companyCnpjDigits;
  }

  if (from || to) {
    where.emissao = {};
    if (from) {
      where.emissao.gte = from;
    }
    if (to) {
      where.emissao.lte = to;
    }
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [
      { emissao: 'asc' },
      { numero: 'asc' },
      { id: 'asc' },
    ],
    select: {
      id: true,
      emissao: true,
      numero: true,
      chave: true,
      totalNFe: true,
      recipientCnpj: true,
    },
  });

  const recipientIds = Array.from(
    new Set(
      invoices
        .map((invoice) => normalizeCnpj(invoice.recipientCnpj))
        .filter((digits) => digits.length === 14),
    ),
  );

  const partners = recipientIds.length
    ? await prisma.partner.findMany({
        where: {
          companyId,
          cnpjCpf: { in: recipientIds },
        },
        select: {
          cnpjCpf: true,
          name: true,
        },
      })
    : [];

  const partnerMap = new Map();
  partners.forEach((partner) => {
    const digits = normalizeCnpj(partner.cnpjCpf);
    if (digits.length === 14 && partner.name) {
      partnerMap.set(digits, partner.name);
    }
  });

  const rows = [];
  let totalInvoiceValue = new Decimal(0);
  let totalDiscountValue = new Decimal(0);

  invoices.forEach((invoice) => {
    const recipientDigits = normalizeCnpj(invoice.recipientCnpj);
    if (!customerRateMap.has(recipientDigits)) {
      return;
    }
    const rate = customerRateMap.get(recipientDigits);
    const totalValue = toDecimal(invoice.totalNFe ?? 0);
    const discountValue = totalValue.mul(rate);

    totalInvoiceValue = totalInvoiceValue.add(totalValue);
    totalDiscountValue = totalDiscountValue.add(discountValue);

    rows.push({
      invoiceId: invoice.id,
      invoiceKey: invoice.chave ?? null,
      issueDate: invoice.emissao ? invoice.emissao.toISOString() : null,
      invoiceNumber: invoice.numero ?? null,
      customerCnpj: recipientDigits,
      customerName: resolvePartnerName(recipientDigits, profile, partnerMap),
      totalValue: decimalToString(totalValue),
      discountPercent: rate.toString(),
      discountValue: decimalToString(discountValue),
    });
  });

  const uniqueCustomers = new Set(rows.map((row) => row.customerCnpj));

  return {
    generatedAt: new Date().toISOString(),
    company: {
      id: company.id,
      name: company.name,
      cnpj: company.cnpj ?? null,
      cnpjDigits: companyCnpjDigits || null,
    },
    profile: {
      alias: profile.alias,
      displayName: profile.displayName,
    },
    filters: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    },
    totals: {
      invoiceCount: rows.length,
      customerCount: uniqueCustomers.size,
      invoiceValue: decimalToString(totalInvoiceValue),
      discountValue: decimalToString(totalDiscountValue),
    },
    rows,
  };
}

function generateUnconditionalDiscountCsv(report) {
  const lines = [];
  const companyLabel = report.company.cnpj
    ? `${report.company.name} (${formatCnpj(report.company.cnpj)})`
    : report.company.name;

  lines.push(['Relatório', 'Descontos incondicionais concedidos']);
  lines.push(['Empresa', companyLabel]);
  if (report.profile?.displayName) {
    lines.push(['Perfil', report.profile.displayName]);
  }

  const fromLabel = report.filters?.from ? formatDateIso(report.filters.from) : 'Início';
  const toLabel = report.filters?.to ? formatDateIso(report.filters.to) : 'Hoje';
  lines.push(['Período', `${fromLabel} a ${toLabel}`]);
  lines.push(['Gerado em', formatDateTimePtBr(report.generatedAt)]);
  lines.push([]);

  lines.push([
    'Data de emissão',
    'Razão social do cliente',
    'CNPJ do cliente',
    'Número da nota fiscal',
    'Valor total da nota (R$)',
    'Percentual de desconto',
    'Valor do desconto (R$)',
  ]);

  report.rows.forEach((row) => {
    lines.push([
      row.issueDate ? formatDateIso(row.issueDate) : '',
      row.customerName ?? '',
      formatCnpj(row.customerCnpj),
      row.invoiceNumber ?? '',
      formatCurrencyPtBr(row.totalValue),
      formatPercentPtBr(row.discountPercent),
      formatCurrencyPtBr(row.discountValue),
    ]);
  });

  lines.push([]);
  lines.push(['Total de notas', report.totals?.invoiceCount ?? 0]);
  lines.push(['Total de clientes', report.totals?.customerCount ?? 0]);
  lines.push(['Total faturado (R$)', formatCurrencyPtBr(report.totals?.invoiceValue ?? '0')]);
  lines.push(['Total descontos (R$)', formatCurrencyPtBr(report.totals?.discountValue ?? '0')]);

  return lines
    .map((row) => row.map(escapeCsvValue).join(';'))
    .join('\n');
}

module.exports = {
  buildUnconditionalDiscountReport,
  generateUnconditionalDiscountCsv,
};
