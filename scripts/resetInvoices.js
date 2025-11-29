#!/usr/bin/env node
require('dotenv').config();
const readline = require('readline');
const { prisma } = require('../src/prisma');

function askConfirmation() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Tem certeza que deseja apagar TODAS as notas, itens e mapeamentos? Digite "SIM" para confirmar: ', (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === 'SIM');
    });
  });
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force) {
    const confirmed = await askConfirmation();
    if (!confirmed) {
      console.log('Operação cancelada. Nenhum dado foi removido.');
      await prisma.$disconnect();
      return;
    }
  }

  const [mappingCount, itemsCount, invoiceCount] = await prisma.$transaction([
    prisma.invoiceItemProductMapping.count(),
    prisma.invoiceItem.count(),
    prisma.invoice.count(),
  ]);

  await prisma.$transaction([
    prisma.invoiceItemProductMapping.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.invoice.deleteMany(),
  ]);

  console.log('Limpeza concluída. Registros removidos:');
  console.log(`- Mapeamentos: ${mappingCount}`);
  console.log(`- InvoiceItem: ${itemsCount}`);
  console.log(`- Invoice: ${invoiceCount}`);
  console.log('Produtos, CFOPs e regras foram preservados.');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Falha ao limpar dados:', error);
  await prisma.$disconnect();
  process.exit(1);
});
