const { XMLParser } = require('fast-xml-parser');

class InvoiceParseError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = 'InvoiceParseError';
    this.code = code;
    this.details = options.details;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
  cdataPropName: '#text',
});

const NFSE_REASON = 'NFS-e';

const CANCELLATION_PROTOCOL_CODES = new Set(['101', '151', '155']);
const CANCELLATION_EVENT_TYPES = new Set(['110111', '110115']);
const CANCELLATION_EVENT_STATUS_CODES = new Set(['101', '135', '136', '151', '155']);
const CTE_NAMESPACE = 'http://www.portalfiscal.inf.br/cte';

function toArray(input) {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function parseXmlContent(xmlContent) {
  let parsed;
  try {
    parsed = parser.parse(xmlContent);
  } catch (error) {
    throw new InvoiceParseError('XML malformado', 'XML_MALFORMED', { details: { error } });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new InvoiceParseError('XML malformado', 'XML_MALFORMED');
  }

  return parsed;
}

function unwrapXMLValue(value) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return null;
    return unwrapXMLValue(value[0]);
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '#text')) {
      return unwrapXMLValue(value['#text']);
    }
    if (Object.prototype.hasOwnProperty.call(value, '__cdata')) {
      return unwrapXMLValue(value.__cdata);
    }
    if (Object.prototype.hasOwnProperty.call(value, '$text')) {
      return unwrapXMLValue(value.$text);
    }
  }
  return value;
}

function normalizeTaxId(value) {
  const digits = String(unwrapXMLValue(value) ?? '').replace(/\D/g, '');
  if (!digits.length) return null;
  if (digits.length === 11 || digits.length === 14) {
    return digits;
  }
  return null;
}

function isNFSeDocument(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const rootKeys = Object.keys(doc).filter((key) => key !== '?xml');
  if (!rootKeys.length) return false;

  const rootKey = rootKeys[0];
  const normalizedKey = rootKey.toLowerCase();
  if (normalizedKey.includes('nfse') && !normalizedKey.includes('nfe')) {
    return true;
  }

  const rootNode = doc[rootKey];
  if (!rootNode || typeof rootNode !== 'object') return false;

  return Boolean(
    rootNode.CompNfse
      || rootNode.infNfse
      || rootNode.InfNfse
      || rootNode.nfseProc
      || rootNode.compNfse
  );
}

function isCTeDocument(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const rootKeys = Object.keys(doc).filter((key) => key !== '?xml');
  if (!rootKeys.length) return false;
  const rootKey = rootKeys[0];
  return rootKey.toLowerCase().includes('cte');
}

function findInfNFe(doc) {
  if (doc?.nfeProc?.NFe?.infNFe) return { infNFe: doc.nfeProc.NFe.infNFe, root: doc.nfeProc };
  if (doc?.nfeProc?.nfeProc?.NFe?.infNFe) {
    return { infNFe: doc.nfeProc.nfeProc.NFe.infNFe, root: doc.nfeProc };
  }
  if (doc?.NFe?.infNFe) return { infNFe: doc.NFe.infNFe, root: doc };
  return null;
}

function findInfCte(doc) {
  const root = doc?.cteProc || doc?.CTe || doc?.cte;
  if (root?.CTe?.infCte) return { infCte: root.CTe.infCte, root: root.CTe };
  if (root?.infCte) return { infCte: root.infCte, root };
  return null;
}

function extractNFeProtocol(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.protNFe?.infProt) return doc.protNFe.infProt;
  if (doc.nfeProc?.protNFe?.infProt) return doc.nfeProc.protNFe.infProt;
  return null;
}

function extractCancellationEvent(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const candidates = [];

  function normalizeCancellationCandidate(candidate) {
    if (!candidate) return null;
    const infEvento = candidate.infEvento && typeof candidate.infEvento === 'object'
      ? candidate.infEvento
      : null;
    const retInfEvento = candidate.retInfEvento && typeof candidate.retInfEvento === 'object'
      ? candidate.retInfEvento
      : null;

    if (!infEvento && !retInfEvento) {
      return null;
    }

    const detEvento = infEvento?.detEvento && typeof infEvento.detEvento === 'object'
      ? infEvento.detEvento
      : null;

    const eventTypeRaw = unwrapXMLValue(infEvento?.tpEvento ?? retInfEvento?.tpEvento);
    const eventType = eventTypeRaw ? String(eventTypeRaw).trim() : null;
    const descEventoRaw = unwrapXMLValue(detEvento?.descEvento)
      || unwrapXMLValue(infEvento?.xEvento)
      || unwrapXMLValue(retInfEvento?.xEvento);
    const descEvento = descEventoRaw ? String(descEventoRaw).trim() : null;
    const normalizedDesc = descEvento ? descEvento.toLowerCase() : '';

    const statusCodeRaw = unwrapXMLValue(retInfEvento?.cStat ?? infEvento?.cStat);
    const statusCode = statusCodeRaw ? String(statusCodeRaw).trim() : null;
    const statusMessageRaw = unwrapXMLValue(retInfEvento?.xMotivo ?? infEvento?.xMotivo);
    const statusMessage = statusMessageRaw ? String(statusMessageRaw).trim() : null;

    const chaveRaw = unwrapXMLValue(
      infEvento?.chNFe
        ?? retInfEvento?.chNFe
        ?? infEvento?.chCTe
        ?? retInfEvento?.chCTe
        ?? candidate.fallbackChave,
    );
    const chave = chaveRaw ? String(chaveRaw).trim() : null;

    const seqRaw = unwrapXMLValue(infEvento?.nSeqEvento ?? retInfEvento?.nSeqEvento);
    const eventSequence = seqRaw != null && seqRaw !== ''
      ? Number.parseInt(String(seqRaw), 10)
      : null;

    const protocolRaw = unwrapXMLValue(retInfEvento?.nProt ?? detEvento?.nProt);
    const protocolNumber = protocolRaw ? String(protocolRaw).trim() : null;

    const justificationRaw = unwrapXMLValue(detEvento?.xJust);
    const justification = justificationRaw ? String(justificationRaw).trim() : null;

    const eventTimestamp = parseDateTime(infEvento?.dhEvento);
    const receivedAt = parseDateTime(retInfEvento?.dhRegEvento);

    const typeMatches = Boolean(eventType && CANCELLATION_EVENT_TYPES.has(eventType));
    const descMatches = normalizedDesc.includes('cancel');
    const isCancellation = typeMatches || descMatches;
    if (!isCancellation || !chave) {
      return null;
    }

    const statusMatches = statusCode ? CANCELLATION_EVENT_STATUS_CODES.has(statusCode) : false;
    const isApproved = statusMatches || (descMatches && !statusCode);

    return {
      chave,
      eventType: eventType || null,
      eventSequence: Number.isFinite(eventSequence) ? eventSequence : null,
      statusCode: statusCode || null,
      statusMessage,
      protocolNumber,
      eventTimestamp,
      receivedAt,
      justification,
      isApproved,
    };
  }

  const registerCandidate = (payload) => {
    if (!payload) return;
    const normalized = normalizeCancellationCandidate(payload);
    if (!normalized) return;
    if (!normalized.chave) return;
    candidates.push(normalized);
  };

  const enqueueProcEvento = (node) => {
    if (!node || typeof node !== 'object') return;
    const eventoNodes = toArray(node.evento);
    const retNodes = toArray(node.retEvento);
    if (eventoNodes.length === 0 && retNodes.length === 0) {
      registerCandidate({ infEvento: node.infEvento, retInfEvento: node.retInfEvento });
      return;
    }

    eventoNodes.forEach((evento, index) => {
      registerCandidate({
        infEvento: evento?.infEvento || evento,
        retInfEvento: retNodes[index]?.infEvento || retNodes[index],
      });
    });

    if (!eventoNodes.length) {
      retNodes.forEach((ret) => {
        registerCandidate({ infEvento: ret?.evento?.infEvento, retInfEvento: ret?.infEvento || ret });
      });
    }
  };

  [...toArray(doc?.procEventoNFe), ...toArray(doc?.proceventoNFe)].forEach(enqueueProcEvento);
  [...toArray(doc?.nfeProc?.procEventoNFe)].forEach(enqueueProcEvento);

  toArray(doc?.evento).forEach((evento) => {
    registerCandidate({
      infEvento: evento?.infEvento || evento,
      retInfEvento: doc?.retEvento?.infEvento || doc?.retEvento,
    });
  });

  toArray(doc?.retEvento).forEach((ret) => {
    registerCandidate({
      infEvento: ret?.evento?.infEvento,
      retInfEvento: ret?.infEvento || ret,
    });
  });

  let selected = null;
  for (const candidate of candidates) {
    if (!selected) {
      selected = candidate;
    }
    if (candidate.isApproved) {
      selected = candidate;
      break;
    }
  }

  return selected;
}

function normalizeDecimal(value, { allowNull = false, defaultValue = '0' } = {}) {
  const raw = unwrapXMLValue(value);
  if (raw == null || raw === '') {
    if (allowNull) return null;
    return defaultValue;
  }
  const normalized = String(raw).replace(',', '.').trim();
  if (normalized.length === 0) {
    if (allowNull) return null;
    return defaultValue;
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) {
    throw new InvoiceParseError('valor decimal inválido', 'LAYOUT_UNSUPPORTED', { details: { value } });
  }
  return normalized;
}

function parseDate(value, { required = true } = {}) {
  const raw = unwrapXMLValue(value);
  if (!raw) {
    if (!required) {
      return null;
    }
    throw new InvoiceParseError('data ausente', 'LAYOUT_UNSUPPORTED', { details: { value } });
  }

  if (/^\d{8}$/.test(raw)) {
    const yyyy = raw.slice(0, 4);
    const mm = raw.slice(4, 6);
    const dd = raw.slice(6, 8);
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00Z`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvoiceParseError('data inválida', 'LAYOUT_UNSUPPORTED', { details: { value: raw } });
  }
  return parsed;
}

function parseDateTime(value) {
  const raw = unwrapXMLValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function extractICMSData(icmsNode) {
  if (!icmsNode || typeof icmsNode !== 'object') return {};
  const variants = Object.values(icmsNode).filter((v) => v && typeof v === 'object');
  const data = variants[0] || {};
  const vICMS = unwrapXMLValue(data.vICMS);
  const vICMSST = unwrapXMLValue(data.vICMSST);
  const vST = unwrapXMLValue(data.vST) || vICMSST || null;

  return {
    cst: unwrapXMLValue(data.CST) || null,
    csosn: unwrapXMLValue(data.CSOSN) || null,
    vBC: unwrapXMLValue(data.vBC),
    vICMS,
    vICMSDeson: unwrapXMLValue(data.vICMSDeson),
    vBCST: unwrapXMLValue(data.vBCST),
    vST,
  };
}

function extractIPIValue(ipiNode) {
  if (!ipiNode || typeof ipiNode !== 'object') return null;
  if (ipiNode.IPITrib && typeof ipiNode.IPITrib === 'object') {
    return unwrapXMLValue(ipiNode.IPITrib.vIPI) || null;
  }
  if (ipiNode.IPINT && typeof ipiNode.IPINT === 'object') {
    return unwrapXMLValue(ipiNode.IPINT.vIPI) || null;
  }
  return null;
}

function extractSimpleTaxValue(node, key) {
  if (!node || typeof node !== 'object') return null;
  const variants = Object.values(node).filter((v) => v && typeof v === 'object');
  const candidate = variants[0] || {};
  return unwrapXMLValue(candidate[key]) || null;
}

function ensureArray(input) {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function parseItems(detArray) {
  return detArray.map((det, index) => {
    const prod = det?.prod || {};
    const imposto = det?.imposto || {};

    const cfopCode = unwrapXMLValue(prod.CFOP);
    if (!cfopCode) {
      throw new InvoiceParseError(`item ${index + 1}: CFOP ausente`, 'LAYOUT_UNSUPPORTED');
    }

    const qty = normalizeDecimal(prod.qCom, { allowNull: false });
    const unitPrice = normalizeDecimal(prod.vUnCom, { allowNull: false });
    const gross = normalizeDecimal(prod.vProd, { allowNull: false });
    const discount = normalizeDecimal(prod.vDesc, { allowNull: true, defaultValue: '0' }) || '0';

    const productCode = unwrapXMLValue(prod.cProd) || null;
    const description = unwrapXMLValue(prod.xProd) || null;
    const unit = unwrapXMLValue(prod.uCom) || null;

    const icmsData = extractICMSData(imposto.ICMS);
    const icmsValue = normalizeDecimal(icmsData.vICMS, { allowNull: true });
    const vBC = normalizeDecimal(icmsData.vBC, { allowNull: true });
    const vICMSDeson = normalizeDecimal(icmsData.vICMSDeson, { allowNull: true });
    const vBCST = normalizeDecimal(icmsData.vBCST, { allowNull: true });
    const vST = normalizeDecimal(icmsData.vST, { allowNull: true });
    const ipiValue = normalizeDecimal(extractIPIValue(imposto.IPI), { allowNull: true });
    const pisValue = normalizeDecimal(extractSimpleTaxValue(imposto.PIS, 'vPIS'), { allowNull: true });
    const cofinsValue = normalizeDecimal(extractSimpleTaxValue(imposto.COFINS, 'vCOFINS'), { allowNull: true });
    const vTotTrib = normalizeDecimal(unwrapXMLValue(imposto.vTotTrib), { allowNull: true });

    return {
      cfopCode: String(cfopCode).trim(),
      ncm: unwrapXMLValue(prod.NCM) || null,
      cst: icmsData.cst,
      csosn: icmsData.csosn,
      productCode,
      description,
      unit,
      qty,
      unitPrice,
      gross,
      discount,
      icmsValue,
      ipiValue,
      pisValue,
      cofinsValue,
      vBC,
      vICMSDeson,
      vBCST,
      vST,
      vTotTrib,
    };
  });
}

function extractChave(rootDoc, infNFe) {
  const protocolChave = unwrapXMLValue(extractNFeProtocol(rootDoc)?.chNFe);
  if (protocolChave) {
    return String(protocolChave).trim();
  }

  const idAttr = unwrapXMLValue(infNFe['@_Id']);
  if (idAttr) {
    return String(idAttr).replace(/^NFe/i, '').trim();
  }

  return null;
}

function parseInvoiceFromDocument(parsed) {
  const infNFeData = findInfNFe(parsed);
  if (!infNFeData) {
    throw new InvoiceParseError('faltando infNFe/Id', 'MISSING_INF_NFE');
  }

  try {
    const { infNFe, root } = infNFeData;
    const chave = extractChave(root, infNFe);
    if (!chave) {
      throw new InvoiceParseError('faltando infNFe/Id', 'MISSING_INF_NFE');
    }

    const ide = infNFe.ide || {};
    const emissao = parseDate(ide.dhEmi ?? ide.dEmi, { required: true });
    const entradaSaida = parseDate(ide.dhSaiEnt ?? ide.dSaiEnt ?? null, { required: false });
    const rawTpNF = unwrapXMLValue(ide.tpNF);
    const tpNF = rawTpNF == null ? null : String(rawTpNF).trim();
    if (tpNF && !['0', '1'].includes(tpNF)) {
      throw new InvoiceParseError('tpNF inválido', 'LAYOUT_UNSUPPORTED', { details: { value: rawTpNF } });
    }

    const natOpValue = unwrapXMLValue(ide.natOp);
    if (!natOpValue) {
      throw new InvoiceParseError('natureza da operação ausente', 'LAYOUT_UNSUPPORTED');
    }

    const serieRaw = unwrapXMLValue(ide.serie);
    const serie = serieRaw != null && serieRaw !== '' ? String(serieRaw).trim() : null;

    const invoiceNumberRaw = unwrapXMLValue(ide.nNF);
    const invoiceNumber = invoiceNumberRaw != null && invoiceNumberRaw !== ''
      ? String(invoiceNumberRaw).trim()
      : null;

    const issuerCnpj = normalizeTaxId(infNFe.emit?.CNPJ ?? infNFe.emit?.CPF);
    if (!issuerCnpj) {
      throw new InvoiceParseError('emitente inválido', 'LAYOUT_UNSUPPORTED');
    }

    const recipientNode = infNFe.dest || {};
    const recipientCnpj = normalizeTaxId(recipientNode.CNPJ ?? recipientNode.CPF);
    if (!recipientCnpj) {
      throw new InvoiceParseError('destinatário inválido', 'LAYOUT_UNSUPPORTED');
    }
    const recipientName = unwrapXMLValue(recipientNode.xNome) || null;
    const recipientCity = unwrapXMLValue(recipientNode.xMun) || null;
    const recipientState = unwrapXMLValue(recipientNode.UF) || null;

    const totalNFe = normalizeDecimal(infNFe.total?.ICMSTot?.vNF, { allowNull: false });

    const detArray = ensureArray(infNFe.det);
    if (!detArray.length) {
      throw new InvoiceParseError('NF-e sem itens', 'LAYOUT_UNSUPPORTED');
    }
    const items = parseItems(detArray);

    const protocolNode = extractNFeProtocol(root);
    const protocolStatusCodeRaw = unwrapXMLValue(protocolNode?.cStat);
    const protocolStatusCode = protocolStatusCodeRaw ? String(protocolStatusCodeRaw).trim() : null;
    const protocolStatusMessageRaw = unwrapXMLValue(protocolNode?.xMotivo);
    const protocolStatusMessage = protocolStatusMessageRaw ? String(protocolStatusMessageRaw).trim() : null;
    const protocolNumberRaw = unwrapXMLValue(protocolNode?.nProt);
    const protocolNumber = protocolNumberRaw ? String(protocolNumberRaw).trim() : null;
    const protocolReceivedAt = parseDateTime(protocolNode?.dhRecbto);

    const protocol = {
      statusCode: protocolStatusCode,
      statusMessage: protocolStatusMessage,
      protocolNumber,
      receivedAt: protocolReceivedAt,
    };

    const isCancelled = Boolean(protocolStatusCode && CANCELLATION_PROTOCOL_CODES.has(protocolStatusCode));

    const hasBlockedCfop = items.some((item) => item.cfopCode === '5949');
    const isBlockedSerie = serie === '891';
    const ignored = Boolean(hasBlockedCfop && isBlockedSerie);
    const ignoreReason = ignored ? 'nota ignorada: CFOP 5949 e série 891' : null;

    return {
      chave,
      emissao,
      entradaSaida,
      tpNF,
      natOp: String(natOpValue),
      issuerCnpj,
      recipientCnpj,
      recipientName,
      recipientCity,
      recipientState,
      totalNFe,
      items,
      protocol,
      isCancelled,
      numero: invoiceNumber,
      serie,
      ignored,
      ignoreReason,
    };
  } catch (error) {
    if (error instanceof InvoiceParseError) {
      throw error;
    }
    throw new InvoiceParseError(error.message || 'layout não suportado', 'LAYOUT_UNSUPPORTED');
  }
}

function parseCteFromDocument(parsed) {
  const infCteData = findInfCte(parsed);
  if (!infCteData) {
    throw new InvoiceParseError('faltando infCte/Id', 'MISSING_INF_CTE');
  }

  try {
    const { infCte, root } = infCteData;
    const chave = extractChave(root, infCte);
    if (!chave) {
      throw new InvoiceParseError('faltando infCte/Id', 'MISSING_INF_CTE');
    }

    const ide = infCte.ide || {};
    const emissao = parseDate(ide.dhEmi ?? ide.dEmi, { required: true });
    const serieRaw = unwrapXMLValue(ide.serie);
    const serie = serieRaw != null && serieRaw !== '' ? String(serieRaw).trim() : null;
    const numeroRaw = unwrapXMLValue(ide.nCT);
    const numero = numeroRaw != null && numeroRaw !== '' ? String(numeroRaw).trim() : null;
    const cfop = unwrapXMLValue(ide.CFOP) ? String(unwrapXMLValue(ide.CFOP)).trim() : null;
    const natOpValue = unwrapXMLValue(ide.natOp);
    if (!natOpValue) {
      throw new InvoiceParseError('natureza da operação ausente', 'LAYOUT_UNSUPPORTED');
    }

    const emit = infCte.emit || {};
    const emitCnpj = normalizeTaxId(emit.CNPJ ?? emit.CPF);
    const emitNome = unwrapXMLValue(emit.xNome) || null;
    const emitUf = unwrapXMLValue(emit?.enderEmit?.UF) || null;
    const emitMun = unwrapXMLValue(emit?.enderEmit?.xMun) || null;

    const dest = infCte.dest || {};
    const destCnpj = normalizeTaxId(dest.CNPJ ?? dest.CPF);
    const destNome = unwrapXMLValue(dest.xNome) || null;
    const destUf = unwrapXMLValue(dest?.enderDest?.UF) || null;
    const destMun = unwrapXMLValue(dest?.enderDest?.xMun) || null;

    const vPrestNode = infCte.vPrest || {};
    const valorPrestacao = normalizeDecimal(vPrestNode.vTPrest, { allowNull: false });
    const valorReceber = normalizeDecimal(vPrestNode.vRec, { allowNull: true });

    const infCarga = infCte?.infCTeNorm?.infCarga || {};
    const infQ = infCarga.infQ || {};
    const pesoBruto = normalizeDecimal(infQ.qCarga, { allowNull: true });
    const unidadePeso = unwrapXMLValue(infQ.tpMed) || null;

    const protocolNode = extractNFeProtocol(root) || (parsed?.protCTe?.infProt ?? parsed?.cteProc?.protCTe?.infProt);
    const protocolStatusCodeRaw = unwrapXMLValue(protocolNode?.cStat);
    const protocolStatusCode = protocolStatusCodeRaw ? String(protocolStatusCodeRaw).trim() : null;
    const protocolStatusMessageRaw = unwrapXMLValue(protocolNode?.xMotivo);
    const protocolStatusMessage = protocolStatusMessageRaw ? String(protocolStatusMessageRaw).trim() : null;
    const protocolNumberRaw = unwrapXMLValue(protocolNode?.nProt);
    const protocolNumber = protocolNumberRaw ? String(protocolNumberRaw).trim() : null;
    const protocolReceivedAt = parseDateTime(protocolNode?.dhRecbto);

    const protocol = {
      statusCode: protocolStatusCode,
      statusMessage: protocolStatusMessage,
      protocolNumber,
      receivedAt: protocolReceivedAt,
    };

    const cancelledCodes = new Set(['101', '135', '136', '155']);
    const isCancelled = Boolean(protocolStatusCode && cancelledCodes.has(protocolStatusCode));

    return {
      chave,
      emissao,
      cfop,
      natOp: String(natOpValue),
      modelo: unwrapXMLValue(ide.mod) ? String(unwrapXMLValue(ide.mod)).trim() : null,
      serie,
      numero,
      emitCnpj,
      emitNome,
      emitUf,
      emitMun,
      destCnpj,
      destNome,
      destUf,
      destMun,
      valorPrestacao,
      valorReceber,
      pesoBruto,
      unidadePeso,
      protocolo: protocolNumber,
      protocoloMsg: protocolStatusMessage,
      protocoloStatus: protocolStatusCode,
      isCancelled,
    };
  } catch (error) {
    if (error instanceof InvoiceParseError) {
      throw error;
    }
    throw new InvoiceParseError(error.message || 'layout CTe não suportado', 'LAYOUT_UNSUPPORTED');
  }
}

function parseInvoiceXml(xmlContent) {
  const parsed = parseXmlContent(xmlContent);

  if (isNFSeDocument(parsed)) {
    return { ignored: true, reason: NFSE_REASON };
  }

  const invoice = parseInvoiceFromDocument(parsed);
  return {
    ignored: invoice.ignored ?? false,
    ignoreReason: invoice.ignoreReason ?? null,
    ...invoice,
  };
}

function parseUploadXml(xmlContent) {
  const parsed = parseXmlContent(xmlContent);

  if (isNFSeDocument(parsed)) {
    return { kind: 'NFSE', data: { reason: NFSE_REASON } };
  }

  const cancellation = extractCancellationEvent(parsed);
  if (cancellation) {
    return { kind: 'CANCELLATION', data: cancellation };
  }

  if (isCTeDocument(parsed)) {
    const cte = parseCteFromDocument(parsed);
    return { kind: 'CTE', data: cte };
  }

  const invoice = parseInvoiceFromDocument(parsed);
  return {
    kind: 'INVOICE',
    data: {
      ignored: invoice.ignored ?? false,
      ignoreReason: invoice.ignoreReason ?? null,
      ...invoice,
    },
  };
}

module.exports = {
  parseInvoiceXml,
  parseUploadXml,
  InvoiceParseError,
};
