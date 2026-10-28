'use strict';
// Run from a real scheduler: node scripts/sync-suppliers.js [--force].
// --force is a manual refresh; it never changes the saved daily setting.
require('dotenv').config({path:process.env.BIOS_DOTENV_PATH||undefined});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {openDatabase}=require('./database');const {fetchSupplierPreview}=require('./suppliers');
async function synchronize({db,fetchPreview=fetchSupplierPreview,force=false,clock=()=>new Date()}={}){
 const settings=Object.fromEntries((await db.all('SELECT key,value FROM supplier_settings')).map(x=>[x.key,x.value]));
 if(!force&&settings.daily_sync_enabled!=='1')return {disabled:true,updated:0,failed:0};
 const stamp=clock().toISOString(),owner=crypto.randomUUID();
 await db.exec('CREATE TABLE IF NOT EXISTS supplier_sync_mutex(id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires TEXT NOT NULL)');
 const claim=await db.run(`INSERT INTO supplier_sync_mutex(id,owner,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE supplier_sync_mutex.expires<?`,['daily',owner,new Date(clock().getTime()+1800000).toISOString(),stamp]);
 if(!claim.changes)return {busy:true,updated:0,failed:0};
 let updated=0,failed=0;
 try{
  const cutoff=new Date(clock().getTime()-86400000).toISOString();
  const offers=await db.all(`SELECT o.* FROM supplier_offers o JOIN suppliers s ON s.id=o.supplierId WHERE s.status='ativo' AND o.autoSync=1 ${force?'':"AND (o.lastChecked IS NULL OR o.lastChecked<?)"} ORDER BY o.lastChecked ASC LIMIT 100`,force?[]:[cutoff]);
  for(const offer of offers){
   const began=Date.now(),time=clock().toISOString();
   try{
    const data=await fetchPreview(offer.url);
    if(!data.pricePix&&!data.priceCard&&data.availability!=='esgotado')throw new Error('Modalidade de pagamento não confirmada. Confirme manualmente.');
    await db.transaction(async()=>{
     const r=await db.run(`UPDATE supplier_offers SET lastPricePix=pricePix,pricePix=?,priceCard=?,cardInstallments=?,availability=?,lastChecked=?,isStale=0,lastError=NULL,updated=? WHERE id=? AND updated=?`,[data.pricePix??null,data.priceCard??null,data.cardInstallments||'',data.availability||'sob_consulta',time,time,offer.id,offer.updated]);
     if(!r.changes)throw new Error('Oferta foi editada durante a consulta; preço não sobrescrito.');
     await db.run('INSERT INTO supplier_sync_logs(supplierId,offerId,trigger,status,oldPricePix,newPricePix,durationMs,message,created) VALUES(?,?,?,?,?,?,?,?,?)',[offer.supplierId,offer.id,force?'manual':'daily','sucesso',offer.pricePix,data.pricePix??null,Date.now()-began,'Cotação observada; frete e orçamento não alterados.',time]);
    });updated++;
   }catch(e){
    await db.transaction(async()=>{
     await db.run('UPDATE supplier_offers SET isStale=1,lastError=?,updated=? WHERE id=? AND updated=?',[String(e.message).slice(0,300),time,offer.id,offer.updated]);
     await db.run('INSERT INTO supplier_sync_logs(supplierId,offerId,trigger,status,oldPricePix,newPricePix,durationMs,message,created) VALUES(?,?,?,?,?,?,?,?,?)',[offer.supplierId,offer.id,force?'manual':'daily','erro',offer.pricePix,null,Date.now()-began,String(e.message).slice(0,300),time]);
    });failed++;
   }
  }
  return {updated,failed};
 }finally{await db.run('DELETE FROM supplier_sync_mutex WHERE id=? AND owner=?',['daily',owner]);}
}
async function main(){
 const target=path.resolve(process.env.DB_PATH||path.join(__dirname,'../database.sqlite'));
 if(!process.env.DATABASE_URL&&!fs.existsSync(target))throw new Error('Banco inexistente. Inicialize a aplicação antes de sincronizar.');
 const db=await openDatabase(target);try{console.log(JSON.stringify(await synchronize({db,force:process.argv.includes('--force')})));}finally{await db.close();}
}
if(require.main===module)main().catch(e=>{console.error('Sincronização não concluída: '+e.message);process.exitCode=1;});
module.exports={synchronize};
