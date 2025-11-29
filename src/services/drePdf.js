const PDFDocument = require('pdfkit');

// PDF simplificado e fiel aos dados do relatório
function formatCurrency(value) {
  if (value == null) return 'R$ --';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumber(value) {
  if (value == null) return '--';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ensureSpace(doc, height) {
  const limit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > limit) doc.addPage();
}

function header(doc, { company, filters }) {
  doc.font('Helvetica-Bold').fontSize(14).text('DRE - Demonstrativo de Resultado');
  doc.moveDown(0.2);
  const meta = [
    company?.name ? `Empresa: ${company.name}` : null,
    company?.cnpj ? `CNPJ: ${company.cnpj}` : null,
    filters?.from ? `Início: ${filters.from.slice(0, 10)}` : null,
    filters?.to ? `Fim: ${filters.to.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  doc.font('Helvetica').fontSize(9).fillColor('#444').text(meta || '');
  doc.moveDown(0.3);
  doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#ccc').lineWidth(1).stroke();
  doc.moveDown(0.5).fillColor('#000');
}

function table(doc, headers, rows, widths) {
  const startX = doc.x;
  const colCount = widths.length;
  const totalWidth = widths.reduce((a, b) => a + b, 0);

  // Header row with dynamic height
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#333');
  const headerHeights = headers.map((h, idx) =>
    doc.heightOfString(h, { width: widths[idx] - 8, align: idx === 0 ? 'left' : 'right' })
  );
  const headerHeight = Math.max(14, ...headerHeights);
  ensureSpace(doc, headerHeight + 2);
  const headerY = doc.y;
  doc.rect(startX, headerY - 2, totalWidth, headerHeight).fill('#efefef');
  headers.forEach((h, idx) => {
    const x = startX + widths.slice(0, idx).reduce((a, b) => a + b, 0);
    doc.text(h, x + 4, headerY, {
      width: widths[idx] - 8,
      align: idx === 0 ? 'left' : 'right',
    });
  });
  doc.y = headerY + headerHeight;

  // Data rows with dynamic height
  rows.forEach((row, rIdx) => {
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    const cellHeights = row.map((cell, idx) =>
      doc.heightOfString(cell, { width: widths[idx] - 8, align: idx === 0 ? 'left' : 'right' })
    );
    const rowHeight = Math.max(12, ...cellHeights);
    ensureSpace(doc, rowHeight + 2);
    const y = doc.y;
    if (rIdx % 2 === 0) {
      doc.rect(startX, y - 2, totalWidth, rowHeight).fill('#f9f9f9');
    }
    row.forEach((cell, cIdx) => {
      const x = startX + widths.slice(0, cIdx).reduce((a, b) => a + b, 0);
      doc.text(cell, x + 4, y, {
        width: widths[cIdx] - 8,
        align: cIdx === 0 ? 'left' : 'right',
      });
    });
    doc.y = y + rowHeight;
  });
  doc.moveDown(0.4);
}

function summary(doc, totals) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('Resumo');
  doc.moveDown(0.2);
  const rows = [
    ['Receita', formatCurrency(totals.revenueTotal)],
    ['Devoluções', formatCurrency(totals.returnsTotal)],
    ['Deduções', formatCurrency(totals.deductionsTotal)],
    ['CMV', formatCurrency(totals.cmvTotal)],
    ['Resultado bruto', formatCurrency(totals.grossResult)],
    ['Resultado líquido', formatCurrency(totals.netResult)],
  ];
  table(doc, ['Conta', 'Valor'], rows, [260, 120]);
}

function sectionWithProducts(doc, title, groups) {
  const colWidths = [260, 70, 100, 100];
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(title);
  doc.moveDown(0.2);
  if (!groups || !groups.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('Sem dados para este período.');
    doc.moveDown(0.4);
    return;
  }
  groups.forEach((group) => {
    ensureSpace(doc, 18);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000')
      .text(group.label, { continued: true })
      .font('Helvetica')
      .text(`  ${formatCurrency(group.total)}`, { align: 'right' });
    doc.moveDown(0.2);
    const rows = (group.items || []).map((item) => [
      `${item.product}${item.sku ? ` · ${item.sku}` : ''}`,
      formatNumber(item.qty),
      formatCurrency(item.total),
      formatCurrency(item.avgPrice),
    ]);
    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('Sem produtos nesta natureza.');
      doc.moveDown(0.3);
    } else {
      table(doc, ['Produto', 'Qtd', 'Total', 'Preço médio'], rows, colWidths);
    }
    doc.moveDown(0.4);
  });
}

function sectionDeductions(doc, deductions) {
  const colWidths = [260, 170, 100];
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('Deduções');
  doc.moveDown(0.2);
  if (!deductions) {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('Sem deduções no período.');
    doc.moveDown(0.2);
    return;
  }
  doc.font('Helvetica').fontSize(10).text(`Total: ${formatCurrency(deductions.total)}`);
  doc.moveDown(0.2);
  const rows = (deductions.items || []).map((item) => [
    item.title,
    `${item.startDate.slice(0, 10)} — ${item.endDate.slice(0, 10)}`,
    formatCurrency(item.amount),
  ]);
  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('Sem deduções no período.');
    doc.moveDown(0.2);
  } else {
    table(doc, ['Descrição', 'Período', 'Valor'], rows, colWidths);
  }
}

async function generateDrePdf({ res, report, company }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 36, left: 32, right: 32 } });
  doc.pipe(res);

  header(doc, { company, filters: report.filters });

  const revenueTotal = report?.revenue?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
  const returnsTotal = report?.returns?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
  const cmvTotal = report?.cmv?.reduce((sum, g) => sum + (g.total || 0), 0) ?? 0;
  const deductionsTotal = report?.deductions?.total ?? 0;
  const grossResult = revenueTotal - returnsTotal - cmvTotal;
  const netResult = revenueTotal - returnsTotal - deductionsTotal - cmvTotal;

  summary(doc, { revenueTotal, returnsTotal, deductionsTotal, cmvTotal, grossResult, netResult });
  sectionWithProducts(doc, 'Receitas', report.revenue);
  sectionWithProducts(doc, 'Devoluções', report.returns);
  sectionWithProducts(doc, 'CMV', report.cmv);
  sectionDeductions(doc, report.deductions);

  doc.end();
}

module.exports = {
  generateDrePdf,
};
