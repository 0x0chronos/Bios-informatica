'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { openDatabase } = require('../scripts/database');

test('the sync key can publish offers over HTTP but cannot access administrative records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'bios-sync-http-'));
  const token = crypto.randomBytes(32).toString('base64url');
  const config = path.join(directory,'sync.json');
  fs.writeFileSync(config,JSON.stringify({tokenHash:crypto.createHash('sha256').update(token).digest('hex')}));
  const listener = net.createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port = listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),windowsHide:true,env:{...process.env,
    BIOS_DOTENV_PATH:path.join(directory,'missing-env'),DATABASE_URL:'',NODE_ENV:'development',PORT:String(port),
    DB_PATH:path.join(directory,'test.sqlite'),SITE_URL:base,JWT_SECRET:crypto.randomBytes(40).toString('hex'),
    CATALOG_SYNC_CONFIG_PATH:config,ADMIN_USERNAME:'',ADMIN_PASSWORD:''},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Test server did not start')),10000);
      child.stdout.on('data',chunk=>{if(chunk.toString().includes('Bios disponível')){clearTimeout(timer);resolve();}});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('Test server stopped: '+code));});
    });
    const post = (products, credential=token) => fetch(base+'/api/suppliers/catalog-sync',{method:'POST',
      headers:{'Content-Type':'application/json','X-Bios-Request':'1','Authorization':'Bearer '+credential},body:JSON.stringify({products})});
    assert.equal((await post([], 'incorrect-token')).status,401);
    const result = await post([{supplierId:'kabum',title:'SSD Kingston teste 1TB',sku:'123',url:'https://www.kabum.com.br/produto/123/ssd',
      category:'SSD',brand:'Kingston',pricePix:200,priceCard:null,availability:'em_estoque',lastChecked:new Date().toISOString()}]);
    assert.equal(result.status,200);
    assert.equal((await result.json()).acknowledged,1);
    const catalog = await (await fetch(base+'/api/catalog')).json();
    assert.equal(catalog.items.length,0); // Supplier stock is not the shop's own inventory.
    const database = await openDatabase(path.join(directory,'test.sqlite'),{driver:'sqlite'});
    try { assert.equal((await database.get('SELECT COUNT(*) AS n FROM supplier_offers')).n,1); }
    finally { await database.close(); }
    for(const route of ['/api/clients','/api/orders','/api/suppliers/catalog']) {
      assert.equal((await fetch(base+route,{headers:{Authorization:'Bearer '+token}})).status,401);
    }
  } finally {
    if(child.exitCode===null) { child.kill(); await new Promise(resolve=>child.once('exit',resolve)); }
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
