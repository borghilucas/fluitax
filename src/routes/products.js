const express = require('express');
const { prisma } = require('../prisma');
const router = express.Router();

const compositionSelect = {
  id: true,
  companyId: true,
  rawProductId: true,
  finishedProductId: true,
  ratio: true,
  createdAt: true,
  updatedAt: true,
  rawProduct: {
    select: {
      id: true,
      name: true,
      unit: true,
      sku: true,
    },
  },
  finishedProduct: {
    select: {
      id: true,
      name: true,
      unit: true,
      sku: true,
    },
  },
};

function parsePositiveNumber(value, fieldName) {
  const numeric = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error(`${fieldName} deve ser um número positivo.`);
    error.status = 400;
    throw error;
  }
  return numeric;
}

async function ensureProductBelongsToCompany(companyId, productId, label) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, companyId: true },
  });
  if (!product || product.companyId !== companyId) {
    const error = new Error(`${label} não encontrado para esta empresa.`);
    error.status = 404;
    throw error;
  }
  return product;
}

router.get('/', async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const where = companyId
      ? {
          companyId: Array.isArray(companyId)
            ? { in: companyId }
            : { equals: companyId },
        }
      : {};

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ companyId: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        companyId: true,
        name: true,
        sku: true,
        unit: true,
        ncm: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ items: products });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/compositions', async (req, res, next) => {
  try {
    const { id } = req.params;

    const compositions = await prisma.productComposition.findMany({
      where: { companyId: id },
      orderBy: [{ rawProduct: { name: 'asc' } }, { finishedProduct: { name: 'asc' } }],
      select: compositionSelect,
    });

    res.status(200).json({ items: compositions });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/compositions', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rawProductId, finishedProductId, ratio } = req.body ?? {};

    if (!rawProductId || !finishedProductId) {
      return res.status(400).json({ error: 'rawProductId e finishedProductId são obrigatórios.' });
    }

    if (rawProductId === finishedProductId) {
      return res.status(400).json({ error: 'Matéria-prima e produto acabado devem ser diferentes.' });
    }

    const numericRatio = parsePositiveNumber(ratio, 'Relação');

    await ensureProductBelongsToCompany(id, rawProductId, 'Matéria-prima');
    await ensureProductBelongsToCompany(id, finishedProductId, 'Produto acabado');

    try {
      const composition = await prisma.productComposition.create({
        data: {
          companyId: id,
          rawProductId,
          finishedProductId,
          ratio: numericRatio,
        },
        select: compositionSelect,
      });

      res.status(201).json({ item: composition });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Composição já existe para esta empresa.' });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/compositions/:compositionId', async (req, res, next) => {
  try {
    const { id, compositionId } = req.params;
    const { rawProductId, finishedProductId, ratio } = req.body ?? {};

    const existing = await prisma.productComposition.findUnique({
      where: { id: compositionId },
      select: { companyId: true },
    });

    if (!existing || existing.companyId !== id) {
      return res.status(404).json({ error: 'Composição não encontrada.' });
    }

    const data = {};

    if (rawProductId) {
      await ensureProductBelongsToCompany(id, rawProductId, 'Matéria-prima');
      data.rawProductId = rawProductId;
    }

    if (finishedProductId) {
      await ensureProductBelongsToCompany(id, finishedProductId, 'Produto acabado');
      data.finishedProductId = finishedProductId;
    }

    if (data.rawProductId && data.finishedProductId && data.rawProductId === data.finishedProductId) {
      return res.status(400).json({ error: 'Matéria-prima e produto acabado devem ser diferentes.' });
    }

    if (ratio != null) {
      data.ratio = parsePositiveNumber(ratio, 'Relação');
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nenhuma alteração informada.' });
    }

    try {
      const composition = await prisma.productComposition.update({
        where: { id: compositionId },
        data,
        select: compositionSelect,
      });

      res.status(200).json({ item: composition });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Já existe uma composição com esses produtos.' });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/compositions/:compositionId', async (req, res, next) => {
  try {
    const { id, compositionId } = req.params;

    const existing = await prisma.productComposition.findUnique({
      where: { id: compositionId },
      select: { companyId: true },
    });

    if (!existing || existing.companyId !== id) {
      return res.status(404).json({ error: 'Composição não encontrada.' });
    }

    await prisma.productComposition.delete({ where: { id: compositionId } });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
