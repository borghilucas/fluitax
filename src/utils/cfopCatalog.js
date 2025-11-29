const fs = require('fs');
const path = require('path');

let cachedMap = null;

function loadCatalog() {
  if (cachedMap) {
    return cachedMap;
  }

  const csvPath = path.resolve(__dirname, '..', '..', 'node_modules', 'cfop', 'cfop.csv');
  let contents = '';

  try {
    contents = fs.readFileSync(csvPath, 'utf-8');
  } catch (error) {
    cachedMap = new Map();
    return cachedMap;
  }

  const map = new Map();
  contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [codePart, descriptionPart] = line.split(';');
      if (!codePart) {
        return;
      }
      const code = codePart.trim();
      if (!code) {
        return;
      }
      let description = (descriptionPart || '').trim();
      if (description.startsWith('"') && description.endsWith('"')) {
        description = description.slice(1, -1);
      }
      if (description) {
        map.set(code, description);
      }
    });

  cachedMap = map;
  return cachedMap;
}

function getCfopDescription(code) {
  if (!code) return null;
  const normalized = String(code).trim();
  if (!normalized) return null;

  const catalog = loadCatalog();
  return catalog.get(normalized) ?? null;
}

module.exports = {
  getCfopDescription,
};
