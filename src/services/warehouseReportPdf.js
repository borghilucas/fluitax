const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FONT_PATHS = {
  inter: path.resolve(__dirname, '../assets/fonts/InterVariable.ttf'),
  mono: path.resolve(__dirname, '../assets/fonts/RobotoMono-Variable.ttf'),
};

const theme = {
  primary: '#003366',
  body: '#333333',
  subtle: '#555555',
  divider: '#CCCCCC',
  softDivider: '#E0E0E0',
  tableHeaderBg: '#F5F5F5',
  tableHeaderAltBg: '#F0F0F0',
  tableHeaderText: '#444444',
  tableBorder: '#C5D1DD',
  tableDivider: '#E0E6ED',
  indexAccent: '#7A8CA5',
  positive: '#2E7D32',
  negative: '#C62828',
  warning: '#FF8F00',
  alertBackground: '#FFF2F2',
  alertBorder: '#F1B5B5',
  alertHeaderText: '#8B1A1A',
  footer: '#777777',
  neutralBackground: '#FAFAFA',
};

function registerFonts(doc) {
  const fonts = {
    regular: 'Helvetica',
    semiBold: 'Helvetica-Bold',
    bold: 'Helvetica-Bold',
    mono: 'Courier',
  };

  if (fs.existsSync(FONT_PATHS.inter)) {
    doc.registerFont('Inter-Regular', FONT_PATHS.inter);
    doc.registerFont('Inter-SemiBold', FONT_PATHS.inter);
    fonts.regular = 'Inter-Regular';
    fonts.semiBold = 'Inter-SemiBold';
    fonts.bold = 'Inter-SemiBold';
  }

  if (fs.existsSync(FONT_PATHS.mono)) {
    doc.registerFont('RobotoMono-Regular', FONT_PATHS.mono);
    fonts.mono = 'RobotoMono-Regular';
  }

  return fonts;
}

function ensureSpace(doc, expectedHeight) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + expectedHeight > bottomLimit) {
    doc.addPage();
  }
}

function formatNumberBr(value, fractionDigits = 2) {
  if (value == null || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDateBr(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function formatDateTimeBr(value) {
  if (!value) return '--';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatTypeLabel(value) {
  if (!value) return '--';
  return String(value)
    .split('_')
    .map((chunk) => chunk.charAt(0) + chunk.slice(1).toLowerCase())
    .join(' ');
}

function resolveInvoiceIdentifier(entry) {
  if (!entry) return '--';
  const serie = entry.invoiceSerie
    ?? entry.invoiceSeries
    ?? entry.invoice?.serie
    ?? entry.invoice?.series;
  const directNumber = entry.invoiceNumero
    ?? entry.invoiceNumber
    ?? entry.invoice?.numero
    ?? entry.invoice?.number;

  if (directNumber) {
    const formattedNumber = String(directNumber).trim();
    const sanitized = formattedNumber.replace(/^0+/, '');
    return sanitized.length ? sanitized : formattedNumber;
  }

  const chave = entry.invoiceChave ?? entry.invoice?.chave;
  if (typeof chave === 'string' && chave.length >= 9) {
    return chave.slice(-9);
  }

  return chave ?? '--';
}

function prepareTableCell(doc, {
  text,
  fontName,
  fontSize,
  characterSpacing = 0,
  maxWidth,
  align = 'left',
  allowWrap = false,
  lineGap = 1.2,
  minFontSize = 7,
  color = theme.body,
  useEllipsis = false,
}) {
  const content = text == null || text === '' ? '--' : String(text);
  const originalFont = doc._font?.name;
  const originalSize = doc._fontSize;

  let workingSize = fontSize;
  doc.font(fontName).fontSize(workingSize);
  let workingContent = content;

  if (!allowWrap && maxWidth > 0) {
    const padding = 4;
    const targetWidth = Math.max(0, maxWidth - padding);
    let measuredWidth = doc.widthOfString(workingContent, { characterSpacing });
    while (measuredWidth > targetWidth && workingSize > minFontSize) {
      workingSize -= 0.25;
      doc.font(fontName).fontSize(workingSize);
      measuredWidth = doc.widthOfString(workingContent, { characterSpacing });
    }

    if (useEllipsis && measuredWidth > targetWidth) {
      const ellipsis = '…';
      let base = workingContent;
      while (base.length > 1) {
        base = base.slice(0, -1);
        const candidate = `${base}${ellipsis}`;
        measuredWidth = doc.widthOfString(candidate, { characterSpacing });
        if (measuredWidth <= targetWidth) {
          workingContent = candidate;
          break;
        }
      }
    }
  }

  const heightOptions = {
    width: Math.max(0, maxWidth - 4),
    lineGap,
    characterSpacing,
    lineBreak: allowWrap,
  };
  const measuredHeight = doc.heightOfString(workingContent, heightOptions);

  if (originalFont) {
    doc.font(originalFont);
  }
  if (originalSize) {
    doc.fontSize(originalSize);
  }

  return {
    text: workingContent,
    fontName,
    fontSize: workingSize,
    characterSpacing,
    align,
    allowWrap,
    lineGap,
    height: measuredHeight + 6,
    color,
  };
}

function drawTableCell(doc, cell, {
  x,
  y,
  width,
}) {
  const padding = 4;
  const textWidth = Math.max(0, width - padding * 2);
  const originalFont = doc._font?.name;
  const originalSize = doc._fontSize;
  const clipHeight = (cell.height ?? doc.currentLineHeight()) + padding;

  doc.save();
  doc.rect(x, y, width, clipHeight).clip();
  doc.font(cell.fontName).fontSize(cell.fontSize).fillColor(cell.color ?? theme.body);

  if (cell.allowWrap) {
    doc.text(cell.text, x + padding, y + padding / 2, {
      width: textWidth,
      align: cell.align,
      lineGap: cell.lineGap,
      characterSpacing: cell.characterSpacing,
    });
  } else {
    doc.text(cell.text, x + padding, y + padding / 2, {
      width: textWidth,
      align: cell.align,
      lineBreak: false,
      characterSpacing: cell.characterSpacing,
    });
  }
  doc.restore();

  if (originalFont) {
    doc.font(originalFont);
  }
  if (originalSize) {
    doc.fontSize(originalSize);
  }
}

function drawPageHeader(doc, context) {
  const { layout, fonts, assets, header } = context;
  const { companyName, cnpj, period, generatedAt, responsible, metricsLine } = header;

  const top = doc.page.margins.top;
  let cursorY = top;

  if (assets.logoPath && fs.existsSync(assets.logoPath)) {
    try {
      doc.image(assets.logoPath, layout.left + layout.width - 100, top - 8, {
        width: 96,
        fit: [96, 40],
        align: 'right',
      });
    } catch (error) {
      // ignore drawing errors, fallback to textual header
    }
  }

  const institutionalWidth = layout.width - 120;
  doc.font(fonts.bold).fontSize(12).fillColor(theme.primary)
    .text(companyName, layout.left, cursorY, {
      width: institutionalWidth,
      lineGap: 2,
    });

  cursorY = doc.y;

  const infoLines = [
    `CNPJ: ${cnpj}`,
    `Período: ${period}`,
    `Data de geração: ${generatedAt}`,
    `Responsável: ${responsible}`,
    metricsLine,
  ];

  doc.font(fonts.regular).fontSize(10).fillColor(theme.subtle);
  infoLines.forEach((line, index) => {
    doc.text(line, layout.left, cursorY + (index === 0 ? 4 : 0), {
      width: institutionalWidth,
      lineGap: 2,
    });
    cursorY = doc.y;
  });

  const blockBottom = cursorY + 6;
  doc.strokeColor(theme.divider).lineWidth(1)
    .moveTo(layout.left, blockBottom)
    .lineTo(layout.left + layout.width, blockBottom)
    .stroke();

  doc.y = blockBottom + 12;

  doc.font(fonts.bold).fontSize(13).fillColor(theme.primary)
    .text('RELATÓRIO DE CONTROLE DE ARMAZÉM GERAL', layout.left, doc.y, {
      width: layout.width,
      align: 'center',
      characterSpacing: 0.2,
    });

  doc.font(fonts.regular).fontSize(10).fillColor(theme.subtle)
    .text('(Documento gerado automaticamente — sem valor fiscal)', layout.left, doc.y + 4, {
      width: layout.width,
      align: 'center',
    });

  const titleDividerY = doc.y + 10;
  doc.strokeColor(theme.divider).lineWidth(1)
    .moveTo(layout.left, titleDividerY)
    .lineTo(layout.left + layout.width, titleDividerY)
    .stroke();

  doc.y = titleDividerY + 10;
}

function drawSummarySection(doc, context) {
  const { report, totals, layout, fonts } = context;
  ensureSpace(doc, 200);

  doc.moveDown(0.6);
  doc.font(fonts.semiBold).fontSize(12).fillColor(theme.primary)
    .text('Resumo contábil consolidado', layout.left, doc.y, {
      width: layout.width,
      align: 'center',
    });
  doc.moveDown(0.4);

  const tableWidth = Math.min(layout.width * 0.9, 460);
  const tableX = layout.left + (layout.width - tableWidth) / 2;
  const headerHeight = 24;
  const columnPerc = [0.37, 0.17, 0.21, 0.25];
  const columnWidths = columnPerc.map((p) => tableWidth * p);
  const columnPositions = columnPerc.map((p, idx) => (
    tableX + columnPerc.slice(0, idx).reduce((acc, current) => acc + current, 0) * tableWidth
  ));

  const tableTop = doc.y;

  doc.save();
  doc.fillColor(theme.tableHeaderBg)
    .rect(tableX, tableTop, tableWidth, headerHeight)
    .fill();
  doc.strokeColor(theme.tableBorder).lineWidth(0.6)
    .rect(tableX, tableTop, tableWidth, headerHeight)
    .stroke();
  doc.restore();

  const headers = ['Indicador', 'Quantidade', 'Valor (R$)', 'Observação'];
  doc.font(fonts.semiBold).fontSize(10).fillColor(theme.tableHeaderText);
  headers.forEach((headerLabel, index) => {
    const align = index === 0 || index === headers.length - 1 ? 'left' : 'right';
    const textX = index === 0 ? columnPositions[index] + 10 : columnPositions[index];
    doc.text(headerLabel, textX, tableTop + 7, {
      width: columnWidths[index] - (index === 0 ? 14 : 6),
      align,
    });
  });

  doc.y = tableTop + headerHeight + 2;

  const summaryRows = [
    {
      label: 'Saldo inicial',
      qty: formatNumberBr(report.totals.openingQty, 4),
      value: formatNumberBr(report.totals.openingValue),
      note: '-',
    },
    {
      label: 'Total Remessas (CFOP 5905)',
      qty: formatNumberBr(report.totals.remessaQty, 4),
      value: formatNumberBr(report.totals.remessaValue),
      note: 'Saídas para armazém',
    },
    {
      label: 'Total Retornos (CFOP 5906)',
      qty: formatNumberBr(report.totals.retornoQty, 4),
      value: formatNumberBr(report.totals.retornoValue),
      note: 'Entradas de retorno',
    },
    {
      label: 'Saldo contábil final',
      qty: formatNumberBr(report.totals.closingQty, 4),
      value: formatNumberBr(report.totals.closingValue),
      note: 'Estoque pendente',
      strong: true,
    },
  ];

  summaryRows.forEach((row, rowIndex) => {
    const rowTop = doc.y + 6;
    const isStrong = Boolean(row.strong);
    const fontName = isStrong ? fonts.bold : fonts.regular;
    const color = isStrong ? theme.primary : theme.body;

    doc.font(fontName).fontSize(10).fillColor(color)
      .text(row.label, columnPositions[0] + 10, rowTop, {
        width: columnWidths[0] - 14,
        lineGap: 2,
      });

    doc.font(fontName).fillColor(color)
      .text(row.qty, columnPositions[1], rowTop, {
        width: columnWidths[1] - 6,
        align: 'right',
      });

    doc.font(fontName).fillColor(color)
      .text(row.value, columnPositions[2], rowTop, {
        width: columnWidths[2] - 6,
        align: 'right',
      });

    doc.font(fontName).fillColor(color)
      .text(row.note, columnPositions[3] + 8, rowTop, {
        width: columnWidths[3] - 12,
        align: 'left',
      });

    const rowBottom = rowTop + 20;
    doc.strokeColor(theme.tableDivider).lineWidth(0.4)
      .moveTo(tableX, rowBottom)
      .lineTo(tableX + tableWidth, rowBottom)
      .stroke();

    doc.y = rowBottom - 6;
    if (rowIndex === summaryRows.length - 1) {
      doc.y += 8;
    }
  });

  const separatorY = doc.y + 6;
  doc.strokeColor(theme.softDivider).lineWidth(0.6)
    .moveTo(layout.left, separatorY)
    .lineTo(layout.left + layout.width, separatorY)
    .stroke();
  doc.y = separatorY + 8;

  doc.font(fonts.semiBold).fontSize(10).fillColor(theme.primary)
    .text('Distribuição financeira (R$)', tableX, doc.y, {
      width: tableWidth,
    });

  const distributionLabelY = doc.y + 14;
  doc.font(fonts.regular).fontSize(9.5).fillColor(theme.body)
    .text(`Remessas: R$ ${formatNumberBr(report.totals.remessaValue)}`, tableX, distributionLabelY, {
      width: tableWidth,
    });
  doc.text(`Retornos: R$ ${formatNumberBr(report.totals.retornoValue)}`, tableX, doc.y + 2, {
    width: tableWidth,
  });

  doc.y = doc.y + 10;

  drawDistributionChart(doc, {
    fonts,
    layout,
    remessa: Number(report.totals.remessaValue ?? 0),
    retorno: Number(report.totals.retornoValue ?? 0),
    startX: tableX,
    maxWidth: tableWidth,
  });
}

function drawDistributionChart(doc, context) {
  const {
    fonts,
    layout,
    remessa,
    retorno,
    startX = layout.left,
    maxWidth = layout.width,
  } = context;
  const chartWidth = Math.min(maxWidth * 0.45, 220);
  const barHeight = 12;
  const barGap = 12;
  let cursorY = doc.y + 6;
  const max = Math.max(1, remessa, retorno);
  const series = [
    { label: 'Remessas', value: remessa, color: theme.primary },
    { label: 'Retornos', value: retorno, color: theme.positive },
  ];

  series.forEach((entry, index) => {
    const y = cursorY + index * (barHeight + barGap);
    doc.save();
    doc.fillColor('#E7ECF5').rect(startX, y, chartWidth, barHeight).fill();
    const barWidth = Math.max(1, (entry.value / max) * chartWidth);
    doc.fillColor(entry.color).rect(startX, y, barWidth, barHeight).fill();
    doc.restore();

    const labelX = startX + chartWidth + 16;
    doc.font(fonts.semiBold).fontSize(9).fillColor(theme.body)
      .text(entry.label, labelX, y - 1, { width: 140 });
    doc.font(fonts.mono).fontSize(9).fillColor(theme.body)
      .text(`R$ ${formatNumberBr(entry.value)}`, labelX, y + 10, {
        width: 140,
      });
  });

  doc.y = cursorY + series.length * (barHeight + barGap) + 4;
}

function drawProductIndex(doc, context) {
  const { report, layout, fonts, anchors = [] } = context;
  if (!report.groups.length) return;

  ensureSpace(doc, 180);
  doc.addNamedDestination('indice-produtos');
  doc.moveDown(0.6);
  doc.font(fonts.semiBold).fontSize(11).fillColor(theme.primary)
    .text('Índice de Produtos (por Valor Unitário)', layout.left, doc.y);
  doc.moveDown(0.15);
  doc.font(fonts.regular).fontSize(8.5).fillColor(theme.subtle)
    .text('Clique em um produto para navegar ao detalhamento e use "⤴ Voltar ao índice" para retornar.', layout.left, doc.y, {
      width: layout.width,
    });
  doc.moveDown(0.6);

  const items = report.groups.map((group, index) => {
    const label = group.product.productName
      ?? group.product.productDescription
      ?? group.product.productCode
      ?? 'Produto não identificado';
    return {
      label: `${label} — R$ ${formatNumberBr(group.unitPrice)}`,
      anchor: anchors[index] ?? null,
    };
  });

  const columnGap = 18;
  const columnWidth = (layout.width - columnGap) / 2;
  const rows = Math.ceil(items.length / 2);

  doc.font(fonts.regular).fontSize(9.5).fillColor(theme.body);
  for (let row = 0; row < rows; row += 1) {
    const leftItem = items[row];
    const rightItem = items[row + rows];
    const rowTop = doc.y;

    if (leftItem) {
      const leftHeight = doc.heightOfString(leftItem.label, {
        width: columnWidth,
        lineGap: 2,
      });
      doc.text(leftItem.label, layout.left, rowTop, {
        width: columnWidth,
        lineGap: 2,
      });
      if (leftItem.anchor) {
        doc.link(layout.left, rowTop, columnWidth, leftHeight, { destination: leftItem.anchor });
      }
      doc.y = rowTop;
      const rightHeight = rightItem
        ? doc.heightOfString(rightItem.label, { width: columnWidth, lineGap: 2 })
        : 0;
      if (rightItem) {
        const rightX = layout.left + columnWidth + columnGap;
        doc.text(rightItem.label, rightX, rowTop, {
          width: columnWidth,
          lineGap: 2,
        });
        if (rightItem.anchor) {
          doc.link(rightX, rowTop, columnWidth, rightHeight, { destination: rightItem.anchor });
        }
      }
      const rowHeight = Math.max(leftHeight, rightHeight, 12);
      doc.y = rowTop + rowHeight + 4;
    }
  }
}

function drawInconsistenciesSection(doc, context) {
  const { report, layout, fonts, totals } = context;
  if (!report.mismatches.length) return;

  const padding = 14;
  const blockWidth = layout.width - padding * 2;
  const cardBackground = '#FFF4E6';
  const cardBorder = '#FFB56A';

  const headerText = '⚠️ Inconsistências encontradas — ajuste necessário';
  const infoText = `Total: ${report.mismatches.length} | Valor financeiro sujeito a ajuste: R$ ${formatNumberBr(totals.inconsistentTotal)}`;

  doc.moveDown(1.1);
  doc.font(fonts.bold).fontSize(12).fillColor(theme.alertHeaderText)
    .text(headerText, layout.left, doc.y, { width: layout.width });
  doc.moveDown(0.25);
  doc.font(fonts.regular).fontSize(9.8).fillColor(theme.body)
    .text(infoText, layout.left, doc.y, { width: layout.width });
  doc.moveDown(0.65);

  report.mismatches.forEach((item) => {
    const productLabel = item.product.productName
      ?? item.product.productDescription
      ?? item.product.productCode
      ?? 'Produto não identificado';
    const invoiceDisplay = resolveInvoiceIdentifier(item);
    const emphasize = ['VALUE_DRIFT', 'UNIT_PRICE_MISMATCH', 'RETURN_WITHOUT_REMESSA'].includes(item.type);

    const metadataParts = [
      invoiceDisplay ? `NF-e nº ${invoiceDisplay}` : null,
      item.invoice?.emissao ? `Emissão: ${formatDateBr(item.invoice.emissao)}` : null,
      `Tipo: ${formatTypeLabel(item.type)}`,
    ].filter(Boolean);

    const numericParts = [
      `Quant.: ${formatNumberBr(item.quantity, 4)}`,
      `Valor unit.: R$ ${formatNumberBr(item.unitPrice)}`,
      `Valor total: R$ ${formatNumberBr(item.totalValue ?? item.deltaValue ?? 0)}`,
    ];

    const observation = item.message ?? '-';

    const badgeLabel = emphasize ? '⚠ Divergência' : 'ℹ Item para revisão';
    const badgeColor = emphasize ? theme.warning : theme.subtle;

    const cardPadding = 12;
    const innerX = layout.left + padding + cardPadding;

    doc.font(fonts.semiBold).fontSize(10);
    const titleHeight = doc.heightOfString(productLabel, { width: blockWidth - cardPadding * 2, lineGap: 2 });

    doc.font(fonts.regular).fontSize(9);
    const metadataHeight = metadataParts.length
      ? doc.heightOfString(metadataParts.join('  •  '), { width: blockWidth - cardPadding * 2, lineGap: 2 })
      : 0;

    doc.font(fonts.mono).fontSize(9);
    const numericHeight = doc.heightOfString(numericParts.join('   '), { width: blockWidth - cardPadding * 2, lineGap: 2 });

    doc.font(fonts.regular).fontSize(9);
    const observationHeight = doc.heightOfString(observation, { width: blockWidth - cardPadding * 2, lineGap: 1.45 });

    const badgeHeight = 12;
    const cardHeight = cardPadding * 2
      + badgeHeight
      + titleHeight
      + (metadataHeight ? metadataHeight + 4 : 0)
      + numericHeight + 4
      + observationHeight;

    ensureSpace(doc, cardHeight + 16);

    const cardTop = doc.y;

    doc.save();
    doc.roundedRect(layout.left + padding, cardTop, blockWidth, cardHeight, 8)
      .fill(cardBackground);
    doc.restore();

    doc.save();
    doc.roundedRect(layout.left + padding, cardTop, blockWidth, cardHeight, 8)
      .strokeColor(cardBorder)
      .lineWidth(1)
      .stroke();
    doc.restore();

    let cursorY = cardTop + cardPadding;

    doc.save();
    doc.fillColor(badgeColor).font(fonts.semiBold).fontSize(9)
      .text(badgeLabel, innerX, cursorY, { lineBreak: false });
    doc.restore();
    cursorY += badgeHeight;

    doc.font(fonts.semiBold).fontSize(10).fillColor(theme.body)
      .text(productLabel, innerX, cursorY, {
        width: blockWidth - cardPadding * 2,
        lineGap: 2,
      });
    cursorY += titleHeight + 4;

    if (metadataHeight) {
      doc.font(fonts.regular).fontSize(9).fillColor(theme.subtle)
        .text(metadataParts.join('  •  '), innerX, cursorY, {
          width: blockWidth - cardPadding * 2,
          lineGap: 2,
        });
      cursorY += metadataHeight + 4;
    }

    doc.font(fonts.mono).fontSize(9).fillColor(emphasize ? theme.negative : theme.body)
      .text(numericParts.join('   '), innerX, cursorY, {
        width: blockWidth - cardPadding * 2,
        lineGap: 2,
      });
    cursorY += numericHeight + 4;

    doc.font(fonts.regular).fontSize(9).fillColor(theme.body)
      .text(`Observação: ${observation}`, innerX, cursorY, {
        width: blockWidth - cardPadding * 2,
        lineGap: 1.45,
      });

    doc.y = cardTop + cardHeight + 10;
  });

  doc.font(fonts.semiBold).fontSize(10).fillColor(theme.primary)
    .text(`Soma total das inconsistências: R$ ${formatNumberBr(totals.inconsistentTotal)}`, layout.left, doc.y, {
      width: layout.width,
      align: 'right',
    });

  doc.moveDown(0.9);
}

function drawIssuesSection(doc, context) {
  const { report, layout, fonts } = context;
  if (!report.issues.length) return;

  ensureSpace(doc, 140);
  doc.moveDown(0.6);
  doc.font(fonts.semiBold).fontSize(11).fillColor(theme.warning)
    .text('Itens ignorados ou incompletos', layout.left, doc.y);
  doc.moveDown(0.2);

  report.issues.forEach((issue, index) => {
    const padding = 10;
    const contentWidth = layout.width - padding * 2;

    doc.font(fonts.semiBold).fontSize(10);
    const titleHeight = doc.heightOfString(`${index + 1}. ${formatTypeLabel(issue.type)}`, {
      width: contentWidth,
    });

    doc.font(fonts.regular).fontSize(9.5);
    const messageHeight = doc.heightOfString(issue.message ?? '-', {
      width: contentWidth,
    });

    const metadata = [
      issue.invoice?.numero
        ? `NF-e nº ${issue.invoice.numero}`
        : issue.invoice?.chave
          ? `NF-e: ${issue.invoice.chave}`
          : null,
      issue.invoice?.emissao ? `Emissão: ${formatDateBr(issue.invoice.emissao)}` : null,
      issue.cfop ? `CFOP: ${issue.cfop}` : null,
      issue.qty ? `Quantidade: ${issue.qty}` : null,
      issue.unitPrice ? `Valor unitário: ${issue.unitPrice}` : null,
    ].filter(Boolean);

    doc.font(fonts.regular).fontSize(9);
    const metadataHeight = metadata.length
      ? doc.heightOfString(metadata.join(' | '), { width: contentWidth })
      : 0;

    const blockHeight = padding * 2 + titleHeight + 6 + messageHeight + (metadataHeight ? metadataHeight + 6 : 0);

    ensureSpace(doc, blockHeight + 12);
    const blockTop = doc.y;

    doc.save();
    doc.lineWidth(0.8).strokeColor('#FFE0B2')
      .rect(layout.left, blockTop, layout.width, blockHeight)
      .stroke();
    doc.restore();

    let cursorY = blockTop + padding;
    doc.font(fonts.semiBold).fontSize(10).fillColor(theme.body)
      .text(`${index + 1}. ${formatTypeLabel(issue.type)}`, layout.left + padding, cursorY, {
        width: contentWidth,
      });
    cursorY += titleHeight + 6;

    doc.font(fonts.regular).fontSize(9.5).fillColor(theme.subtle)
      .text(issue.message ?? '-', layout.left + padding, cursorY, {
        width: contentWidth,
      });
    cursorY += messageHeight + 6;

    if (metadata.length) {
      doc.font(fonts.regular).fontSize(9).fillColor(theme.body)
        .text(metadata.join(' | '), layout.left + padding, cursorY, {
          width: contentWidth,
        });
    }

    doc.y = blockTop + blockHeight + 4;
  });
}

function drawProductDetailSection(doc, context) {
  const { report, layout, fonts, mode, anchors = [], outline = null } = context;
  if (!report.groups.length) return;

  doc.moveDown(0.8);
  doc.font(fonts.semiBold).fontSize(12).fillColor(theme.primary)
    .text('Detalhamento por produto', layout.left, doc.y);
  doc.moveDown(0.5);

  report.groups.forEach((group, index) => {
    if (index > 0) {
      doc.moveDown(0.9);
    }

    const productLabel = group.product.productName
      ?? group.product.productDescription
      ?? group.product.productCode
      ?? 'Produto não identificado';

    const productTitle = String(productLabel).toUpperCase();
    const metaLine = `Código: ${group.product.productCode ?? '--'} | SKU: ${group.product.productSku ?? '--'} | Unidade: ${group.product.unit ?? '--'} | Valor unitário ref.: R$ ${formatNumberBr(group.unitPrice)}`;

    const closingQty = Number(group.closingQty ?? 0);
    const statusNegative = Number.isFinite(closingQty) && closingQty < 0;
    const statusText = statusNegative
      ? 'Situação: ⚠️ Saldo negativo — divergência de retorno (necessário ajuste contábil)'
      : 'Situação: ✅ Saldo conciliado';
    const statusColor = statusNegative ? theme.negative : theme.positive;

    const totals = {
      remessas: group.remessas.reduce((acc, entry) => acc + Number(entry.totalValue ?? 0), 0),
      retornos: group.retornos.reduce((acc, entry) => acc + Number(entry.totalValue ?? 0), 0),
    };
    const diff = totals.remessas - totals.retornos;

    const headerPaddingY = 16;
    const headerPaddingX = 12;
    const headerWidth = layout.width - headerPaddingX * 2;

    doc.save();
    doc.font(fonts.semiBold).fontSize(12);
    const titleHeight = doc.heightOfString(productTitle, { width: headerWidth, lineGap: 2, lineBreak: false });
    doc.font(fonts.regular).fontSize(9.5);
    const metaHeight = doc.heightOfString(metaLine, { width: headerWidth, lineGap: 2, lineBreak: false });
    doc.font(fonts.semiBold).fontSize(10);
    const statusHeight = doc.heightOfString(statusText, { width: headerWidth, lineGap: 2, lineBreak: false });
    const summaryHeight = 5 * 13.5;
    doc.restore();

    const headerHeight = headerPaddingY * 2 + titleHeight + metaHeight + statusHeight + summaryHeight + 18;

    const destinationId = anchors[index];
    if (destinationId) {
      doc.addNamedDestination(destinationId);
      if (outline && typeof outline.addItem === 'function') {
        outline.addItem(productTitle, { destination: destinationId });
      }
    }

    const blockTop = doc.y;
    const backgroundColor = index % 2 === 0 ? '#FFFFFF' : theme.neutralBackground;
    ensureSpace(doc, headerHeight + 80);

    const drawTop = doc.y;
    if (drawTop !== blockTop) {
      doc.moveDown(0.4);
    }

    doc.save();
    doc.fillColor(backgroundColor)
      .rect(layout.left, doc.y - 6, layout.width, headerHeight + 12)
      .fill();
    doc.restore();

    let cursorY = doc.y + headerPaddingY;
    const contentX = layout.left + headerPaddingX;

    if (report.groups.length) {
      const backLabel = '⤴ Voltar ao índice';
      const linkFontSize = 8.5;
      const linkY = drawTop + headerPaddingY;
      let linkWidth;
      let linkHeight;
      let linkX;
      doc.save();
      doc.font(fonts.regular).fontSize(linkFontSize).fillColor(theme.primary);
      linkWidth = doc.widthOfString(backLabel);
      linkHeight = doc.currentLineHeight() || 10;
      linkX = layout.left + layout.width - headerPaddingX - linkWidth;
      doc.text(backLabel, linkX, linkY, {
        lineBreak: false,
      });
      doc.restore();
      doc.link(linkX, linkY, linkWidth, linkHeight, { destination: 'indice-produtos' });
    }

    doc.font(fonts.semiBold).fontSize(12).fillColor(theme.primary)
      .text(productTitle, contentX, cursorY, {
        width: headerWidth,
        lineGap: 2,
      });
    cursorY = doc.y + 2;

    doc.font(fonts.regular).fontSize(9.5).fillColor(theme.subtle)
      .text(metaLine, contentX, cursorY, {
        width: headerWidth,
        lineGap: 2,
        lineBreak: false,
      });
    cursorY = doc.y + 4;

    doc.font(fonts.semiBold).fontSize(10).fillColor(statusColor)
      .text(statusText, contentX, cursorY, {
        width: headerWidth,
        lineGap: 2,
        lineBreak: false,
      });
    cursorY = doc.y + 6;

    const summaryItems = [
      {
        label: 'Saldo inicial',
        value: `${formatNumberBr(group.openingQty, 4)} | R$ ${formatNumberBr(group.openingValue)}`,
        color: theme.body,
      },
      {
        label: 'Saldo contábil final',
        value: `${formatNumberBr(group.closingQty, 4)} | R$ ${formatNumberBr(group.closingValue)}`,
        color: closingQty < 0 ? theme.negative : theme.body,
        warning: closingQty < 0,
      },
      {
        label: 'Total remessas',
        value: `R$ ${formatNumberBr(totals.remessas)}`,
        color: theme.body,
      },
      {
        label: 'Total retornos',
        value: `R$ ${formatNumberBr(totals.retornos)}`,
        color: theme.body,
      },
      {
        label: 'Diferença',
        value: `R$ ${formatNumberBr(diff)}`,
        color: diff < 0 ? theme.negative : theme.body,
        warning: diff < 0,
      },
    ];

    summaryItems.forEach((item, itemIndex) => {
      const lineTop = itemIndex === 0 ? cursorY : doc.y + 2;
      const prefix = item.warning ? '⚠️ ' : '';
      doc.font(fonts.regular).fontSize(9.5).fillColor(theme.body)
        .text(`${prefix}${item.label}: `, contentX, lineTop, {
          continued: true,
        });
      doc.font(fonts.semiBold).fontSize(9.5).fillColor(item.color)
        .text(item.value, {
          continued: false,
          lineBreak: false,
        });
    });

    doc.y = drawTop + headerHeight;
    doc.moveDown(0.2);

    const detailEntries = [
      ...group.remessas.map((entry) => ({
        ...entry,
        rowType: 'Remessa',
        invoiceDisplay: resolveInvoiceIdentifier(entry),
      })),
      ...group.retornos.map((entry) => ({
        ...entry,
        rowType: 'Retorno',
        invoiceDisplay: resolveInvoiceIdentifier(entry),
      })),
    ];

    drawProductMovementsTable(doc, {
      layout,
      fonts,
      entries: detailEntries,
      mode,
    });
  });
}

function drawProductMovementsTable(doc, context) {
  const { layout, fonts, entries, mode } = context;

  if (!entries.length) {
    doc.font(fonts.regular).fontSize(9.5).fillColor(theme.subtle)
      .text('Nenhum registro de movimentação para este produto.');
    return;
  }

  if (mode === 'gerencial') {
    doc.font(fonts.regular).fontSize(9.5).fillColor(theme.subtle)
      .text(`Lançamentos registrados: ${entries.length}`);
    return;
  }

  const tableConfig = {
    columns: [
      { key: 'rowType', label: 'Tipo', widthRatio: 0.1, align: 'left', font: fonts.semiBold, size: 8.5, minFontSize: 7.25 },
      { key: 'invoiceDisplay', label: 'NF-e', widthRatio: 0.09, align: 'left', font: fonts.mono, size: 8.5, characterSpacing: -0.05, minFontSize: 7.25, useEllipsis: true },
      { key: 'invoiceEmissao', label: 'Data', widthRatio: 0.13, align: 'center', formatter: formatDateBr, minFontSize: 7.25 },
      { key: 'natOp', label: 'Natureza', widthRatio: 0.29, align: 'left', allowWrap: true, lineGap: 1.3, minFontSize: 7.25 },
      { key: 'quantity', label: 'Quant.', widthRatio: 0.12, align: 'right', formatter: (value) => formatNumberBr(value, 4), font: fonts.mono, size: 8.5, characterSpacing: -0.02, minFontSize: 6.75 },
      { key: 'unitPrice', label: 'Valor Unit.', widthRatio: 0.13, align: 'right', formatter: (value) => `R$ ${formatNumberBr(value)}`, font: fonts.mono, size: 8.3, characterSpacing: -0.04, minFontSize: 6.75 },
      { key: 'totalValue', label: 'Valor Total', widthRatio: 0.14, align: 'right', formatter: (value) => `R$ ${formatNumberBr(value)}`, font: fonts.mono, size: 8.3, characterSpacing: -0.04, minFontSize: 6.75 },
    ],
    headerHeight: 22,
    rowPadding: 4,
    maxRowsPerPage: 30,
  };

  const tableX = layout.left;
  const tableWidth = layout.width;
  const columnWidths = tableConfig.columns.map((column) => tableWidth * column.widthRatio);
  const columnPositions = tableConfig.columns.map((column, idx) => (
    tableX + tableConfig.columns.slice(0, idx).reduce((acc, current) => acc + current.widthRatio, 0) * tableWidth
  ));

  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  let rowsOnPage = 0;

  const ensureHeaderSpace = () => {
    ensureSpace(doc, tableConfig.headerHeight + 12);
  };

  const drawHeader = () => {
    const headerTop = doc.y;
    const headerCells = tableConfig.columns.map((column, idx) => prepareTableCell(doc, {
      text: column.label,
      fontName: fonts.semiBold,
      fontSize: 9,
      maxWidth: columnWidths[idx],
      align: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
      allowWrap: false,
      color: theme.tableHeaderText,
      useEllipsis: true,
    }));

    const headerHeight = Math.max(tableConfig.headerHeight, Math.max(...headerCells.map((cell) => cell.height)) + 2);

    doc.save();
    doc.fillColor(theme.tableHeaderAltBg)
      .rect(tableX, headerTop, tableWidth, headerHeight)
      .fill();
    doc.strokeColor(theme.softDivider).lineWidth(0.6)
      .moveTo(tableX, headerTop)
      .lineTo(tableX + tableWidth, headerTop)
      .stroke()
      .moveTo(tableX, headerTop + headerHeight)
      .lineTo(tableX + tableWidth, headerTop + headerHeight)
      .stroke();
    doc.restore();

    headerCells.forEach((cell, idx) => {
      drawTableCell(doc, cell, {
        x: columnPositions[idx],
        y: headerTop,
        width: columnWidths[idx],
      });
    });

    doc.y = headerTop + headerHeight;
    doc.strokeColor(theme.tableBorder).lineWidth(0.6)
      .moveTo(tableX, doc.y)
      .lineTo(tableX + tableWidth, doc.y)
      .stroke();

    rowsOnPage = 0;
  };

  ensureHeaderSpace();
  drawHeader();

  entries.forEach((entry) => {
    const rowCells = tableConfig.columns.map((column, idx) => {
      const value = column.formatter ? column.formatter(entry[column.key]) : entry[column.key];
      return prepareTableCell(doc, {
        text: value,
        fontName: column.font || fonts.regular,
        fontSize: column.size || 9,
        characterSpacing: column.characterSpacing ?? 0,
        maxWidth: columnWidths[idx],
        align: column.align,
        allowWrap: column.allowWrap ?? false,
        lineGap: column.lineGap ?? 1.2,
        minFontSize: column.minFontSize ?? 7,
        useEllipsis: column.useEllipsis ?? false,
      });
    });

    const rowHeight = Math.max(...rowCells.map((cell) => cell.height)) + tableConfig.rowPadding;
    const needsPageBreak = rowsOnPage >= tableConfig.maxRowsPerPage
      || doc.y + rowHeight > bottomLimit;

    if (needsPageBreak) {
      doc.addPage();
      ensureHeaderSpace();
      drawHeader();
    }

    const rowTop = doc.y;
    rowCells.forEach((cell, idx) => {
      drawTableCell(doc, cell, {
        x: columnPositions[idx],
        y: rowTop,
        width: columnWidths[idx],
      });
    });

    const rowBottom = rowTop + rowHeight;
    doc.strokeColor(theme.tableDivider).lineWidth(0.4)
      .moveTo(tableX, rowBottom)
      .lineTo(tableX + tableWidth, rowBottom)
      .stroke();

    doc.y = rowBottom;
    rowsOnPage += 1;
  });

  doc.y += 8;
}

function generateWarehouseReportPdf({
  res,
  company,
  report,
  filters,
  mode,
  totals,
  assets = {},
}) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
  });

  doc.pipe(res);

  const layout = {
    left: doc.page.margins.left,
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  };

  const fonts = registerFonts(doc);
  const periodText = filters.from || filters.to
    ? `${filters.from ? formatDateBr(filters.from) : 'Início'} a ${filters.to ? formatDateBr(filters.to) : 'Hoje'}`
    : 'Período não informado';

  const headerContext = {
    layout,
    fonts,
    assets,
    header: {
      companyName: company.name,
      cnpj: company.cnpj || '--',
      period: periodText,
      generatedAt: formatDateTimeBr(report.generatedAt),
      responsible: 'Sistema FluiTax',
      metricsLine: `Operações processadas: ${totals.totalInvoices} | Conciliação: ${formatNumberBr(totals.conciliationPercent, 2)}%`,
    },
  };

  const decoratePage = () => {
    drawPageHeader(doc, headerContext);
  };

  decoratePage();
  doc.on('pageAdded', () => {
    decoratePage();
  });

  drawSummarySection(doc, { report, totals, layout, fonts });
  const productAnchors = report.groups.map((_, idx) => `produto-${idx + 1}`);
  const outlineRoot = doc.outline || null;
  let productsOutline = null;
  if (outlineRoot && report.groups.length) {
    productsOutline = outlineRoot.addItem('Produtos', { destination: 'indice-produtos' });
  }

  drawProductIndex(doc, { report, layout, fonts, anchors: productAnchors });
  drawProductDetailSection(doc, { report, layout, fonts, mode, anchors: productAnchors, outline: productsOutline });
  drawInconsistenciesSection(doc, { report, layout, fonts, totals });
  drawIssuesSection(doc, { report, layout, fonts });

  const pageRange = doc.bufferedPageRange();
  const totalPages = pageRange.count;
  const currentYear = new Date().getFullYear();

  for (let idx = 0; idx < totalPages; idx += 1) {
    doc.switchToPage(pageRange.start + idx);
    doc.font(fonts.regular).fontSize(9).fillColor(theme.footer)
      .text(
        `Sistema FluiTax © ${currentYear} | Página ${idx + 1} de ${totalPages}`,
        layout.left,
        doc.page.height - doc.page.margins.bottom - 12,
        {
          width: layout.width,
          align: 'center',
          lineBreak: false,
        },
      );
  }

  doc.end();
}

module.exports = {
  generateWarehouseReportPdf,
  formatNumberBr,
  formatDateBr,
  formatDateTimeBr,
};
