const express = require('express');
const { prisma } = require('../prisma');

const router = express.Router();

function parseLimitParam(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 200) {
    return 50;
  }
  return parsed;
}

function parseDateParam(raw, label) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`Parâmetro ${label} inválido. Use o formato YYYY-MM-DD.`);
    error.status = 400;
    throw error;
  }
  return date;
}

function parseEndDateParam(raw) {
  const start = parseDateParam(raw, 'to');
  if (!start) return null;
  const end = new Date(start.getTime());
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function encodeCursor(id) {
  return Buffer.from(String(id)).toString('base64');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(String(cursor), 'base64').toString('utf-8');
    return decoded;
  } catch {
    return null;
  }
}

function formatDecimal(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value.toString();
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

router.get('/', async (req, res, next) => {
  try {
    const {
      companyId,
      search,
      from,
      to,
      limit: limitParam,
      cursor: cursorParam,
    } = req.query;

    if (!companyId || typeof companyId !== 'string') {
      const error = new Error('Parâmetro companyId é obrigatório');
      error.status = 400;
      throw error;
    }

    const pageSize = parseLimitParam(limitParam);
    const fromDate = parseDateParam(from, 'from');
    const toDate = parseEndDateParam(to);
    const cursorId = decodeCursor(cursorParam);

    const where = {
      companyId,
      isCancelled: false,
    };

    const andFilters = [];
    if (fromDate) {
      andFilters.push({ emissao: { gte: fromDate } });
    }
    if (toDate) {
      andFilters.push({ emissao: { lte: toDate } });
    }
    if (search && typeof search === 'string') {
      const term = search.trim();
      if (term) {
        andFilters.push({
          OR: [
            { chave: { contains: term } },
            { numero: { contains: term } },
            { destCnpj: { contains: term.replace(/\D/g, '') } },
            { destNome: { contains: term, mode: 'insensitive' } },
          ],
        });
      }
    }
    if (andFilters.length) {
      where.AND = andFilters;
    }

    const queryArgs = {
      where,
      orderBy: [{ emissao: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    };

    if (cursorId) {
      queryArgs.cursor = { id: cursorId };
      queryArgs.skip = 1;
    }

    const ctes = await prisma.cte.findMany(queryArgs);

    let nextCursor = null;
    if (ctes.length > pageSize) {
      const nextItem = ctes.pop();
      nextCursor = encodeCursor(nextItem.id);
    }

    const items = ctes.map((cte) => ({
      id: cte.id,
      chave: cte.chave,
      numero: cte.numero,
      serie: cte.serie,
      emissao: cte.emissao.toISOString(),
      cfop: cte.cfop,
      emitNome: cte.emitNome,
      emitCnpj: cte.emitCnpj,
      destNome: cte.destNome,
      destCnpj: cte.destCnpj,
      destUf: cte.destUf,
      destMun: cte.destMun,
      valorPrestacao: formatDecimal(cte.valorPrestacao),
      pesoBruto: formatDecimal(cte.pesoBruto),
    }));

    res.status(200).json({ items, nextCursor });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
