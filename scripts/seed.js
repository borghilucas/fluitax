require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { prisma } = require('../src/prisma');

const LEGACY_TEST_CNPJS = [
  '11.111.111/0001-11',
  '22.222.222/0001-22',
  '33.333.333/0001-33',
  '44.444.444/0001-44',
];

function loadCompanies() {
  const envValue = process.env.SEED_COMPANIES;
  if (envValue) {
    try {
      const parsed = JSON.parse(envValue);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      console.warn('[seed] Ignorando SEED_COMPANIES: valor precisa ser um array JSON.');
    } catch (error) {
      console.warn('[seed] Falha ao interpretar SEED_COMPANIES:', error);
    }
  }

  const filePath = process.env.SEED_COMPANIES_FILE
    ? path.resolve(process.cwd(), process.env.SEED_COMPANIES_FILE)
    : path.resolve(__dirname, 'seed-data', 'companies.json');

  if (fs.existsSync(filePath)) {
    try {
      const fileContents = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(fileContents);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      console.warn(`[seed] O arquivo ${filePath} precisa exportar um array JSON.`);
    } catch (error) {
      console.warn(`[seed] Não foi possível ler ${filePath}:`, error);
    }
  }

  return [];
}

const companies = loadCompanies();

(async function seed() {
  try {
    if (companies.length === 0) {
      console.log('[seed] Nenhuma empresa configurada. Pulando criação de registros.');
      const removed = await prisma.company.deleteMany({ where: { cnpj: { in: LEGACY_TEST_CNPJS } } });
      if (removed.count) {
        console.log(`[seed] Removidos ${removed.count} registros de empresas de teste legados.`);
      }
      return;
    }

    const removed = await prisma.company.deleteMany({ where: { cnpj: { in: LEGACY_TEST_CNPJS } } });
    if (removed.count) {
      console.log(`[seed] Removidos ${removed.count} registros de empresas de teste legados.`);
    }

    const results = [];

    for (const company of companies) {
      if (!company?.cnpj || !company?.name) {
        console.warn('[seed] Registro de empresa ignorado por faltar name ou cnpj.', company);
        continue;
      }
      const upserted = await prisma.company.upsert({
        where: { cnpj: company.cnpj },
        update: { name: company.name },
        create: company,
      });
      results.push(upserted);
    }

    console.log('Company seeded:');
    results.forEach((company) => {
      console.log(`- ${company.id} ${company.cnpj}`);
    });
  } catch (error) {
    console.error('Seed failed', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
