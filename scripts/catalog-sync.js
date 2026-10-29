'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DOMAINS = { kabum: 'www.kabum.com.br', pichau: 'www.pichau.com.br', terabyte: 'www.terabyteshop.com.br' };
const NAMES = { kabum: 'KaBuM!', pichau: 'Pichau', terabyte: 'TerabyteShop' };
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function string(value, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid('Dados de produto inválidos.');
  return value.trim();
}
function price(value) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 9999999) invalid('Preço de fornecedor inválido.');
  return Math.round(value * 100) / 100;
}
function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(DOMAINS, raw.supplierId)) invalid('Loja inválida.');
  const supplierId = raw.supplierId;
  let url;
  try { url = new URL(string(raw.url, 1000, true)); } catch { invalid('URL inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      ![DOMAINS[supplierId], DOMAINS[supplierId].slice(4)].includes(url.hostname) || url.pathname === '/') invalid('URL fora da loja.');
  url.hostname = DOMAINS[supplierId]; url.search = ''; url.hash = '';
  const checked = Date.parse(string(raw.lastChecked, 40, true));
  if (!Number.isFinite(checked) || checked > Date.now() + 5 * 60000) invalid('Data da coleta inválida.');
  if (!['em_estoque', 'esgotado', 'sob_consulta'].includes(raw.availability)) invalid('Disponibilidade inválida.');
  let imageUrl = null;
  if (raw.imageUrl) {
    try {
      const image = new URL(string(raw.imageUrl, 2000));
      const hosts = /^(?:images\d*\.kabum\.com\.br|media\.pichau\.com\.br|img\.terabyteshop\.com\.br)$/;
      if (image.protocol === 'https:' && !image.username && !image.password && !image.port && hosts.test(image.hostname)) imageUrl = image.href;
    } catch { invalid('Imagem inválida.'); }
  }
  return { supplierId, store: NAMES[supplierId], url: url.href.replace(/\/$/, ''), title: string(raw.title, 250, true),
    sku: string(raw.sku, 60), category: string(raw.category, 60, true), brand: string(raw.brand, 80, true),
    specs: string(raw.specs, 4000), seller: string(raw.seller, 80), fulfillmentBy: string(raw.fulfillmentBy, 80),
    cardInstallments: string(raw.cardInstallments, 100), pricePix: price(raw.pricePix), priceCard: price(raw.priceCard),
    availability: raw.availability, imageUrl, lastChecked: new Date(checked).toISOString() };
}

function syncAuthenticator(configPath = path.join(__dirname, '..', '.catalog-sync.json')) {
  let hash = '';
  try { hash = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')).tokenHash; } catch {}
  return (req, res, next) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) return res.status(503).json({ error: 'Sincronização de catálogo não configurada.' });
    const authorization = req.get('Authorization') || '';
    const token = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization)?.[1] || '';
    const actual = crypto.createHash('sha256').update(token).digest();
    if (!token || !crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'))) return res.status(401).json({ error: 'Chave de sincronização inválida.' });
    next();
  };
}

async function ingestCatalog(store, rawProducts) {
  if (!Array.isArray(rawProducts) || rawProducts.length > 8) invalid('Envie até oito produtos por lote.');
  const products = rawProducts.map(normalizeProduct); // Validate the complete batch before writing.
  let accepted = 0, skipped = 0;
  await store.transaction(async () => {
    for (const p of products) {
      const digest = crypto.createHash('sha256').update(p.url).digest('hex').slice(0, 12);
      const ownedPartId = `part_${p.supplierId}_${digest}`;
      const old = await store.get('SELECT id,partId,autoSync,lastChecked FROM supplier_offers WHERE supplierId=? AND (url=? OR (?!=\'\' AND storeSku=?)) ORDER BY created ASC LIMIT 1', [p.supplierId, p.url, p.sku, p.sku]);
      if (old && (!old.autoSync || Date.parse(old.lastChecked) >= Date.parse(p.lastChecked))) { skipped++; continue; }
      const partId = old?.partId || ownedPartId;
      const cost = p.pricePix ?? p.priceCard;
      const stamp = new Date().toISOString();
      if (partId === ownedPartId) {
        await store.run(`INSERT INTO parts(id,category,brand,model,sku,specs,supplier,cost,price,status,active,notes,imageUrl,created,updated)
          VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cost=COALESCE(?,parts.cost),
          status=excluded.status,model=excluded.model,imageUrl=COALESCE(excluded.imageUrl,parts.imageUrl),updated=excluded.updated`,
        [partId,p.category,p.brand,p.title,p.sku,p.specs,p.store,cost || 0,Math.round((cost || 0)*125)/100,
          p.availability==='em_estoque'?'sob_encomenda':'a_confirmar',p.url,p.imageUrl,stamp,stamp,cost]);
      }
      await store.run(`INSERT INTO supplier_offers(id,partId,supplierId,storeSku,title,url,seller,fulfillmentBy,condition,
        pricePix,priceCard,cardInstallments,availability,imageUrl,lastChecked,isStale,autoSync,created,updated)
        VALUES(?,?,?,?,?,?,?,?,'novo',?,?,?,?,?,?,0,1,?,?) ON CONFLICT(id) DO UPDATE SET
        partId=COALESCE(supplier_offers.partId,excluded.partId),title=excluded.title,url=excluded.url,seller=excluded.seller,
        lastPricePix=supplier_offers.pricePix,pricePix=excluded.pricePix,priceCard=excluded.priceCard,
        cardInstallments=excluded.cardInstallments,availability=excluded.availability,
        imageUrl=COALESCE(excluded.imageUrl,supplier_offers.imageUrl),lastChecked=excluded.lastChecked,
        isStale=0,lastError=NULL,updated=excluded.updated`,
      [old?.id || `so_${p.supplierId}_${digest}`,partId,p.supplierId,p.sku,p.title,p.url,p.seller,p.fulfillmentBy,
        p.pricePix,p.priceCard,p.cardInstallments,p.availability,p.imageUrl,p.lastChecked,stamp,stamp]);
      accepted++;
    }
  });
  return { success: true, acknowledged: products.length, accepted, skipped };
}

module.exports = { syncAuthenticator, ingestCatalog, normalizeProduct };
