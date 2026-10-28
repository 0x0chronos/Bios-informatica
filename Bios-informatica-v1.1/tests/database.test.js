'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toPgSql,postgresStore}=require('../scripts/database');

test('PostgreSQL: migrations include quotation tables and SQLite identity becomes SERIAL',async()=>{
 const seen=[];const db=postgresStore({query:async sql=>{seen.push(sql);return {rows:[],rowCount:0}}});
 await db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY AUTOINCREMENT); CREATE TABLE IF NOT EXISTS quotes(publicCode TEXT, total REAL);");
 assert.equal(seen.length,2);assert.match(seen[0],/SERIAL PRIMARY KEY/);assert.match(seen[1],/CREATE TABLE IF NOT EXISTS quotes\("publicCode" TEXT, total DOUBLE PRECISION\)/);
 assert.equal(toPgSql("SELECT 'publicCode ?' AS name, publicCode FROM quotes WHERE id=? ORDER BY id DESC"),"SELECT 'publicCode ?' AS name, \"publicCode\" FROM quotes WHERE id=$1 ORDER BY id DESC");
 assert.match(toPgSql('INSERT INTO services(id,desc) VALUES(?,?)'),/"desc"/);
});
test('PostgreSQL: transaction uses one checked-out client and rolls back all statements',async()=>{
 const events=[];let releases=0;
 const pool={query:async sql=>{events.push('pool:'+sql);return {rows:[],rowCount:0}},connect:async()=>({query:async sql=>{events.push('client:'+sql);return {rows:[],rowCount:1}},release(){releases++}})};
 const db=postgresStore(pool);
 await db.transaction(async()=>{await db.run('INSERT INTO clients(id) VALUES(?)',['test']);await db.get('SELECT id FROM clients');});
 assert.deepEqual(events,['client:BEGIN','client:INSERT INTO clients(id) VALUES($1)','client:SELECT id FROM clients','client:COMMIT']);
 events.length=0;
 await assert.rejects(db.transaction(async()=>{await db.run('DELETE FROM clients');throw Error('falha');}),/falha/);
 assert.deepEqual(events,['client:BEGIN','client:DELETE FROM clients','client:ROLLBACK']);assert.equal(releases,2);
 await assert.rejects(db.get('PRAGMA integrity_check'),/indisponível/);
 await assert.rejects(db.run('VACUUM INTO ?',['backup.sqlite']),/indisponível/);
});
