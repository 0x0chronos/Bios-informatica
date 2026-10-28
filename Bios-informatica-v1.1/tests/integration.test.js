'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const {spawn}=require('node:child_process');const bcrypt=require('bcrypt');const {openDatabase}=require('../scripts/database');
const root=path.resolve(__dirname,'..');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bios-tests-'));const dbPath=path.join(temp,'database.sqlite');let child,base,cookie;
const password='UmaSenhaDeTeste-'+crypto.randomBytes(8).toString('hex');
async function call(route,{method='GET',body,auth=true,origin,header=true}={}){const headers={};if(auth&&cookie)headers.cookie=cookie;if(body!==undefined){headers['Content-Type']='application/json';if(header)headers['X-Bios-Request']='1';}if(origin)headers.origin=origin;const res=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return {res,data};}
async function login(user='admin',pass=password){const {res,data}=await call('/api/login',{method:'POST',body:{username:user,password:pass},auth:false});assert.equal(res.status,200,JSON.stringify(data));const set=res.headers.get('set-cookie');assert.match(set,/HttpOnly/i);assert.match(set,/SameSite=Strict/i);assert.equal(data.token,undefined);cookie=set.split(';')[0];return data;}
async function boot(database,extra={}){child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env, DATABASE_URL: '', NODE_ENV: 'test',PORT:'18761',JWT_SECRET:crypto.randomBytes(40).toString('hex'),SITE_URL:'http://127.0.0.1:18761',COOKIE_SECURE:'false',DB_PATH:database,...extra},stdio:['ignore','pipe','pipe']});base='http://127.0.0.1:18761';let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout: '+output)),15000);const check=()=>{if(output.includes('Bios disponível')){clearTimeout(timer);resolve();}else if(child.exitCode!==null){clearTimeout(timer);reject(new Error(output));}else setTimeout(check,30);};check();});}
async function stop(){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));child=null;}
test('Bios: acesso, OS, orçamento, backup e migração',{timeout:90000},async t=>{
 t.after(async()=>{await stop();fs.rmSync(temp,{recursive:true,force:true});});
 await boot(dbPath,{ADMIN_USERNAME:'admin',ADMIN_PASSWORD:password});
 await t.test('página e SEO acessíveis; arquivos internos não são públicos',async()=>{
  for(const route of ['/','/painel','/acompanhar','/privacidade','/robots.txt','/sitemap.xml','/assets/compartilhar.png']){const r=await fetch(base+route);assert.equal(r.status,200,route);}
  for(const route of ['/server.js','/database.sqlite','/.env','/package.json','/scripts/database.js','/backups/a.sqlite'])assert.equal((await fetch(base+route)).status,404,route);
  const {data}=await call('/');assert.match(data,/rel="canonical" href="https:\/\/biosinformatica.store\/"/);assert.doesNotMatch(data,/1\.200|Resolvemos Hoje|criptografia militar|checkout|google-analytics/);
 });
 await t.test('cadastros exigem login e mutações exigem cabeçalho e origem autorizada',async()=>{
  assert.equal((await call('/api/clients',{auth:false})).res.status,401);await login();
  assert.equal((await call('/api/clients',{method:'POST',body:{name:'A',phone:'13999990000'},header:false})).res.status,403);
  assert.equal((await call('/api/clients',{method:'POST',body:{name:'A',phone:'13999990000'},origin:'https://malicious.example'})).res.status,403);
  assert.equal((await call('/api/bookings',{method:'POST',body:{totalValue:1},auth:false})).res.status,410);
 });
 let client,service,order,tracking;
 await t.test('cadastros, criação simultânea e validação de valores',async()=>{
  const c=await call('/api/clients',{method:'POST',body:{name:'Cliente de teste',phone:'(13) 99999-0000'}});assert.equal(c.res.status,201);client=c.data.id;
  const s=await call('/api/services',{method:'POST',body:{name:'Limpeza',category:'Notebook',price:120,desc:'Teste'}});assert.equal(s.res.status,201);service=s.data.id;
  const newOrder={clientId:client,serviceId:service,device:'Notebook de teste',value:120,status:'recebido'};
  const all=await Promise.all(Array.from({length:6},()=>call('/api/orders',{method:'POST',body:newOrder})));assert.equal(new Set(all.map(x=>x.data.id)).size,6);assert.ok(all.every(x=>x.res.status===201),JSON.stringify(all.map(x=>x.data)));
  order=all[0].data.id;const orders=await call('/api/orders');tracking=orders.data.find(x=>x.id===order).trackingToken;assert.match(tracking,/^[a-f0-9]{64}$/);
  assert.equal((await call('/api/orders',{method:'POST',body:{...newOrder,value:-1}})).res.status,400);
  assert.equal((await call('/api/orders',{method:'POST',body:{...newOrder,clientId:'missing'}})).res.status,409);
  assert.equal((await call('/api/clients/'+client,{method:'DELETE',body:{}})).res.status,409);
 });
 await t.test('link exclusivo não expõe dados de contato; número sequencial não consulta',async()=>{
  assert.equal((await call('/api/os/'+order,{auth:false})).res.status,410);
  assert.equal((await call('/api/tracking/'+order,{auth:false})).res.status,404);
  const r=await call('/api/tracking/'+tracking,{auth:false});assert.equal(r.res.status,200);assert.equal(r.data.device,'Notebook de teste');for(const key of ['clientName','phone','email','doc','problem','solution','trackingToken','id'])assert.equal(r.data[key],undefined);assert.equal(r.res.headers.get('cache-control'),'no-store');
 });
 await t.test('aprovação versionada, atualização de preço e revogação do link',async()=>{
  let r=await call('/api/orders/'+order+'/quote',{method:'PUT',body:{description:'Mão de obra R$ 120. Sem peças incluídas. Prazo a combinar.',value:120}});assert.equal(r.res.status,200);
  let view=(await call('/api/tracking/'+tracking,{auth:false})).data;const v=view.quote.version;assert.equal(view.status,'aguardando_aprovacao');
  r=await call('/api/tracking/'+tracking+'/approve',{method:'POST',auth:false,body:{version:v,accepted:true}});assert.equal(r.res.status,200);
  assert.equal((await call('/api/tracking/'+tracking,{auth:false})).data.quote.approved,true);
  const current=(await call('/api/orders')).data.find(x=>x.id===order);r=await call('/api/orders/'+order,{method:'PUT',body:{...current,value:180}});assert.equal(r.res.status,200);
  assert.equal((await call('/api/tracking/'+tracking,{auth:false})).data.quote,null);
  assert.equal((await call('/api/tracking/'+tracking+'/approve',{method:'POST',auth:false,body:{version:v,accepted:true}})).res.status,409);
  assert.equal((await call('/api/orders/'+order+'/rotate-link',{method:'POST',body:{}})).res.status,200);
  assert.equal((await call('/api/tracking/'+tracking,{auth:false})).res.status,404);
  const history=await call('/api/orders/'+order+'/history');assert.equal(history.data.approvals.length,1);assert.equal(history.data.approvals[0].value,120);
 });
 await t.test('backup íntegro e dados preservados após reiniciar',async()=>{
  const {execFileSync}=require('node:child_process');const backupDir=path.join(temp,'backups');execFileSync(process.execPath,['scripts/backup.js'],{cwd:root,env:{...process.env, DATABASE_URL: '', NODE_ENV: 'test',DB_PATH:dbPath,BACKUP_DIR:backupDir}});
  const backup=await openDatabase(path.join(backupDir,fs.readdirSync(backupDir)[0]));assert.equal((await backup.get('PRAGMA integrity_check')).integrity_check,'ok');assert.equal((await backup.get('SELECT COUNT(*) n FROM orders')).n,6);await backup.close();
  await stop();await boot(dbPath);await login();assert.equal((await call('/api/orders')).data.length,6);
  await stop();const restored=path.join(temp,'restored.sqlite');fs.copyFileSync(path.join(backupDir,fs.readdirSync(backupDir)[0]),restored);await boot(restored);await login();assert.equal((await call('/api/orders')).data.length,6);await stop();await boot(dbPath);await login();
 });
 await t.test('logout e troca de senha invalidam sessões já emitidas',async()=>{
  const old=cookie;assert.equal((await call('/api/logout',{method:'POST',body:{}})).res.status,200);cookie=old;assert.equal((await call('/api/me')).res.status,401);await login();
  const nextPassword='OutraSenha-'+crypto.randomBytes(10).toString('hex');const before=cookie;
  assert.equal((await call('/api/admin/credentials',{method:'PUT',body:{currentUsername:'admin',currentPassword:password,newUsername:'rony',newPassword:nextPassword}})).res.status,200);
  cookie=before;assert.equal((await call('/api/me')).res.status,401);await login('rony',nextPassword);
 });
 await t.test('migração preserva dados antigos e exige trocar senha padrão',async()=>{
  await stop();const legacy=path.join(temp,'legacy.sqlite'),db=await openDatabase(legacy);
  await db.exec('CREATE TABLE users(username TEXT PRIMARY KEY,password TEXT NOT NULL);CREATE TABLE clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,doc TEXT,city TEXT,neighborhood TEXT,address TEXT,obs TEXT,created TEXT);');
  await db.run('INSERT INTO users VALUES(?,?)',['admin',await bcrypt.hash('123456',4)]);await db.run('INSERT INTO users VALUES(?,?)',['plainuser','plainpassword123']);await db.run('INSERT INTO clients(id,name,phone) VALUES(?,?,?)',['old','Cliente preservado','13999990000']);await db.close();
  await boot(legacy);const plain=await login('plainuser','plainpassword123');assert.equal(plain.mustChange,false);const data=await login('admin','123456');assert.equal(data.mustChange,true);assert.equal((await call('/api/clients')).res.status,403);
  const r=await call('/api/admin/credentials',{method:'PUT',body:{currentUsername:'admin',currentPassword:'123456',newUsername:'admin',newPassword:password}});assert.equal(r.res.status,200);await login();assert.equal((await call('/api/clients')).data[0].name,'Cliente preservado');assert.ok(fs.readdirSync(path.join(temp,'backups')).some(x=>x.startsWith('antes-migracao')));
 });
});
