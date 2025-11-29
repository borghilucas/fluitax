export function formatDate(value: string): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(date)
    .replace(/\u00A0/g, ' ');
}

export function formatCurrency(value: string | number | null | undefined): string {
  if (value == null) return '--';
  const numeric = typeof value === 'number' ? value : Number(value);

  if (Number.isNaN(numeric)) {
    return String(value);
  }

  const formatted = numeric
    .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\u00A0/g, ' ');

  return `R$\u00A0${formatted}`;
}

export function formatNumber(
  value: string | number | null | undefined,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }
): string {
  if (value == null) return '--';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }
  return numeric.toLocaleString('pt-BR', options).replace(/\u00A0/g, ' ');
}

export function formatPercent(value: string | number | null | undefined, fractionDigits = 2): string {
  if (value == null) return '--';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }
  return `${(numeric * 100).toFixed(fractionDigits)}%`;
}

export function formatDateTime(value: string): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
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

export function formatCnpj(value: string | null | undefined): string {
  if (!value) return '--';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) {
    return value;
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
