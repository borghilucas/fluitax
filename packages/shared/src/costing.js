/**
 * Conversion constants and helpers shared between API and Web.
 * Values are expressed in the native business units (SC, KG, fardos).
 */
const RAW_SC_TO_TORRADO_KG = 48;
const FARDO_KG = 5;
const RAW_SC_TO_FARDOS = RAW_SC_TO_TORRADO_KG / FARDO_KG; // 9.6

/**
 * Converts a quantity in fardos to the equivalent quantity of raw coffee sacas.
 * @param {number} fardos
 * @returns {number}
 */
function toScEquivalentFromFardos(fardos) {
  const qty = Number.isFinite(fardos) ? fardos : Number(fardos ?? 0);
  if (!Number.isFinite(qty) || qty === 0) return 0;
  return (qty * FARDO_KG) / RAW_SC_TO_TORRADO_KG;
}

/**
 * Converts kilograms of roasted coffee to equivalent raw coffee sacas.
 * @param {number} kg
 * @returns {number}
 */
function toScEquivalentFromKg(kg) {
  const qty = Number.isFinite(kg) ? kg : Number(kg ?? 0);
  if (!Number.isFinite(qty) || qty === 0) return 0;
  return qty / RAW_SC_TO_TORRADO_KG;
}

/**
 * Converts sacas of raw coffee to the projected number of fardos finished goods.
 * @param {number} sacas
 * @returns {number}
 */
function toFardosFromSc(sacas) {
  const qty = Number.isFinite(sacas) ? sacas : Number(sacas ?? 0);
  if (!Number.isFinite(qty) || qty === 0) return 0;
  return qty * RAW_SC_TO_FARDOS;
}

/**
 * Converts sacas of raw coffee to kilograms of roasted coffee.
 * @param {number} sacas
 * @returns {number}
 */
function toKgFromSc(sacas) {
  const qty = Number.isFinite(sacas) ? sacas : Number(sacas ?? 0);
  if (!Number.isFinite(qty) || qty === 0) return 0;
  return qty * RAW_SC_TO_TORRADO_KG;
}

/**
 * Converts kilograms of roasted coffee to number of fardos (5 kg).
 * @param {number} kg
 * @returns {number}
 */
function toFardosFromKg(kg) {
  const qty = Number.isFinite(kg) ? kg : Number(kg ?? 0);
  if (!Number.isFinite(qty) || qty === 0) return 0;
  return qty / FARDO_KG;
}

/**
 * Calculates the derived cost per fardo given the average cost per saca of raw coffee.
 * @param {number} rawAvgCostPerSc
 * @returns {number}
 */
function deriveCostPerFardo(rawAvgCostPerSc) {
  const cost = Number.isFinite(rawAvgCostPerSc) ? rawAvgCostPerSc : Number(rawAvgCostPerSc ?? 0);
  if (!Number.isFinite(cost) || cost === 0) return 0;
  return (FARDO_KG / RAW_SC_TO_TORRADO_KG) * cost;
}

module.exports = {
  RAW_SC_TO_TORRADO_KG,
  FARDO_KG,
  RAW_SC_TO_FARDOS,
  toScEquivalentFromFardos,
  toScEquivalentFromKg,
  toFardosFromSc,
  toKgFromSc,
  toFardosFromKg,
  deriveCostPerFardo,
};
