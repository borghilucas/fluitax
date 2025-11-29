const express = require('express');
const { prisma } = require('../prisma');

const router = express.Router();

router.post('/reset-data', async (req, res, next) => {
  try {
    const confirmation = req.body?.confirm;
    if (confirmation !== 'RESET') {
      return res.status(400).json({ error: 'Confirmação inválida. Envie { "confirm": "RESET" } no corpo da requisição.' });
    }

    const [mappingCount, itemCount, invoiceCount, ruleCount, cfopCount, productCount] = await prisma.$transaction([
      prisma.invoiceItemProductMapping.count(),
      prisma.invoiceItem.count(),
      prisma.invoice.count(),
      prisma.cfopRule.count(),
      prisma.cfop.count(),
      prisma.product.count(),
    ]);

    await prisma.$transaction([
      prisma.invoiceItemProductMapping.deleteMany(),
      prisma.cfopRule.deleteMany(),
      prisma.invoiceItem.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.cfop.deleteMany(),
      prisma.product.deleteMany(),
    ]);

    res.status(200).json({
      message: 'Dados de notas e CFOPs removidos com sucesso.',
      summary: {
        mappings: mappingCount,
        invoiceItems: itemCount,
        invoices: invoiceCount,
        products: productCount,
        cfopRules: ruleCount,
        cfops: cfopCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
