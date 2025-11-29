const TITLE_CASE_EXCEPTIONS = new Set(['DA', 'DE', 'DO', 'DOS', 'DAS', 'E']);

function sanitizeNatOp(value) {
  if (value == null) return null;
  const trimmed = String(value).replace(/\s+/g, ' ').trim();
  return trimmed.length ? trimmed : null;
}

function toTitleCaseTerm(term) {
  if (!term) return term;
  const upper = term.toLocaleUpperCase('pt-BR');
  if (TITLE_CASE_EXCEPTIONS.has(upper)) {
    return upper.toLocaleLowerCase('pt-BR');
  }
  const [first, ...rest] = upper;
  return `${first ?? ''}${rest.join('').toLocaleLowerCase('pt-BR')}`;
}

function normalizeNatOp(value) {
  const sanitized = sanitizeNatOp(value);
  if (!sanitized) return null;

  return sanitized
    .split(' ')
    .map((word, index) => {
      const normalized = toTitleCaseTerm(word);
      if (!normalized) return '';
      if (index === 0) {
        return normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1);
      }
      if (TITLE_CASE_EXCEPTIONS.has(normalized.toLocaleUpperCase('pt-BR'))) {
        return normalized.toLocaleLowerCase('pt-BR');
      }
      return normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1);
    })
    .filter(Boolean)
    .join(' ');
}

function buildCfopCompositeFromNatOp(cfopCode, natOpDescricao) {
  const code = sanitizeNatOp(cfopCode);
  if (!code) return null;
  const descricao = sanitizeNatOp(natOpDescricao);
  if (!descricao) {
    return code;
  }
  return `${code} - ${descricao}`;
}

function determinePrimaryCfop(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const stats = new Map();

  items.forEach((item) => {
    const code = sanitizeNatOp(item?.cfopCode ?? null);
    if (!code) return;
    const gross = Number.parseFloat(item?.gross ?? '0');
    if (!stats.has(code)) {
      stats.set(code, { count: 0, gross: 0 });
    }
    const entry = stats.get(code);
    entry.count += 1;
    entry.gross += Number.isFinite(gross) ? gross : 0;
  });

  if (!stats.size) {
    return null;
  }

  return Array.from(stats.entries())
    .sort((a, b) => {
      const [, statsA] = a;
      const [, statsB] = b;
      if (statsB.count !== statsA.count) {
        return statsB.count - statsA.count;
      }
      if (statsB.gross !== statsA.gross) {
        return statsB.gross - statsA.gross;
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([code]) => code)[0];
}

module.exports = {
  sanitizeNatOp,
  normalizeNatOp,
  buildCfopCompositeFromNatOp,
  determinePrimaryCfop,
};
