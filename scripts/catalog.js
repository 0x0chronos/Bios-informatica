'use strict';

// Supplier costs belong to the authenticated panel, never to the public catalog.
async function searchCatalog(store, query = {}) {
  const q = String(query.q || '').trim().slice(0, 100);
  const supplier = String(query.supplier || 'all');
  if (!['all', 'kabum', 'pichau', 'terabyte'].includes(supplier)) {
    const error = new Error('Fornecedor inválido.'); error.status = 400; throw error;
  }
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 10000);
  const conditions = ["COALESCE(s.status,'ativo') != 'inativo'"];
  const params = [];
  if (supplier !== 'all') { conditions.push('o.supplierId=?'); params.push(supplier); }
  if (query.category) { conditions.push('p.category=?'); params.push(String(query.category).slice(0, 60)); }
  // Every word must match, so "SSD Kingston 1TB" can span the title and brand.
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10)) {
    conditions.push("(LOWER(o.title) LIKE ? ESCAPE '!' OR LOWER(COALESCE(o.storeSku,'')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(p.brand,'')) LIKE ? ESCAPE '!')");
    const pattern = '%' + term.replace(/[!%_]/g, c => '!' + c) + '%';
    params.push(pattern, pattern, pattern);
  }
  const joins = 'FROM supplier_offers o LEFT JOIN suppliers s ON s.id=o.supplierId LEFT JOIN parts p ON p.id=o.partId';
  const where = conditions.join(' AND ');
  const count = await store.get(`SELECT COUNT(*) AS total ${joins} WHERE ${where}`, params);
  const results = await store.all(`SELECT o.*,o.supplierId AS supplier,s.name AS supplierName,
    p.category AS partCategory,p.brand AS partBrand,p.model AS partModel,p.price AS partSellPrice
    ${joins} WHERE ${where}
    ORDER BY CASE WHEN o.availability='em_estoque' THEN 0 WHEN o.availability='sob_consulta' THEN 1 ELSE 2 END,
    CASE WHEN COALESCE(o.pricePix,o.priceCard,0)>0 THEN 0 ELSE 1 END,
    COALESCE(o.pricePix,o.priceCard) ASC,o.id ASC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  const cutoff = Date.now() - 26 * 60 * 60 * 1000;
  for (const offer of results) {
    offer.isStale = !!offer.isStale || !offer.lastChecked || !(Date.parse(offer.lastChecked) >= cutoff);
  }
  const sources = await store.all(`SELECT s.id AS supplier,s.name AS supplierName,MAX(o.lastChecked) AS lastChecked,
    COUNT(o.id) AS products FROM suppliers s LEFT JOIN supplier_offers o ON o.supplierId=s.id
    WHERE s.id IN ('kabum','pichau','terabyte') GROUP BY s.id,s.name ORDER BY s.id`);
  return { results, sources, total: Number(count.total), page, limit, pages: Math.ceil(Number(count.total) / limit), source: 'catalog', updatedAt: new Date().toISOString() };
}

module.exports = { searchCatalog };
