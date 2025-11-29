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

  const totalWidth = columns.reduce((acc, column) => acc + column.width, 0);

  doc
    .roundedRect(
      startX,
      startY,
      totalWidth,
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
      drawSectionTitle(doc, 'Vendas por produto', fonts);
      drawTableHeader(doc, { columns, fonts });
    }

    const stripe = index % 2 === 1;
    let cursorX = doc.x;
    if (stripe) {
      const totalWidth = columns.reduce((acc, column) => acc + column.width, 0);
      doc
        .rect(cursorX, doc.y - 2, totalWidth, rowHeight)
        .fillAndStroke(theme.tableStripeBg, theme.tableStripeBg);
      doc.fillColor(theme.body);
    }

    columns.forEach((column) => {
      const value = row[column.key];
      const display = column.formatter ? column.formatter(value) : value ?? '--';
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
    ensureSpace(doc, 24);
    doc
      .font(fonts.regular)
      .fontSize(10)
      .fillColor(theme.subtle)
      .text('Nenhuma venda no período informado.', { align: 'left' });
    return;
  }

  drawTableHeader(doc, { columns, fonts });
  drawTableRows(doc, { rows, columns, fonts });
}

async function generateSalesByPeriodPdf({ res, report }) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: DEFAULT_MARGINS,
    info: {
      Title: 'Vendas por Período — FluiTax Kardex',
      Author: 'FluiTax',
    },
  });

  doc.pipe(res);
  const fonts = registerFonts(doc);

  doc
    .font(fonts.semiBold)
    .fontSize(18)
    .fillColor(theme.primary)
    .text('Vendas por Período — FluiTax Kardex');
  doc.moveDown(1);

  drawKeyValueRow(doc, [
    {
      label: 'Período',
      value: `${formatDate(report.filters.from)} a ${formatDate(report.filters.to)}`,
      width: 240,
    },
    {
      label: 'Total vendido (unid)',
      value: formatNumber(report.totals.quantityUnits, 2),
      width: 160,
    },
    {
      label: 'MP consumida (SC)',
      value: formatNumber(report.totals.mpConsumedSc, 2),
      width: 160,
    },
    {
      label: 'Custo médio global (R$/SC)',
      value: formatNumber(report.totals.averageMpCostSc, 2),
      width: 200,
    },
  ], fonts);

  doc.moveDown(0.5);
  drawSectionTitle(doc, 'Vendas por produto', fonts);

  const columns = [
    { key: 'productLabel', label: 'Produto', width: 240, align: 'left' },
    { key: 'quantityUnits', label: 'Quantidade (unid)', width: 120, align: 'right', formatter: (value) => formatNumber(value, 2) },
    { key: 'averageUnitPrice', label: 'Preço méd. venda (R$/unid)', width: 160, align: 'right', formatter: (value) => formatNumber(value, 2) },
    { key: 'pricePerSc', label: 'Preço por saca (R$/SC)', width: 150, align: 'right', formatter: (value) => formatNumber(value, 2) },
    { key: 'mpConsumedSc', label: 'MP consumida (SC)', width: 140, align: 'right', formatter: (value) => formatNumber(value, 2) },
    { key: 'averageMpCostSc', label: 'Custo médio MP (R$/SC)', width: 160, align: 'right', formatter: (value) => formatNumber(value, 2) },
  ];

  drawTable(doc, {
    columns,
    rows: report.products,
    fonts,
  });

  doc.end();
}

module.exports = {
  generateSalesByPeriodPdf,
};
