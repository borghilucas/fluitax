const express = require('express');
const multer = require('multer');
const path = require('path');
const { prisma } = require('../prisma');
const { processInvoicesFromZip } = require('../services/invoiceUploadService');

const multiCompanyAccessKeyFlag =
  String(process.env.MULTI_COMPANY_ACCESS_KEY ?? 'false').toLowerCase() === 'true';
const uploadDecisionLogsFlag =
  String(process.env.UPLOAD_DECISION_LOGS ?? 'false').toLowerCase() === 'true';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const router = express.Router();

const MAX_XML_FILES = parseInt(process.env.MAX_XML_FILES || '10000', 10);
const MAX_XML_FILE_SIZE_MB = parseInt(process.env.MAX_XML_FILE_SIZE_MB || '5', 10);
const MAX_XML_FILE_SIZE = MAX_XML_FILE_SIZE_MB * 1024 * 1024;
const MAX_ZIP_SIZE = MAX_XML_FILES * MAX_XML_FILE_SIZE;

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_ZIP_SIZE,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.zip') {
      const error = new Error('Apenas arquivos .zip são aceitos');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

const uploadSingleZip = upload.single('file');

function createBadRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseLimitParam(raw) {
  if (raw == null) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw createBadRequest('Parâmetro limit inválido');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseDateParam(raw, label) {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw createBadRequest(`Parâmetro ${label} inválido`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw createBadRequest(`Parâmetro ${label} inválido`);
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
  return Buffer.from(JSON.stringify({ id }), 'utf-8').toString('base64');
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(String(raw), 'base64').toString('utf-8');
    const payload = JSON.parse(decoded);
    if (!payload?.id || typeof payload.id !== 'string') {
      throw new Error('Formato inválido');
    }
    return payload.id;
  } catch (error) {
    throw createBadRequest('Cursor inválido');
  }
}

function formatDecimal(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

router.post('/upload-xml', (req, res, next) => {
  uploadSingleZip(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Arquivo zip excede o tamanho máximo permitido' });
      }
      return next(err);
    }

    const companyId = req.query.companyId;
    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'Parâmetro companyId é obrigatório' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo .zip é obrigatório (campo "file")' });
    }

    prisma.company.findUnique({ where: { id: companyId } })
      .then(async (company) => {
        if (!company) {
          return res.status(404).json({ error: 'Empresa não encontrada' });
        }

        const summary = await processInvoicesFromZip({
          companyId,
          companyCnpj: company.cnpj,
          zipBuffer: req.file.buffer,
          limits: {
            maxFiles: MAX_XML_FILES,
            maxFileSize: MAX_XML_FILE_SIZE,
          },
          fileName: req.file.originalname ?? null,
          actorId: req.user?.id ?? null,
          flags: {
            multiCompanyAccessKey: multiCompanyAccessKeyFlag,
            enableDecisionLogs: uploadDecisionLogsFlag,
            updateExisting: true, // sempre atualizar duplicatas com dados do XML
          },
        });

        console.info('[upload-xml] resumo', {
          companyId,
          inserted: summary.inserted,
          updated: summary.updated,
          duplicate: summary.duplicate,
          failed: summary.failed,
          cancelled: summary.cancelled,
        });

        summary.details.forEach((detail) => {
          const payload = { companyId, file: detail.file, status: detail.status };
          if (detail.reason) {
            payload.reason = detail.reason;
          }
          console.info('[upload-xml] arquivo', payload);
        });

        return res.status(200).json(summary);
      })
      .catch((error) => next(error));
  });
});

router.get('/', async (req, res, next) => {
  try {
    const {
      companyId,
      from,
      to,
      type,
      limit: limitParam,
      cursor: cursorParam,
    } = req.query;

    if (!companyId || typeof companyId !== 'string') {
      throw createBadRequest('Parâmetro companyId é obrigatório');
    }

    let invoiceType;
    if (type != null) {
      const normalized = String(type).toUpperCase();
      if (!['IN', 'OUT'].includes(normalized)) {
        throw createBadRequest('Parâmetro type inválido');
      }
      invoiceType = normalized;
    }

    const pageSize = parseLimitParam(limitParam);
    const fromDate = parseDateParam(from, 'from');
    const toDate = parseEndDateParam(to);
    const cursorId = decodeCursor(cursorParam);

    const where = {
      companyId,
      ...(invoiceType ? { type: invoiceType } : {}),
    };

    if (req.query.search) {
      const searchTerm = String(req.query.search).trim();
      if (searchTerm.length) {
        const like = searchTerm;
        where.OR = [
          { chave: { contains: like, mode: 'insensitive' } },
          { numero: { contains: like, mode: 'insensitive' } },
          { issuerCnpj: { contains: like.replace(/\D/g, '') } },
          { recipientCnpj: { contains: like.replace(/\D/g, '') } },
        ];
      }
    }

    if (fromDate || toDate) {
      where.emissao = {};
      if (fromDate) {
        where.emissao.gte = fromDate;
      }
      if (toDate) {
        where.emissao.lte = toDate;
      }
    }

    const queryArgs = {
      where,
      orderBy: { emissao: 'desc' },
      take: pageSize + 1,
      select: {
        id: true,
        chave: true,
        numero: true,
        type: true,
        emissao: true,
        issuerCnpj: true,
        recipientCnpj: true,
        totalNFe: true,
      },
    };

    if (cursorId) {
      queryArgs.cursor = { id: cursorId };
      queryArgs.skip = 1;
    }

    const invoices = await prisma.invoice.findMany(queryArgs);

    let nextCursor = null;
    if (invoices.length > pageSize) {
      const nextItem = invoices.pop();
      nextCursor = encodeCursor(nextItem.id);
    }

    const items = invoices.map((invoice) => ({
      id: invoice.id,
      chave: invoice.chave,
      numero: invoice.numero,
      type: invoice.type,
      emissao: invoice.emissao.toISOString(),
      issuerCnpj: invoice.issuerCnpj,
      recipientCnpj: invoice.recipientCnpj,
      totalNFe: formatDecimal(invoice.totalNFe),
    }));

    res.status(200).json({ items, nextCursor });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get('/cancellations', async (req, res, next) => {
  try {
    const {
      companyId,
      from,
      to,
      limit: limitParam,
      cursor: cursorParam,
    } = req.query;

    if (!companyId || typeof companyId !== 'string') {
      throw createBadRequest('Parâmetro companyId é obrigatório');
    }

    const pageSize = parseLimitParam(limitParam);
    const fromDate = parseDateParam(from, 'from');
    const toDate = parseEndDateParam(to);
    const cursorId = decodeCursor(cursorParam);

    const where = { companyId };
    const dateFilters = [];
    if (fromDate) {
      dateFilters.push({
        OR: [
          { eventTimestamp: { gte: fromDate } },
          { eventTimestamp: null, createdAt: { gte: fromDate } },
        ],
      });
    }
    if (toDate) {
      dateFilters.push({
        OR: [
          { eventTimestamp: { lte: toDate } },
          { eventTimestamp: null, createdAt: { lte: toDate } },
        ],
      });
    }
    if (dateFilters.length) {
      where.AND = dateFilters;
    }

    const queryArgs = {
      where,
      orderBy: [
        { eventTimestamp: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: pageSize + 1,
      select: {
        id: true,
        chave: true,
        eventType: true,
        eventSequence: true,
        statusCode: true,
        statusMessage: true,
        protocolNumber: true,
        eventTimestamp: true,
        receivedAt: true,
        justification: true,
        sourceFileName: true,
        uploadBatchId: true,
        createdAt: true,
        updatedAt: true,
      },
    };

    if (cursorId) {
      queryArgs.cursor = { id: cursorId };
      queryArgs.skip = 1;
    }

    const cancellations = await prisma.invoiceCancellation.findMany(queryArgs);

    let nextCursor = null;
    if (cancellations.length > pageSize) {
      const nextItem = cancellations.pop();
      nextCursor = encodeCursor(nextItem.id);
    }

    const items = cancellations.map((record) => ({
      id: record.id,
      chave: record.chave,
      eventType: record.eventType,
      eventSequence: record.eventSequence,
      statusCode: record.statusCode,
      statusMessage: record.statusMessage,
      protocolNumber: record.protocolNumber,
      eventTimestamp: record.eventTimestamp ? record.eventTimestamp.toISOString() : null,
      receivedAt: record.receivedAt ? record.receivedAt.toISOString() : null,
      justification: record.justification,
      sourceFileName: record.sourceFileName,
      uploadBatchId: record.uploadBatchId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));

    res.status(200).json({ items, nextCursor });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get('/:id/items', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!id) {
      throw createBadRequest('Parâmetro id é obrigatório');
    }

    if (!companyId || typeof companyId !== 'string') {
      throw createBadRequest('Parâmetro companyId é obrigatório');
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            cfopCode: true,
            ncm: true,
            qty: true,
            unitPrice: true,
            gross: true,
            discount: true,
            icmsValue: true,
            ipiValue: true,
            pisValue: true,
            cofinsValue: true,
          },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Nota não encontrada' });
    }

    const items = invoice.items.map((item) => ({
      cfopCode: item.cfopCode,
      ncm: item.ncm,
      qty: formatDecimal(item.qty),
      unitPrice: formatDecimal(item.unitPrice),
      gross: formatDecimal(item.gross),
      discount: formatDecimal(item.discount),
      icmsValue: formatDecimal(item.icmsValue),
      ipiValue: formatDecimal(item.ipiValue),
      pisValue: formatDecimal(item.pisValue),
      cofinsValue: formatDecimal(item.cofinsValue),
    }));

    res.status(200).json({ invoiceId: invoice.id, items });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const companyId = String(req.query.companyId || '').trim();
    if (!companyId) {
      throw createBadRequest('Parâmetro companyId é obrigatório');
    }

    const existing = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Nota não encontrada para a empresa informada.' });
    }

    await prisma.invoice.delete({ where: { id } });

    res.status(200).json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
