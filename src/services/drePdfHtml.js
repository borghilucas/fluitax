const puppeteer = require('puppeteer');

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCurrency(value) {
  if (value == null) return 'R$ --';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumber(value) {
  if (value == null) return '--';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
  return d.toLocaleDateString('pt-BR');
}

function buildSection(groups, isDeductions = false) {
  if (!groups || !groups.length) {
    return `<div class="empty">Sem dados para este período.</div>`;
  }
  return groups
    .map((group) => {
      const rows = (group.items || [])
        .map((item) => {
          if (isDeductions) {
            return `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(
              formatDate(item.startDate),
            )} — ${escapeHtml(formatDate(item.endDate))}</td><td class="num">${formatCurrency(
              item.amount,
            )}</td></tr>`;
          }
          return `<tr>
            <td>${escapeHtml(item.product)}${item.sku ? ` · ${escapeHtml(item.sku)}` : ''}</td>
            <td class="num">${formatNumber(item.qty)}</td>
            <td class="num">${formatCurrency(item.total)}</td>
            <td class="num">${formatCurrency(item.avgPrice)}</td>
          </tr>`;
        })
        .join('');

      const table = isDeductions
        ? `<table><thead><tr><th>Descrição</th><th>Período</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<table><thead><tr><th>Produto</th><th>Qtd</th><th>Total</th><th>Preço médio</th></tr></thead><tbody>${rows}</tbody></table>`;

      return `
        <div class="group">
          <div class="group-header">
            <span class="group-label">${escapeHtml(group.label)}</span>
            <span class="group-total">${formatCurrency(group.total)}</span>
          </div>
          ${rows ? table : '<div class="empty">Sem produtos nesta natureza.</div>'}
        </div>
      `;
    })
    .join('');
}

function buildHtml({ report, company }) {
  const revenueTotal = report?.revenue?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
  const returnsTotal = report?.returns?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
  const cmvTotal = report?.cmv?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
  const deductionsTotal = report?.deductions?.total ?? 0;
  const grossResult = revenueTotal - returnsTotal - cmvTotal;
  const netResult = revenueTotal - returnsTotal - deductionsTotal - cmvTotal;

  const summaryRows = [
    ['Receita', formatCurrency(revenueTotal)],
    ['Devoluções', formatCurrency(returnsTotal)],
    ['Deduções', formatCurrency(deductionsTotal)],
    ['CMV', formatCurrency(cmvTotal)],
    ['Resultado bruto', formatCurrency(grossResult)],
    ['Resultado líquido', formatCurrency(netResult)],
  ]
    .map((row) => `<tr><td>${row[0]}</td><td class="num">${row[1]}</td></tr>`)
    .join('');

  return `
  <!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: A4 portrait; margin: 18mm 14mm; }
        body { font-family: Arial, sans-serif; color: #111; }
        h1 { font-size: 18px; margin: 0 0 4px 0; }
        h2 { font-size: 14px; margin: 12px 0 6px 0; }
        h3 { font-size: 12px; margin: 8px 0 4px 0; }
        .meta { font-size: 10px; color: #555; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        th, td { font-size: 10px; padding: 4px 6px; border: 1px solid #ddd; }
        th { background: #f0f0f0; text-align: left; }
        .num { text-align: right; }
        .group { margin-bottom: 12px; page-break-inside: avoid; }
        .group-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin-top: 4px; }
        .summary { margin-top: 8px; page-break-inside: avoid; }
        .empty { font-size: 10px; color: #777; margin: 4px 0 6px 0; }
      </style>
    </head>
    <body>
      <h1>DRE - Demonstrativo de Resultado</h1>
      <div class="meta">
        ${company?.name ? `Empresa: ${escapeHtml(company.name)}` : ''}
        ${company?.cnpj ? ` · CNPJ: ${escapeHtml(company.cnpj)}` : ''}
        ${report.filters.from ? ` · Início: ${escapeHtml(formatDate(report.filters.from))}` : ''}
        ${report.filters.to ? ` · Fim: ${escapeHtml(formatDate(report.filters.to))}` : ''}
      </div>

      <h2>Resumo</h2>
      <table class="summary">
        <thead><tr><th>Conta</th><th class="num">Valor</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>

      <h2>Receitas</h2>
      ${buildSection(report.revenue || [])}

      <h2>Devoluções</h2>
      ${buildSection(report.returns || [])}

      <h2>CMV</h2>
      ${buildSection(report.cmv || [])}

      <h2>Deduções</h2>
      ${buildSection(report.deductions ? [{ label: 'Deduções', total: deductionsTotal, items: report.deductions.items || [] }] : [], true)}
    </body>
  </html>
  `;
}

async function generateDrePdfHtml({ report, company }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  const html = buildHtml({ report, company });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });
  await browser.close();
  return pdf;
}

module.exports = {
  generateDrePdfHtml,
};
