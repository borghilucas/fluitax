const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FONT_PATHS = {
  inter: path.resolve(__dirname, '../assets/fonts/InterVariable.ttf'),
  mono: path.resolve(__dirname, '../assets/fonts/RobotoMono-Variable.ttf'),
};

const DEFAULT_MARGINS = {
  top: 36,
  bottom: 40,
  left: 32,
  right: 32,
};

const theme = {
  primary: '#003366',
  body: '#333333',
  subtle: '#555555',
  divider: '#CCCCCC',
  tableHeaderBg: '#F5F5F5',
  tableStripeBg: '#FAFAFA',
  tableBorder: '#DDDDDD',
};

function registerFonts(doc) {
  const fonts = {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    semiBold: 'Helvetica-Bold',
    mono: 'Courier',
  };

  if (fs.existsSync(FONT_PATHS.inter)) {
    doc.registerFont('Inter-Regular', FONT_PATHS.inter);
    doc.registerFont('Inter-SemiBold', FONT_PATHS.inter);
    fonts.regular = 'Inter-Regular';
    fonts.bold = 'Inter-SemiBold';
    fonts.semiBold = 'Inter-SemiBold';
  }
  if (fs.existsSync(FONT_PATHS.mono)) {
    doc.registerFont('RobotoMono-Regular', FONT_PATHS.mono);
    fonts.mono = 'RobotoMono-Regular';
  }
  return fonts;
}

function formatNumber(value, fractionDigits = 2) {
  if (value == null || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDate(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function ensureSpace(doc, expectedHeight) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + expectedHeight > bottomLimit) {
    doc.addPage();
  }
}

function drawSectionTitle(doc, text, fonts) {
  ensureSpace(doc, 32);
  doc
    .font(fonts.semiBold)
    .fontSize(16)
    .fillColor(theme.primary)
    .text(text, { align: 'left' });
  doc.moveDown(0.5);
  doc
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(1)
    .strokeColor(theme.divider)
    .stroke();
  doc.moveDown(0.5);
  doc.fillColor(theme.body);
}

function drawKeyValueRow(doc, entries, fonts) {
  const rowHeight = 18;
  ensureSpace(doc, rowHeight);
  const { x } = doc;
  let cursorX = x;
  entries.forEach((entry) => {
    const width = entry.width ?? 160;
    doc
      .font(fonts.semiBold)
      .fontSize(9)
      .fillColor(theme.subtle)
      .text(entry.label, cursorX, doc.y, { width });
    doc
      .font(fonts.regular)
      .fontSize(10)
      .fillColor(theme.body)
      .text(entry.value ?? '--', cursorX, doc.y, { width });
    cursorX += width + (entry.gap ?? 16);
  });
  doc.moveDown(0.5);
}

function drawTableHeader(doc, { columns, fonts }) {
  const headerHeight = 20;
  ensureSpace(doc, headerHeight + 8);
  const startX = doc.x;
  const startY = doc.y;

  doc
    .roundedRect(
      startX,
      startY,
      columns.reduce((acc, column) => acc + column.width, 0),
      headerHeight,
      4,
    )
    .fillAndStroke(theme.tableHeaderBg, theme.tableBorder);

  let cursorX = startX;
  columns.forEach((column) => {
    doc
      .font(fonts.semiBold)
      .fontSize(9)
      .fillColor(theme.primary)
      .text(column.label, cursorX + 4, startY + 6, {
        width: column.width - 8,
        align: column.align ?? 'left',
      });
    cursorX += column.width;
  });

  doc.y = startY + headerHeight + 2;
  doc.fillColor(theme.body);
}

function drawTableRows(doc, { rows, columns, fonts }) {
  const rowHeight = 18;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  rows.forEach((row, index) => {
    if (doc.y + rowHeight > pageBottom) {
      doc.addPage();
      drawTableHeader(doc, { columns, fonts });
    }

    const stripe = index % 2 === 1;
    let cursorX = doc.x;
    if (stripe) {
      doc
        .rect(cursorX, doc.y - 2, columns.reduce((acc, column) => acc + column.width, 0), rowHeight)
        .fillAndStroke(theme.tableStripeBg, theme.tableStripeBg);
      doc.fillColor(theme.body);
    }

    columns.forEach((column) => {
      const value = row[column.key];
      let display = value ?? '--';
      if (column.formatter) {
        display = column.formatter(value);
      }
      doc
        .font(fonts.regular)
        .fontSize(9)
        .fillColor(theme.body)
        .text(display, cursorX + 4, doc.y + 4, {
          width: column.width - 8,
          align: column.align ?? 'left',
        });
      cursorX += column.width;
    });

    doc.y += rowHeight;
  });
}

function drawTable(doc, { columns, rows, fonts }) {
  if (!rows.length) {
    ensureSpace(doc, 30);
    doc
      .font(fonts.regular)
      .fontSize(10)
      .fillColor(theme.subtle)
      .text('Nenhum registro encontrado para o período informado.', {
        align: 'left',
      });
    doc.moveDown();
    return;
  }

  drawTableHeader(doc, { columns, fonts });
  drawTableRows(doc, { rows, columns, fonts });
  doc.moveDown();
}

function drawMpTotals(doc, { report, fonts }) {
  const totals = report.mpTotals ?? {};
  const rows = [
    { label: 'Entradas (SC)', value: formatNumber(totals.entriesSc, 4) },
    { label: 'Saídas (SC)', value: formatNumber(totals.exitsSc, 4) },
    { label: 'Saldo Final (SC)', value: formatNumber(totals.balanceSc, 4) },
    { label: 'Custo Médio Final (R$/SC)', value: formatNumber(totals.movingAverageCost, 2) },
    { label: 'Valor em Estoque (R$)', value: formatNumber(totals.balanceValue, 2) },
  ];

  ensureSpace(doc, rows.length * 18 + 12);
  const startX = doc.x;
  const totalWidth = 400;
  const cellHeight = 18;

  doc
    .roundedRect(startX, doc.y, totalWidth, rows.length * cellHeight, 6)
    .strokeColor(theme.tableBorder)
    .stroke();

  rows.forEach((row, index) => {
    const y = doc.y + index * cellHeight;
    doc
      .font(fonts.semiBold)
      .fontSize(9)
      .fillColor(theme.subtle)
      .text(row.label, startX + 8, y + 4, { width: 220 });
    doc
      .font(fonts.regular)
      .fontSize(10)
      .fillColor(theme.body)
      .text(row.value, startX + 230, y + 4, { width: 150, align: 'right' });
    if (index < rows.length - 1) {
      doc
        .moveTo(startX, y + cellHeight)
        .lineTo(startX + totalWidth, y + cellHeight)
        .strokeColor(theme.tableBorder)
        .lineWidth(0.5)
        .stroke();
    }
  });
  doc.moveDown(2);
}

function drawFinishedTotals(doc, { report, fonts }) {
  const overall = report.finishedTotals ?? {};
  const byProduct = report.finishedTotalsByProduct ?? [];

  ensureSpace(doc, 26 + byProduct.length * 18);
  doc
    .font(fonts.semiBold)
    .fontSize(12)
    .fillColor(theme.primary)
    .text('Totais por Produto Acabado', { align: 'left' });
  doc.moveDown(0.4);

  byProduct.forEach((entry) => {
    ensureSpace(doc, 18);
    doc
      .font(fonts.semiBold)
      .fontSize(10)
      .fillColor(theme.body)
      .text(entry.productAlias ?? '--', { continued: true });
    doc
      .font(fonts.regular)
      .fontSize(10)
      .fillColor(theme.body)
      .text(
        ` • Qtd: ${formatNumber(entry.qtyUnits, 2)} un • MP: ${formatNumber(entry.mpConsumedSc, 4)} SC • Receita Bruta/Saca: ${formatNumber(entry.revenuePerSc, 2)} • CMV: ${formatNumber(entry.mpCostValue, 2)}`,
      );
  });

  doc.moveDown(0.8);
  doc
    .font(fonts.semiBold)
    .fontSize(10)
    .fillColor(theme.primary)
    .text('Totais consolidados:');
  doc
    .font(fonts.regular)
    .fontSize(10)
    .fillColor(theme.body)
    .text(
      `Unidades vendidas: ${formatNumber(overall.qtyUnits, 2)} • MP consumida: ${formatNumber(overall.mpConsumedSc, 4)} SC • Receita bruta/saca: ${formatNumber(overall.revenuePerSc, 2)} • CMV estimado: ${formatNumber(overall.mpCostValue, 2)}`,
    );
  doc.moveDown();
}

function drawHeader(doc, { fonts, title, subtitle }) {
  const { left, right, top } = doc.page.margins;
  const pageWidth = doc.page.width - left - right;

  doc
    .font(fonts.semiBold)
    .fontSize(18)
    .fillColor(theme.primary)
    .text(title, left, top - 10, { width: pageWidth, align: 'left' });
  if (subtitle) {
    doc
      .font(fonts.regular)
      .fontSize(11)
      .fillColor(theme.subtle)
      .text(subtitle, left, top + 12, { width: pageWidth, align: 'left' });
  }
  doc.moveDown(1.5);
}

function drawFooter(doc, fonts) {
  const { left, right, bottom } = doc.page.margins;
  const footerY = doc.page.height - bottom + 10;
  const pageWidth = doc.page.width - left - right;
  doc
    .font(fonts.regular)
    .fontSize(9)
    .fillColor(theme.subtle)
    .text(`Página ${doc.page.number}`, left, footerY, { width: pageWidth, align: 'right' });
}

function generateKardexConsolidatedPdf({
  res,
  report,
  filters,
  metadata,
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: DEFAULT_MARGINS,
        bufferPages: true,
      });

      const fonts = registerFonts(doc);
      doc.pipe(res);

      const periodLabel = filters?.from && filters?.to
        ? `${formatDate(filters.from)} a ${formatDate(filters.to)}`
        : 'Período não informado';

      const companyNames = (report.filters?.companies ?? []).map((company) => company.name).join(' + ') || 'Empresas não identificadas';

      drawHeader(doc, {
        fonts,
        title: 'Relatório Kardex Consolidado (JM + OLG)',
        subtitle: `${companyNames} • ${periodLabel}`,
      });

      drawKeyValueRow(doc, [
        { label: 'Gerado em', value: formatDateTime(new Date()), width: 190 },
        { label: 'Período', value: periodLabel, width: 220 },
        { label: 'Empresas', value: companyNames, width: 260 },
      ], fonts);

      doc.moveDown(0.5);

      drawSectionTitle(doc, 'Bloco 1 — Kardex da Matéria-Prima (MP_CONILON)', fonts);

      const mpColumns = [
        { key: 'timestamp', label: 'Data/Hora', width: 90, formatter: formatDateTime },
        { key: 'document', label: 'Documento', width: 70 },
        { key: 'partner', label: 'Parceiro', width: 145 },
        { key: 'cfop', label: 'CFOP', width: 45 },
        { key: 'type', label: 'Tipo', width: 55 },
        { key: 'qtySc', label: 'Qtd (SC)', width: 70, formatter: (value) => formatNumber(value, 4) },
        { key: 'unitCostSc', label: 'Custo Unit. (R$/SC)', width: 90, formatter: formatNumber },
        { key: 'movingAverageCost', label: 'Custo Médio Após (R$/SC)', width: 105, formatter: formatNumber },
        { key: 'balanceSc', label: 'Saldo (SC)', width: 75, formatter: (value) => formatNumber(value, 4) },
        { key: 'notes', label: 'Observações', width: 120 },
      ];

      const mpRows = (report.mpMovements ?? []).map((movement) => ({
        ...movement,
        type: movement.type === 'SALDO_INICIAL' ? 'Saldo Inicial' : movement.type === 'ENTRADA' ? 'Entrada' : movement.type === 'SAIDA' ? 'Saída' : (movement.type ?? '--'),
      }));

      drawTable(doc, { columns: mpColumns, rows: mpRows, fonts });

      drawMpTotals(doc, { report, fonts });

      doc.moveDown(0.5);
      drawSectionTitle(doc, 'Bloco 2 — Vendas de Produtos Acabados', fonts);

      const finishedColumns = [
        { key: 'timestamp', label: 'Data/Hora', width: 90, formatter: formatDateTime },
        { key: 'document', label: 'Documento', width: 70 },
        { key: 'partner', label: 'Parceiro', width: 140 },
        { key: 'productAlias', label: 'Produto', width: 130 },
        { key: 'qtyUnits', label: 'Qtd (unid)', width: 70, formatter: (value) => formatNumber(value, 2) },
        { key: 'unitPrice', label: 'Preço Unit. (R$)', width: 80, formatter: formatNumber },
        { key: 'mpConsumedSc', label: 'MP Consumida (SC)', width: 85, formatter: (value) => formatNumber(value, 4) },
        { key: 'costAverageSc', label: 'Custo Médio (R$/SC)', width: 90, formatter: formatNumber },
        { key: 'valuePerSc', label: 'Valor Saca Bruta (R$)', width: 100, formatter: formatNumber },
      ];

      drawTable(doc, { columns: finishedColumns, rows: report.finishedSales ?? [], fonts });

      drawFinishedTotals(doc, { report, fonts });

      drawKeyValueRow(doc, [
        { label: 'Gerado por', value: metadata?.requestedBy ?? 'FluiTax', width: 200 },
        { label: 'Referência', value: metadata?.reference ?? '--', width: 250 },
      ], fonts);

      const pageCount = doc.bufferedPageRange();
      for (let pageIndex = 0; pageIndex < pageCount.count; pageIndex += 1) {
        doc.switchToPage(pageIndex);
        drawFooter(doc, fonts);
      }

      doc.end();
      doc.on('finish', resolve);
      doc.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateKardexConsolidatedPdf,
};
