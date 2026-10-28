'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../scripts/database');
const { searchCatalog } = require('../scripts/catalog');

async function database() {
  const db = await openDatabase(':memory:', { driver: 'sqlite' });
  await db.exec(`CREATE TABLE suppliers(id TEXT,name TEXT,status TEXT);
    CREATE TABLE parts(id TEXT,category TEXT,brand TEXT,model TEXT,price REAL);
    CREATE TABLE supplier_offers(id TEXT,partId TEXT,supplierId TEXT,storeSku TEXT,title TEXT,
      pricePix REAL,priceCard REAL,availability TEXT,lastChecked TEXT,isStale INTEGER);
    INSERT INTO suppliers VALUES('kabum','KaBuM!','ativo'),('pichau','Pichau','ativo'),('terabyte','Terabyte','inativo');
    INSERT INTO parts VALUES('ssd','SSD','Kingston','NVMe',150);
    INSERT INTO supplier_offers VALUES('a','ssd','kabum','123','SSD Kingston 1TB',100,120,'em_estoque','2020-01-01T00:00:00Z',0);
    INSERT INTO supplier_offers VALUES('b','ssd','pichau','456','SSD Kingston 1TB',90,NULL,'esgotado',NULL,0);
    INSERT INTO supplier_offers VALUES('c','ssd','terabyte','789','SSD Kingston 1TB',80,NULL,'em_estoque',NULL,0);`);
  return db;
}

test('catalog searches all words, paginates deterministically and flags old data', async () => {
  const db = await database();
  try {
    const first = await searchCatalog(db, { q: 'kingston ssd', limit: '1' });
    assert.equal(first.total, 2);
    assert.equal(first.pages, 2);
    assert.equal(first.results[0].id, 'a'); // In-stock before a cheaper sold-out offer.
    assert.equal(first.results[0].isStale, true);
    assert.equal(first.results[0].partSellPrice, 150);
    const second = await searchCatalog(db, { q: 'kingston ssd', limit: '1', page: '2' });
    assert.equal(second.results[0].id, 'b');
    assert.equal(second.results[0].priceCard, null);
    assert.equal(second.results[0].supplier, 'pichau');
  } finally { await db.close(); }
});

test('literal wildcards and SQL text do not broaden the search', async () => {
  const db = await database();
  try {
    for (const q of ['%', '_', "' OR 1=1 --", 'Kingston nonexistent']) {
      assert.equal((await searchCatalog(db, { q })).total, 0);
    }
    assert.equal((await searchCatalog(db, { supplier: 'kabum' })).total, 1);
    await assert.rejects(searchCatalog(db, { supplier: 'unknown' }), { status: 400 });
  } finally { await db.close(); }
});

test('recent prices are fresh while missing dates stay unconfirmed', async () => {
  const db = await database();
  try {
    await db.run('UPDATE supplier_offers SET lastChecked=? WHERE id=?', [new Date().toISOString(), 'a']);
    const result = await searchCatalog(db);
    assert.equal(result.results[0].isStale, false);
    assert.equal(result.results[1].isStale, true);
  } finally { await db.close(); }
});
