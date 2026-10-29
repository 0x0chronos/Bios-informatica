'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('../scripts/database');
const { ingestCatalog, syncAuthenticator } = require('../scripts/catalog-sync');

const product = (overrides = {}) => ({ supplierId:'kabum',title:'SSD Kingston teste 1TB',url:'https://www.kabum.com.br/produto/123/ssd',
  sku:'123',category:'SSD',brand:'Kingston',pricePix:200,priceCard:230,availability:'em_estoque',lastChecked:new Date().toISOString(),...overrides });
async function database() {
  const db = await openDatabase(':memory:', {driver:'sqlite'});
  await db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE suppliers(id TEXT PRIMARY KEY); INSERT INTO suppliers VALUES('kabum');
    CREATE TABLE parts(id TEXT PRIMARY KEY,category TEXT,brand TEXT,model TEXT,sku TEXT,specs TEXT,supplier TEXT,cost REAL,price REAL,
      status TEXT,active INTEGER,notes TEXT,imageUrl TEXT,created TEXT,updated TEXT);
    CREATE TABLE supplier_offers(id TEXT PRIMARY KEY,partId TEXT REFERENCES parts(id),supplierId TEXT REFERENCES suppliers(id),storeSku TEXT,
      title TEXT,url TEXT,seller TEXT,fulfillmentBy TEXT,condition TEXT,pricePix REAL,priceCard REAL,cardInstallments TEXT,availability TEXT,
      imageUrl TEXT,lastChecked TEXT,isStale INTEGER,autoSync INTEGER,created TEXT,updated TEXT,lastPricePix REAL,lastError TEXT);
    CREATE TABLE quotes(id TEXT,total REAL); INSERT INTO quotes VALUES('approved',1200);`);
  return db;
}

test('sync requires the actual dedicated token; a hash or admin cookie is insufficient', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'bios-sync-auth-'));
  const config = path.join(folder,'config.json');
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  fs.writeFileSync(config,JSON.stringify({tokenHash:hash}));
  try {
    const authenticate = syncAuthenticator(config);
    for (const value of ['', 'Bearer '+hash, 'Bearer '+crypto.randomBytes(32).toString('base64url')]) {
      let status; authenticate({get:()=>value},{status(code){status=code;return this;},json(){}},()=>assert.fail('Unexpected authentication'));
      assert.equal(status,401);
    }
    let authorized = false;
    authenticate({get:()=> 'Bearer '+token},{},()=>{authorized=true;});
    assert.equal(authorized,true);
  } finally { fs.rmSync(folder,{recursive:true}); }
});

test('catalog sync preserves custom sale prices, approved quotes and original collection dates', async () => {
  const db = await database();
  try {
    const first = product({lastChecked:new Date(Date.now()-60000).toISOString()});
    assert.equal((await ingestCatalog(db,[first])).accepted,1);
    await db.run('UPDATE parts SET price=350');
    const update = product({pricePix:180});
    assert.equal((await ingestCatalog(db,[update])).accepted,1);
    assert.deepEqual(await db.get('SELECT cost,price,status FROM parts'),{cost:180,price:350,status:'sob_encomenda'});
    assert.equal((await db.get('SELECT total FROM quotes')).total,1200);
    assert.equal((await db.get('SELECT lastChecked FROM supplier_offers')).lastChecked,update.lastChecked);
    assert.equal((await ingestCatalog(db,[first])).skipped,1); // Delayed/offline delivery cannot replace newer data.
    assert.equal((await db.get('SELECT pricePix FROM supplier_offers')).pricePix,180);
    await db.run('UPDATE supplier_offers SET autoSync=0');
    assert.equal((await ingestCatalog(db,[product({lastChecked:new Date(Date.now()+1000).toISOString()})])).skipped,1);
  } finally { await db.close(); }
});

test('invalid or failed batches are atomic; no cross-domain URLs or invented prices', async () => {
  const db = await database();
  try {
    for (const invalid of [product({url:'https://attacker.example/123'}),product({pricePix:-5}),product({lastChecked:'invalid'}),product({pricePix:'200'})]) {
      await assert.rejects(ingestCatalog(db,[product(),invalid]),{status:400});
      assert.equal((await db.get('SELECT COUNT(*) AS n FROM parts')).n,0);
    }
    await assert.rejects(ingestCatalog(db,[product(),product({supplierId:'pichau',url:'https://www.pichau.com.br/ssd-teste'})]));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM parts')).n,0);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM supplier_offers')).n,0);
  } finally { await db.close(); }
});
