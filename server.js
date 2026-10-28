'use strict';
require('dotenv').config({path:process.env.BIOS_DOTENV_PATH||undefined});
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./scripts/database');
const { fetchSupplierPreview, validateUrlSecurity, searchStoreProducts } = require('./scripts/suppliers');
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || '';
const SITE_URL = new URL(process.env.SITE_URL || 'https://biosinformatica.store').origin;
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'database.sqlite'));
const STATUS = ['recebido','analise','aguardando_aprovacao','aguardando','manutencao','pronto','entregue','cancelado'];
const LABELS = {recebido:'Recebido',analise:'Em análise',aguardando_aprovacao:'Aguardando aprovação',aguardando:'Aguardando peças',manutencao:'Em manutenção',pronto:'Pronto para entrega',entregue:'Entregue',cancelado:'Cancelado'};
let store;
let mutationQueue = Promise.resolve();
function mutate(action) { const next = mutationQueue.then(action); mutationQueue = next.catch(()=>{}); return next; }
async function transaction(action) { return store.transaction(action); }
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const now = () => new Date().toISOString();
const token = () => crypto.randomBytes(32).toString('hex');
const generatePublicCode = () => 'BIOS-' + crypto.randomBytes(6).toString('hex').toUpperCase();
const generateQuotePublicCode = () => 'ORC-' + crypto.randomBytes(6).toString('hex').toUpperCase();
const PART_STATUS = ['em_estoque','sob_encomenda','a_confirmar'];
const PART_STATUS_LABELS = {em_estoque:'Em estoque',sob_encomenda:'Sob encomenda',a_confirmar:'Disponibilidade a confirmar'};
const QUOTE_STATUS = ['rascunho','aguardando_aprovacao','aprovado','rejeitado','convertido_os'];
const QUOTE_STATUS_LABELS = {rascunho:'Rascunho',aguardando_aprovacao:'Aguardando aprovação',aprovado:'Aprovado',rejeitado:'Rejeitado',convertido_os:'Convertido em OS'};

function partInput(b){
 const category=text(b.category,60),brand=text(b.brand,80),model=text(b.model,150);
 if(!category||!brand||!model)fail('Informe categoria, fabricante e modelo da peça.');
 const sku=text(b.sku,60);
 const specs=text(b.specs,4000);
 const supplier=text(b.supplier,100);
 const cost=money(b.cost);
 const price=money(b.price);
 const status=PART_STATUS.includes(b.status)?b.status:'em_estoque';
 const active=b.active===false||b.active===0||b.active==='0'?0:1;
 const notes=text(b.notes,2000);
 return {category,brand,model,sku,specs,supplier,cost,price,status,active,notes};
}

function calculateQuoteFinancials(rawItems=[],shippingTotal=0,discountTotal=0){
 if(!Array.isArray(rawItems))fail('Lista de itens inválida.');
 if(rawItems.length===0)fail('Adicione pelo menos um item à proposta.');
 let partsCents=0,servicesCents=0,customCents=0,totalCostCents=0;
 const processedItems=rawItems.map((it,idx)=>{
  const type=({part:'peca',service:'servico',custom:'avulso',peca:'peca',servico:'servico',avulso:'avulso'})[it.type];
  if(!type)fail('Tipo de item inválido.');
  const name=text(it.name||it.description,250);
  if(!name)fail('Cada item do orçamento deve conter uma descrição válida.');
  const details=text(it.details||it.specs,3000);
  const qty=Number(it.quantity??1);
  if(!Number.isInteger(qty)||qty<1||qty>9999)fail('Quantidade deve ser um número inteiro entre 1 e 9999.');
  const unitPrice=money(it.unitPrice??it.price);
  const unitCost=money(it.unitCost??it.cost);
  const subtotalCents=Math.round(unitPrice*100)*qty;
  const costSubtotalCents=Math.round(unitCost*100)*qty;
  if(type==='peca')partsCents+=subtotalCents;
  else if(type==='servico')servicesCents+=subtotalCents;
  else customCents+=subtotalCents;
  totalCostCents+=costSubtotalCents;
  return {
   id:it.id&&/^[a-zA-Z0-9_-]+$/.test(it.id)?it.id:'qi_'+crypto.randomUUID().replace(/-/g,''),
   type,
   itemId:it.itemId?safeId(it.itemId):null,
   name,
   details,
   quantity:qty,
   unitCost,
   unitPrice,
   subtotal:subtotalCents/100,
   costSubtotal:costSubtotalCents/100,
   position:idx
  };
 });
 const shippingCents=Math.round(money(shippingTotal)*100);
 const discountCents=Math.round(money(discountTotal)*100);
 const grossCents=partsCents+servicesCents+customCents+shippingCents;
 if(discountCents>grossCents)fail('O desconto não pode exceder o valor total da proposta.');
 const totalCents=grossCents-discountCents;
 const profitCents=totalCents-totalCostCents-shippingCents;
 const profitMargin=totalCents>0?Math.round((profitCents/totalCents)*10000)/100:0;
 return {
  items:processedItems,
  partsTotal:partsCents/100,
  servicesTotal:servicesCents/100,
  customTotal:customCents/100,
  shippingTotal:shippingCents/100,
  discountTotal:discountCents/100,
  total:totalCents/100,
  totalCost:totalCostCents/100,
  profit:profitCents/100,
  profitMargin
 };
}

const QUOTE_STATUS_MAP = {
 draft: 'rascunho',
 rascunho: 'rascunho',
 sent: 'aguardando_aprovacao',
 enviado: 'aguardando_aprovacao',
 waiting_approval: 'aguardando_aprovacao',
 aguardando_aprovacao: 'aguardando_aprovacao',
 approved: 'aprovado',
 aprovado: 'aprovado',
 rejected: 'rejeitado',
 rejeitado: 'rejeitado',
 converted_os: 'convertido_os',
 convertido_os: 'convertido_os'
};

function normalizeQuoteStatus(st) {
 if (!st) return 'rascunho';
 const clean = String(st).toLowerCase().trim();
 return QUOTE_STATUS_MAP[clean] || (QUOTE_STATUS.includes(clean) ? clean : 'rascunho');
}

function isQuoteSentOrApproved(status, approvedVersion) {
 if (approvedVersion !== null && approvedVersion !== undefined && approvedVersion !== '') return true;
 const s = String(status || '').toLowerCase().trim();
 return ['aguardando_aprovacao', 'aprovado', 'sent', 'enviado', 'approved'].includes(s);
}

function quoteInput(b){
 const title=text(b.title,180);
 if(!title)fail('Informe o título ou objetivo da proposta.');
 const clientId=b.clientId?safeId(b.clientId):null;
 const orderId=b.orderId?safeId(b.orderId):null;
 const device=text(b.device,200);
 const validUntil=b.validUntil?date(b.validUntil):null;
 const paymentTerms=text(b.paymentTerms,300);
 const deliveryTime=text(b.deliveryTime,150);
 const notes=text(b.notes,4000);
 const internalNotes=text(b.internalNotes,4000);
 const status=normalizeQuoteStatus(b.status);
 const financials=calculateQuoteFinancials(b.items||[],b.shippingTotal,b.discountTotal);
 return {clientId,orderId,title,device,validUntil,paymentTerms,deliveryTime,notes,internalNotes,status,...financials};
}
function fail(message, status=400) { const e = new Error(message); e.status=status; throw e; }
function text(value,max=2000) { if(value===undefined||value===null)return ''; if(typeof value!=='string')fail('Texto inválido.'); if(value.length>max)fail('Texto excede o limite permitido.'); return value.trim(); }
function money(value) { const n=Number(value??0); if(!Number.isFinite(n)||n<0||n>9999999)fail('Valor inválido.'); return Math.round(n*100)/100; }
function date(value) { const s=text(value,10); if(!s)return s; const d=new Date(s+'T12:00:00Z'); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)fail('Data inválida.'); return s; }
function safeId(value){const s=text(value,100);if(!/^[a-zA-Z0-9_-]+$/.test(s))fail('Identificador inválido.');return s;}
function strongPassword(s){return typeof s==='string'&&s.length>=12&&Buffer.byteLength(s)<=72;}
function cookieOptions(req){return {httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true'||(process.env.COOKIE_SECURE!=='false'&&req.secure),path:'/api',maxAge:8*60*60*1000};}
function readCookie(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('bios_session='));return raw?raw.slice('bios_session='.length):'';}
app.disable('x-powered-by');
if(process.env.TRUST_PROXY_HOPS){const n=Number(process.env.TRUST_PROXY_HOPS);if(!Number.isInteger(n)||n<1||n>5)throw new Error('TRUST_PROXY_HOPS inválido.');app.set('trust proxy',n);}
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'"],scriptSrcAttr:["'unsafe-inline'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],formAction:["'self'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}},referrerPolicy:{policy:'no-referrer'}}));
app.use(compression());
app.use(express.json({limit:'50kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow');next();});
app.use('/api',(req,res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)){
  if(req.get('X-Bios-Request')!=='1'||!req.is('application/json'))return res.status(403).json({error:'Requisição não autorizada.'});
  if(req.get('Origin')&&req.get('Origin')!==SITE_URL)return res.status(403).json({error:'Origem não autorizada.'});
 }
 next();
});
const loginLimiter=rateLimit({
 windowMs:15*60*1000,
 limit:process.env.NODE_ENV==='production'?10:100,
 skip:(req)=>process.env.NODE_ENV!=='production'&&(req.ip==='127.0.0.1'||req.ip==='::1'||req.ip==='::ffff:127.0.0.1'),
 standardHeaders:'draft-7',
 legacyHeaders:false,
 message:{error:'Muitas tentativas. Tente novamente mais tarde.'}
});
const trackingLimiter=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Muitas consultas. Tente novamente mais tarde.'}});
async function authenticate(req,res,next){
 try{
  const raw=readCookie(req);if(!raw)return res.status(401).json({error:'Faça login para continuar.'});
  let payload;try{payload=jwt.verify(raw,JWT_SECRET,{algorithms:['HS256']});}catch{return res.status(401).json({error:'Sessão expirada. Faça login novamente.'});}
  const user=await store.get('SELECT username, authVersion, mustChange FROM users WHERE username=?',[payload.username]);
  if(!user||user.authVersion!==payload.version)return res.status(401).json({error:'Sessão inválida.'});
  req.user=user;
  if(user.mustChange&&!['/api/me','/api/logout','/api/admin/credentials'].includes(req.path))return res.status(403).json({error:'Troque a senha padrão antes de acessar os cadastros.',code:'PASSWORD_CHANGE_REQUIRED'});
  next();
 }catch(e){next(e);}
}
app.post('/api/login',loginLimiter,asyncRoute(async(req,res)=>{
 const username=text(req.body.username,80);const password=req.body.password;if(typeof password!=='string'||Buffer.byteLength(password)>200)fail('Senha inválida.');
 const user=await store.get('SELECT * FROM users WHERE username=?',[username]);
 const matches=await bcrypt.compare(password,user?.password||'$2b$12$CUx8L52iYWNzuEaw2x2b5O0XOjGnh8OsfBFC3.5s5CVKo1Q8zQQhu');
 if(!user||!matches)return res.status(401).json({error:'Usuário ou senha incorretos.'});
 const signed=jwt.sign({username:user.username,version:user.authVersion},JWT_SECRET,{algorithm:'HS256',expiresIn:'8h'});
 res.cookie('bios_session',signed,cookieOptions(req));res.json({success:true,mustChange:!!user.mustChange,username:user.username});
}));
app.get('/api/me',authenticate,(req,res)=>res.json({username:req.user.username,mustChange:!!req.user.mustChange}));
app.post('/api/logout',authenticate,asyncRoute(async(req,res)=>{await mutate(()=>store.run('UPDATE users SET authVersion=authVersion+1 WHERE username=?',[req.user.username]));res.clearCookie('bios_session',{...cookieOptions(req),maxAge:undefined});res.json({success:true});}));
app.put('/api/admin/credentials',authenticate,asyncRoute(async(req,res)=>{
 const currentUsername=text(req.body.currentUsername,80), newUsername=text(req.body.newUsername,80);
 const password=req.body.newPassword;
 if(currentUsername!==req.user.username||!newUsername||!strongPassword(password))fail('Use um usuário válido e uma senha de 12 a 72 bytes (mínimo de 12 caracteres).');
 await mutate(async()=>{
  const user=await store.get('SELECT * FROM users WHERE username=?',[req.user.username]);
  if(!await bcrypt.compare(String(req.body.currentPassword||''),user.password))fail('Senha atual incorreta.',401);
  if(await bcrypt.compare(password,user.password))fail('Escolha uma senha diferente da atual.');
  await store.run('UPDATE users SET username=?, password=?,authVersion=authVersion+1,mustChange=0 WHERE username=?',[newUsername,await bcrypt.hash(password,12),req.user.username]);
 });
 res.clearCookie('bios_session',{...cookieOptions(req),maxAge:undefined});res.json({success:true});
}));
// The old public checkout must not create orders or accept browser-supplied prices.
app.post('/api/bookings',(req,res)=>res.status(410).json({error:'Solicite avaliação e orçamento pelo WhatsApp.'}));
app.get('/api/os/:code',trackingLimiter,(req,res)=>res.status(410).json({error:'Use o link exclusivo enviado pela Bios.'}));
app.get('/api/tracking/:token',trackingLimiter,asyncRoute(async(req,res)=>{
 const key=req.params.token;if(!/^[a-f0-9]{64}$/.test(key))fail('Link de acompanhamento inválido.',404);
 const order=await store.get('SELECT id,publicCode,device,status,created,updated,dueDate,value,quoteVersion,quoteDescription,quoteEnabled,approvedVersion,quoteId FROM orders WHERE trackingToken=?',[key]);
 if(!order){
  const quote=await store.get('SELECT id,publicCode,trackingToken FROM quotes WHERE trackingToken=?',[key]);
  if(quote)return res.json({isQuote:true,publicCode:quote.publicCode,trackingToken:quote.trackingToken});
  fail('Link de acompanhamento inválido.',404);
 }
 const history=await store.all('SELECT status,created FROM order_events WHERE orderId=? ORDER BY id DESC LIMIT 30',[order.id]);
 let linkedQuote=null;
 if(order.quoteId){
  const q=await store.get('SELECT publicCode,title,partsTotal,servicesTotal,total,version,status,approvedVersion FROM quotes WHERE id=?',[order.quoteId]);
  if(q){
   const items=await store.all('SELECT type,name,quantity,unitPrice,subtotal FROM quote_items WHERE quoteId=? ORDER BY position ASC',[order.quoteId]);
   linkedQuote={publicCode:q.publicCode,title:q.title,partsTotal:q.partsTotal,servicesTotal:q.servicesTotal,total:q.total,items};
  }
 }
 res.json({publicCode:order.publicCode,device:order.device,status:order.status,statusLabel:LABELS[order.status]||'Em acompanhamento',created:order.created,updated:order.updated,estimate:order.dueDate,history:history.map(x=>({status:LABELS[x.status]||'Atualizado',created:x.created})),quote:order.quoteEnabled?{version:order.quoteVersion,description:order.quoteDescription,value:order.value,approved:order.approvedVersion===order.quoteVersion}:null,linkedQuote});
}));
app.post('/api/tracking/:token/approve',trackingLimiter,asyncRoute(async(req,res)=>{
 if(!/^[a-f0-9]{64}$/.test(req.params.token)||req.body.accepted!==true||!Number.isInteger(req.body.version))fail('Confirme a leitura do orçamento.');
 const result=await mutate(()=>transaction(async()=>{
  const o=await store.get('SELECT * FROM orders WHERE trackingToken=?',[req.params.token]);
  if(!o)fail('Link inválido.',404);
  if(!o.quoteEnabled||o.quoteVersion!==req.body.version||o.status!=='aguardando_aprovacao')fail('O orçamento mudou ou não está disponível para aprovação. Atualize a página.',409);
  if(o.approvedVersion===o.quoteVersion)return {success:true};
  const stamp=now();
  await store.run('INSERT INTO approvals(orderId,version,value,description,created) VALUES(?,?,?,?,?)',[o.id,o.quoteVersion,o.value,o.quoteDescription,stamp]);
  await store.run('UPDATE orders SET approvedVersion=?,updated=? WHERE id=?',[o.quoteVersion,stamp,o.id]);
  return {success:true};
 }));res.json(result);
}));
app.get('/api/proposta/:token',trackingLimiter,asyncRoute(async(req,res)=>{
 const key=req.params.token;if(!/^[a-f0-9]{64}$/.test(key))fail('Link de proposta inválido.',404);
 const q=await store.get('SELECT q.*,c.name AS clientName FROM quotes q LEFT JOIN clients c ON c.id=q.clientId WHERE q.trackingToken=?',[key]);
 if(!q)fail('Proposta não encontrada ou link expirado.',404);
 const items=await store.all('SELECT type,name,details,quantity,unitPrice,subtotal FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[q.id]);
 const settingsRows=await store.all('SELECT key,value FROM company_settings');
 const settings=Object.fromEntries(settingsRows.map(r=>[r.key,r.value]));
 res.json({
  publicCode:q.publicCode,
  title:q.title,
  device:q.device,
  status:q.status,
  statusLabel:QUOTE_STATUS_LABELS[q.status]||'Em análise',
  version:q.version,
  approved:q.approvedVersion===q.version,
  approvedVersion:q.approvedVersion,
  created:q.created,
  updated:q.updated,
  validUntil:q.validUntil,
  paymentTerms:q.paymentTerms,
  deliveryTime:q.deliveryTime,
  notes:q.notes,
  client:{name:q.clientName||'Cliente'},
  items,
  totals:{
   partsTotal:q.partsTotal,
   servicesTotal:q.servicesTotal,
   customTotal:q.customTotal,
   shippingTotal:q.shippingTotal,
   discountTotal:q.discountTotal,
   total:q.total
  },
  company:{
   name:settings.company_name||'Bios Informática',
   tradeName:settings.trade_name||'Manutenção de Computadores & Notebooks',
   phone:settings.phone||'(13) 99622-2130',
   whatsapp:settings.whatsapp||'5513996222130',
   email:settings.email||'contato@biosinformatica.store',
   address:settings.address||'Santos e Guarujá - SP',
   warrantyTerms:settings.warranty_terms,
   city:settings.city||'',
   state:settings.state||'',
   logoUrl:settings.logo_url||'/assets/brand/chronos-bios.png'
  }
 });
}));
app.post('/api/proposta/:token/approve',trackingLimiter,asyncRoute(async(req,res)=>{
 const key=req.params.token;
 if(!/^[a-f0-9]{64}$/.test(key)||req.body.accepted!==true||!Number.isInteger(req.body.version))fail('Confirme a aprovação da proposta.');
 const result=await mutate(()=>transaction(async()=>{
  const q=await store.get('SELECT * FROM quotes WHERE trackingToken=?',[key]);
  if(!q)fail('Proposta não encontrada.',404);
  if(q.version!==req.body.version)fail('A proposta foi atualizada. Recarregue a página para conferir a versão mais recente.',409);
  if(['rejeitado'].includes(q.status))fail('Esta proposta não está disponível para aprovação.',409);
  if(q.approvedVersion===q.version)return {success:true,alreadyApproved:true};
  const stamp=now();
  const items=await store.all('SELECT type,name,details,quantity,unitPrice,subtotal FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[q.id]);
  await store.run('INSERT INTO quote_approvals(quoteId,version,total,summary,itemsSnapshot,created,ip) VALUES(?,?,?,?,?,?,?)',[
   q.id,q.version,q.total,q.title,JSON.stringify(items),stamp,req.ip||''
  ]);
  await store.run('UPDATE quotes SET approvedVersion=?,status=?,updated=? WHERE id=?',[q.version,'aprovado',stamp,q.id]);
  if(q.orderId){
   await store.run('UPDATE orders SET approvedVersion=?,status=CASE WHEN status IN (\'aguardando_aprovacao\',\'recebido\',\'analise\') THEN \'aguardando\' ELSE status END,updated=? WHERE id=?',[q.version,stamp,q.orderId]);
   await store.run('INSERT INTO order_events(orderId,status,created,actor) VALUES(?,?,?,?)',[q.orderId,'aguardando',stamp,'Aprovação de Proposta Online']);
  }
  return {success:true};
 }));
 res.json(result);
}));
app.use(['/api/clients','/api/services','/api/orders','/api/parts','/api/quotes','/api/company-settings'],authenticate);
app.get('/api/clients',asyncRoute(async(req,res)=>res.json(await store.all('SELECT * FROM clients ORDER BY name'))));
function clientInput(b){const name=text(b.name,100),phone=text(b.phone,25);if(!name||phone.replace(/\D/g,'').length<10)fail('Informe nome e telefone com DDD.');return [name,phone,text(b.email,150),text(b.doc,30),text(b.city,100),text(b.neighborhood,100),text(b.address,300),text(b.obs,2000)];}
app.post('/api/clients',asyncRoute(async(req,res)=>{const id='c_'+crypto.randomUUID().replace(/-/g,'');const fields=clientInput(req.body);await mutate(()=>store.run('INSERT INTO clients(id,name,phone,email,doc,city,neighborhood,address,obs,created) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,...fields,now()]));res.status(201).json({success:true,id});}));
app.put('/api/clients/:id',asyncRoute(async(req,res)=>{const fields=clientInput(req.body);const r=await mutate(()=>store.run('UPDATE clients SET name=?,phone=?,email=?,doc=?,city=?,neighborhood=?,address=?,obs=? WHERE id=?',[...fields,safeId(req.params.id)]));if(!r.changes)fail('Cliente não encontrado.',404);res.json({success:true});}));
app.delete('/api/clients/:id',asyncRoute(async(req,res)=>{await mutate(()=>store.run('DELETE FROM clients WHERE id=?',[safeId(req.params.id)]));res.json({success:true});}));
app.get('/api/services',asyncRoute(async(req,res)=>res.json(await store.all('SELECT * FROM services ORDER BY name'))));
function serviceInput(b){const name=text(b.name,120),category=text(b.category,60);if(!name||!category)fail('Informe nome e categoria.');return [name,category,money(b.price),text(b.desc,2000)];}
app.post('/api/services',asyncRoute(async(req,res)=>{const id='s_'+crypto.randomUUID().replace(/-/g,'');const fields=serviceInput(req.body);await mutate(()=>store.run('INSERT INTO services(id,name,category,price,desc) VALUES(?,?,?,?,?)',[id,...fields]));res.status(201).json({success:true,id});}));
app.put('/api/services/:id',asyncRoute(async(req,res)=>{const fields=serviceInput(req.body);const r=await mutate(()=>store.run('UPDATE services SET name=?,category=?,price=?,desc=? WHERE id=?',[...fields,safeId(req.params.id)]));if(!r.changes)fail('Serviço não encontrado.',404);res.json({success:true});}));
app.delete('/api/services/:id',asyncRoute(async(req,res)=>{await mutate(()=>store.run('DELETE FROM services WHERE id=?',[safeId(req.params.id)]));res.json({success:true});}));
app.get('/api/orders',asyncRoute(async(req,res)=>res.json(await store.all('SELECT o.*,c.name AS clientName,c.phone AS clientPhone,c.email AS clientEmail,s.name AS serviceName FROM orders o LEFT JOIN clients c ON c.id=o.clientId LEFT JOIN services s ON s.id=o.serviceId ORDER BY o.created DESC'))));
function orderInput(b){
 const clientId=safeId(b.clientId),serviceId=safeId(b.serviceId),device=text(b.device,200),status=text(b.status||'recebido',40),payStatus=text(b.payStatus||'pendente',30);
 if(!device||!STATUS.includes(status)||!['pendente','pago','cancelado'].includes(payStatus))fail('Equipamento ou status inválido.');
 return {clientId,device,brand:text(b.brand,100),serviceId,status,value:money(b.value),problem:text(b.problem,4000),solution:text(b.solution,4000),payStatus,payMethod:text(b.payMethod,50),dueDate:date(b.dueDate),payDate:date(b.payDate),payObs:text(b.payObs,2000)};
}
const ORDER_FIELDS=['clientId','device','brand','serviceId','status','value','problem','solution','payStatus','payMethod','dueDate','payDate','payObs'];
app.post('/api/orders',asyncRoute(async(req,res)=>{
 const input=orderInput(req.body);
 const result=await mutate(()=>transaction(async()=>{
  const sequence=await store.get('SELECT value FROM counters WHERE name=?'+(store.isPostgres?' FOR UPDATE':''),['order']);
  const n=(sequence?.value||0)+1;await store.run('UPDATE counters SET value=? WHERE name=?',[n,'order']);const id='OS'+String(n).padStart(3,'0');const stamp=now();
  let publicCode;
  for(let attempt=0;attempt<5;attempt++){
   const candidate=generatePublicCode();
   const existing=await store.get('SELECT id FROM orders WHERE publicCode=?',[candidate]);
   if(!existing){publicCode=candidate;break;}
  }
  if(!publicCode)fail('Erro ao gerar código da OS.',500);
  await store.run(`INSERT INTO orders(id,publicCode,${ORDER_FIELDS.join(',')},created,updated,trackingToken) VALUES(${Array(18).fill('?').join(',')})`,[id,publicCode,...ORDER_FIELDS.map(k=>input[k]),stamp,stamp,token()]);
  await store.run('INSERT INTO order_events(orderId,status,created,actor) VALUES(?,?,?,?)',[id,input.status,stamp,req.user.username]);return {id,publicCode};
 }));res.status(201).json({success:true,id:result.id,publicCode:result.publicCode});
}));
app.put('/api/orders/:id',asyncRoute(async(req,res)=>{
 const input=orderInput(req.body);const id=safeId(req.params.id);
 await mutate(()=>transaction(async()=>{
  const old=await store.get('SELECT * FROM orders WHERE id=?',[id]);if(!old)fail('OS não encontrada.',404);
  // Financial status updates cannot silently change an already shared quote.
  const changed=Number(old.value)!==input.value||old.serviceId!==input.serviceId;
  await store.run(`UPDATE orders SET ${ORDER_FIELDS.map(k=>k+'=?').join(',')},updated=?,quoteVersion=quoteVersion+?,approvedVersion=CASE WHEN ?=1 THEN NULL ELSE approvedVersion END,quoteEnabled=CASE WHEN ?=1 THEN 0 ELSE quoteEnabled END WHERE id=?`,[...ORDER_FIELDS.map(k=>input[k]),now(),changed?1:0,changed?1:0,changed?1:0,id]);
  if(old.status!==input.status)await store.run('INSERT INTO order_events(orderId,status,created,actor) VALUES(?,?,?,?)',[id,input.status,now(),req.user.username]);
 }));res.json({success:true});
}));
app.delete('/api/orders/:id',asyncRoute(async(req,res)=>{await mutate(()=>transaction(async()=>{const id=safeId(req.params.id);await store.run('DELETE FROM approvals WHERE orderId=?',[id]);await store.run('DELETE FROM order_events WHERE orderId=?',[id]);await store.run('DELETE FROM orders WHERE id=?',[id]);}));res.json({success:true});}));
app.put('/api/orders/:id/quote',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id),description=text(req.body.description,4000),value=money(req.body.value);if(!description)fail('Descreva serviços, peças e condições do orçamento.');
 await mutate(()=>transaction(async()=>{const o=await store.get('SELECT * FROM orders WHERE id=?',[id]);if(!o)fail('OS não encontrada.',404);if(['entregue','cancelado'].includes(o.status))fail('Reabra a OS antes de enviar um orçamento.',409);const stamp=now();await store.run("UPDATE orders SET value=?,quoteDescription=?,quoteVersion=quoteVersion+1,quoteEnabled=1,approvedVersion=NULL,status='aguardando_aprovacao',updated=? WHERE id=?",[value,description,stamp,id]);await store.run("INSERT INTO order_events(orderId,status,created,actor) VALUES(?,'aguardando_aprovacao',?,?)",[id,stamp,req.user.username]);}));res.json({success:true});
}));
app.post('/api/orders/:id/rotate-link',asyncRoute(async(req,res)=>{await mutate(()=>store.run('UPDATE orders SET trackingToken=? WHERE id=?',[token(),safeId(req.params.id)]));res.json({success:true});}));
app.get('/api/orders/:id/history',asyncRoute(async(req,res)=>{const id=safeId(req.params.id);res.json({events:await store.all('SELECT status,created,actor FROM order_events WHERE orderId=? ORDER BY id DESC',[id]),approvals:await store.all('SELECT version,value,description,created FROM approvals WHERE orderId=? ORDER BY id DESC',[id])});}));

// Parts API
app.get('/api/parts',asyncRoute(async(req,res)=>{
 const q=text(req.query.q||'',100).toLowerCase();
 const activeOnly=req.query.active==='1';
 const category=text(req.query.category||'',60);
 const status=text(req.query.status||'',40);
 let sql='SELECT * FROM parts WHERE 1=1';
 const params=[];
 if(activeOnly){sql+=' AND active=1';}
 if(category){sql+=' AND category=?';params.push(category);}
 if(status){sql+=' AND status=?';params.push(status);}
 if(q){
  sql+=' AND (LOWER(model) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(category) LIKE ? OR LOWER(specs) LIKE ? OR LOWER(supplier) LIKE ?)';
  const term=`%${q}%`;
  params.push(term,term,term,term,term,term);
 }
 sql+=' ORDER BY active DESC, category ASC, brand ASC, model ASC';
 res.json(await store.all(sql,params));
}));
app.post('/api/parts',asyncRoute(async(req,res)=>{
 const id='p_'+crypto.randomUUID().replace(/-/g,'');
 const fields=partInput(req.body);
 const stamp=now();
 await mutate(()=>store.run(
  'INSERT INTO parts(id,category,brand,model,sku,specs,supplier,cost,price,status,active,notes,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  [id,fields.category,fields.brand,fields.model,fields.sku,fields.specs,fields.supplier,fields.cost,fields.price,fields.status,fields.active,fields.notes,stamp,stamp]
 ));
 res.status(201).json({success:true,id});
}));
app.put('/api/parts/:id',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const fields=partInput(req.body);
 const stamp=now();
 const r=await mutate(()=>store.run(
  'UPDATE parts SET category=?,brand=?,model=?,sku=?,specs=?,supplier=?,cost=?,price=?,status=?,active=?,notes=?,updated=? WHERE id=?',
  [fields.category,fields.brand,fields.model,fields.sku,fields.specs,fields.supplier,fields.cost,fields.price,fields.status,fields.active,fields.notes,stamp,id]
 ));
 if(!r.changes)fail('Peça não encontrada.',404);
 res.json({success:true});
}));
app.delete('/api/parts/:id',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 await mutate(()=>store.run('UPDATE parts SET active=0,updated=? WHERE id=?',[now(),id]));
 res.json({success:true});
}));
app.post('/api/parts/:id/toggle',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const r=await mutate(()=>store.run('UPDATE parts SET active=CASE WHEN active=1 THEN 0 ELSE 1 END,updated=? WHERE id=?',[now(),id]));
 if(!r.changes)fail('Peça não encontrada.',404);
 res.json({success:true});
}));

// Quotes API
const QUOTE_COLS=['clientId','orderId','title','device','status','partsTotal','servicesTotal','customTotal','shippingTotal','discountTotal','total','totalCost','profit','profitMargin','validUntil','paymentTerms','deliveryTime','notes','internalNotes'];

app.get('/api/quotes',asyncRoute(async(req,res)=>{
 const sql=`SELECT q.*,c.name AS clientName,c.phone AS clientPhone,c.email AS clientEmail,o.publicCode AS orderPublicCode
  FROM quotes q
  LEFT JOIN clients c ON c.id=q.clientId
  LEFT JOIN orders o ON o.id=q.orderId
  ORDER BY q.created DESC`;
 res.json(await store.all(sql));
}));
app.get('/api/quotes/:id',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const q=await store.get(`SELECT q.*,c.name AS clientName,c.phone AS clientPhone,c.email AS clientEmail,c.doc AS clientDoc,c.city AS clientCity,c.neighborhood AS clientNeighborhood,c.address AS clientAddress,o.publicCode AS orderPublicCode
  FROM quotes q
  LEFT JOIN clients c ON c.id=q.clientId
  LEFT JOIN orders o ON o.id=q.orderId
  WHERE q.id=?`,[id]);
 if(!q)fail('Orçamento não encontrado.',404);
 const items=await store.all('SELECT * FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[id]);
 const approvals=await store.all('SELECT * FROM quote_approvals WHERE quoteId=? ORDER BY id DESC',[id]);
 const versions=await store.all('SELECT * FROM quote_versions WHERE quoteId=? ORDER BY version DESC',[id]);
 res.json({...q,items,approvals,versions});
}));
app.post('/api/quotes',asyncRoute(async(req,res)=>{
 const input=quoteInput(req.body);
 const id='q_'+crypto.randomUUID().replace(/-/g,'');
 const stamp=now();
 const publicCode=generateQuotePublicCode();
 const trackingToken=token();

 await mutate(()=>transaction(async()=>{
  await store.run(
   `INSERT INTO quotes(id,publicCode,trackingToken,${QUOTE_COLS.join(',')},version,approvedVersion,created,updated)
    VALUES(?,?,?,${Array(QUOTE_COLS.length).fill('?').join(',')},1,NULL,?,?)`,
   [id,publicCode,trackingToken,...QUOTE_COLS.map(k=>input[k]),stamp,stamp]
  );
  for(const it of input.items){
   await store.run(
    'INSERT INTO quote_items(id,quoteId,type,itemId,name,details,quantity,unitCost,unitPrice,subtotal,costSubtotal,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [it.id,id,it.type,it.itemId,it.name,it.details,it.quantity,it.unitCost,it.unitPrice,it.subtotal,it.costSubtotal,it.position]
   );
  }
  if(input.orderId){
   await store.run('UPDATE orders SET quoteId=?,value=CASE WHEN ?>0 THEN ? ELSE value END,updated=? WHERE id=?',[id,input.total,input.total,stamp,input.orderId]);
  }
 }));

 res.status(201).json({success:true,id,publicCode,trackingToken});
}));
app.put('/api/quotes/:id',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const input=quoteInput(req.body);
 const stamp=now();

 const result=await mutate(()=>transaction(async()=>{
  const old=await store.get('SELECT * FROM quotes WHERE id=?'+(store.isPostgres?' FOR UPDATE':''),[id]);
  if(!old)fail('Orçamento não encontrado.',404);

  let newVersion=old.version;
  let newApprovedVersion=old.approvedVersion;
  let newStatus=input.status;
  const wasSentOrApproved=isQuoteSentOrApproved(old.status,old.approvedVersion);

  if(wasSentOrApproved){
   const oldItems=await store.all('SELECT type,itemId,name,details,quantity,unitCost,unitPrice,subtotal,costSubtotal,position FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[id]);
   await store.run('INSERT INTO quote_versions(quoteId,version,status,total,summary,itemsSnapshot,created) VALUES(?,?,?,?,?,?,?)',[
    id,old.version,old.status,old.total,old.title,JSON.stringify(oldItems),stamp
   ]);
   newVersion=old.version+1;
   newApprovedVersion=null;
   newStatus='aguardando_aprovacao';
  }

  await store.run(
   `UPDATE quotes SET ${QUOTE_COLS.map(k=>k+'=?').join(',')},version=?,approvedVersion=?,updated=? WHERE id=?`,
   [...QUOTE_COLS.map(k=>k==='status'?newStatus:input[k]),newVersion,newApprovedVersion,stamp,id]
  );

  await store.run('DELETE FROM quote_items WHERE quoteId=?',[id]);
  for(const it of input.items){
   await store.run(
    'INSERT INTO quote_items(id,quoteId,type,itemId,name,details,quantity,unitCost,unitPrice,subtotal,costSubtotal,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [it.id,id,it.type,it.itemId,it.name,it.details,it.quantity,it.unitCost,it.unitPrice,it.subtotal,it.costSubtotal,it.position]
   );
  }

  if(input.orderId){
   await store.run('UPDATE orders SET quoteId=?,value=CASE WHEN ?>0 THEN ? ELSE value END,quoteVersion=?,approvedVersion=?,updated=? WHERE id=?',[id,input.total,input.total,newVersion,newApprovedVersion,stamp,input.orderId]);
  }

  return {success:true,version:newVersion,requiresNewApproval:wasSentOrApproved};
 }));

 res.json(result);
}));
app.post('/api/quotes/:id/duplicate',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const result=await mutate(()=>transaction(async()=>{
  const orig=await store.get('SELECT * FROM quotes WHERE id=?'+(store.isPostgres?' FOR UPDATE':''),[id]);
  if(!orig)fail('Orçamento de origem não encontrado.',404);
  const items=await store.all('SELECT * FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[id]);
  const newId='q_'+crypto.randomUUID().replace(/-/g,'');
  const newPublicCode=generateQuotePublicCode();
  const newTrackingToken=token();
  const stamp=now();
  const newTitle=text(req.body.title||`[Opção Alternativa] ${orig.title}`,180);

  await store.run(
   `INSERT INTO quotes(id,publicCode,trackingToken,clientId,orderId,title,device,status,partsTotal,servicesTotal,customTotal,shippingTotal,discountTotal,total,totalCost,profit,profitMargin,version,approvedVersion,validUntil,paymentTerms,deliveryTime,notes,internalNotes,created,updated)
    VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,?,?,?,?,?,?,?)`,
   [newId,newPublicCode,newTrackingToken,orig.clientId,newTitle,orig.device,'rascunho',orig.partsTotal,orig.servicesTotal,orig.customTotal,orig.shippingTotal,orig.discountTotal,orig.total,orig.totalCost,orig.profit,orig.profitMargin,orig.validUntil,orig.paymentTerms,orig.deliveryTime,orig.notes,orig.internalNotes,stamp,stamp]
  );

  for(const it of items){
   const newItemId='qi_'+crypto.randomUUID().replace(/-/g,'');
   await store.run(
    'INSERT INTO quote_items(id,quoteId,type,itemId,name,details,quantity,unitCost,unitPrice,subtotal,costSubtotal,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [newItemId,newId,it.type,it.itemId,it.name,it.details,it.quantity,it.unitCost,it.unitPrice,it.subtotal,it.costSubtotal,it.position]
   );
  }

  return {success:true,id:newId,publicCode:newPublicCode,trackingToken:newTrackingToken};
 }));

 res.status(201).json(result);
}));
app.post('/api/quotes/:id/convert-to-os',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const result=await mutate(()=>transaction(async()=>{
  const q=await store.get('SELECT * FROM quotes WHERE id=?'+(store.isPostgres?' FOR UPDATE':''),[id]);
  if(!q)fail('Orçamento não encontrado.',404);

  // Idempotência: se já vinculado, retorna a OS existente
  if(q.orderId){
   const existingOrder = await store.get('SELECT id, publicCode FROM orders WHERE id=?',[q.orderId]);
   return {success:true,orderId:q.orderId,publicCode:existingOrder?.publicCode||'',alreadyConverted:true};
  }
  const existingByQuote = await store.get('SELECT id, publicCode FROM orders WHERE quoteId=?',[id]);
  if(existingByQuote){
   await store.run('UPDATE quotes SET orderId=?,status=? WHERE id=?',[existingByQuote.id,'convertido_os',id]);
   return {success:true,orderId:existingByQuote.id,publicCode:existingByQuote.publicCode,alreadyConverted:true};
  }

  if(!q.clientId)fail('Selecione ou vincule um cliente antes de converter em OS.',400);

  const client=await store.get('SELECT * FROM clients WHERE id=?',[q.clientId]);
  if(!client)fail('Cliente vinculado não encontrado.',404);

  let service=await store.get('SELECT id FROM services ORDER BY id ASC LIMIT 1');
  if(!service){
   const newServiceId='s_'+crypto.randomUUID().replace(/-/g,'');
   await store.run('INSERT INTO services(id,name,category,price,desc) VALUES(?,?,?,?,?)',[newServiceId,'Montagem e Configuração','Computadores',q.servicesTotal||150,'Montagem, instalação e testes de hardware']);
   service={id:newServiceId};
  }

  const sequence=await store.get('SELECT value FROM counters WHERE name=?'+(store.isPostgres?' FOR UPDATE':''),['order']);
  const n=(sequence?.value||0)+1;
  await store.run('UPDATE counters SET value=? WHERE name=?',[n,'order']);
  const orderId='OS'+String(n).padStart(3,'0');
  const stamp=now();

  let publicCode;
  for(let attempt=0;attempt<5;attempt++){
   const candidate=generatePublicCode();
   const existing=await store.get('SELECT id FROM orders WHERE publicCode=?',[candidate]);
   if(!existing){publicCode=candidate;break;}
  }
  if(!publicCode)fail('Erro ao gerar código da OS.',500);

  const initialStatus=q.approvedVersion?'aguardando':'aguardando_aprovacao';
  const problem=text(q.title+(q.device?` · ${q.device}`:''),4000);
  const items=await store.all('SELECT name,quantity,unitPrice,subtotal FROM quote_items WHERE quoteId=? ORDER BY position ASC',[id]);
  const solutionText=items.map(it=>`${it.quantity}x ${it.name} (R$ ${money(it.subtotal)})`).join('\n');

  await store.run(
   `INSERT INTO orders(id,publicCode,clientId,device,brand,serviceId,status,value,problem,solution,payStatus,payMethod,dueDate,payDate,payObs,created,updated,trackingToken,quoteVersion,quoteDescription,quoteEnabled,approvedVersion,quoteId)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
   [
    orderId,publicCode,q.clientId,q.device||'Computador / Peças',
    'Bios Montagem',service.id,initialStatus,q.total,
    problem,solutionText,'pendente',q.paymentTerms||'',
    q.validUntil||'','','Orçamento convertido',
    stamp,stamp,token(),
    q.version,problem,1,q.approvedVersion,id
   ]
  );

  await store.run('INSERT INTO order_events(orderId,status,created,actor) VALUES(?,?,?,?)',[orderId,initialStatus,stamp,req.user.username]);
  await store.run('UPDATE quotes SET orderId=?,status=?,updated=? WHERE id=?',[orderId,'convertido_os',stamp,id]);

  return {success:true,orderId,publicCode,alreadyConverted:false};
 }));

 res.status(result.alreadyConverted ? 200 : 201).json(result);
}));
app.post('/api/quotes/:id/rotate-link',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const newToken=token();
 const r=await mutate(()=>store.run('UPDATE quotes SET trackingToken=?,updated=? WHERE id=?',[newToken,now(),id]));
 if(!r.changes)fail('Orçamento não encontrado.',404);
 res.json({success:true,trackingToken:newToken});
}));
app.delete('/api/quotes/:id',asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 await mutate(()=>transaction(async()=>{
  await store.run('DELETE FROM quote_approvals WHERE quoteId=?',[id]);
  await store.run('DELETE FROM quote_items WHERE quoteId=?',[id]);
  await store.run('UPDATE orders SET quoteId=NULL WHERE quoteId=?',[id]);
  await store.run('DELETE FROM quotes WHERE id=?',[id]);
 }));
 res.json({success:true});
}));

// Company Settings API
app.get('/api/company-settings',asyncRoute(async(req,res)=>{
 const rows=await store.all('SELECT key,value FROM company_settings');
 const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
 res.json(settings);
}));
app.put('/api/company-settings',asyncRoute(async(req,res)=>{
 const allowedKeys=[
  'company_name','trade_name','phone','whatsapp','email','address','city','state',
  'warranty_terms','default_validity_days','default_payment_terms','default_delivery_time','logo_url'
 ];
 await mutate(()=>transaction(async()=>{
  for(const [k,v] of Object.entries(req.body||{})){
   if(allowedKeys.includes(k)&&typeof v==='string'){
    await store.run('INSERT INTO company_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[k,text(v,4000)]);
   }
  }
 }));
 res.json({success:true});
}));

// Suppliers & Pricing Monitor API
app.get('/api/suppliers',authenticate,asyncRoute(async(req,res)=>{
 const rows=await store.all('SELECT * FROM suppliers ORDER BY id ASC');
 res.json(rows);
}));
app.patch('/api/suppliers/:id',authenticate,asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const {status}=req.body||{};
 const validStatuses=['ativo','inativo','integracao_pendente'];
 if(!validStatuses.includes(status))fail('Status de fornecedor inválido.');
 const r=await mutate(()=>store.run('UPDATE suppliers SET status=?,updated=? WHERE id=?',[status,now(),id]));
 if(!r.changes)fail('Fornecedor não encontrado.',404);
 res.json({success:true});
}));
app.post('/api/suppliers/preview-url',authenticate,asyncRoute(async(req,res)=>{
 const rawUrl=typeof req.body?.url==='string'?req.body.url.trim():'';
 if(!rawUrl)fail('Informe a URL do produto na KaBuM!, Pichau ou Terabyte.');
 const preview=await fetchSupplierPreview(rawUrl);
 let matchedPart=null;
 if(preview.ean||preview.storeSku||preview.manufacturerCode){
  const matchSql=`SELECT id,category,brand,model,sku,cost,price FROM parts WHERE active=1 AND (
   (sku IS NOT NULL AND sku!='' AND (sku=? OR sku=? OR sku=?))
  ) LIMIT 1`;
  matchedPart=await store.get(matchSql,[preview.ean||'',preview.storeSku||'',preview.manufacturerCode||'']);
 }
 res.json({preview,matchedPart});
}));
app.get('/api/suppliers/search',authenticate,asyncRoute(async(req,res)=>{
 const q=typeof req.query.q==='string'?req.query.q.trim():'';
 if(!q)fail('Informe o termo de busca.');
 const supplier=typeof req.query.supplier==='string'?req.query.supplier.trim():'all';
 const limit=Math.min(Math.max(parseInt(req.query.limit,10)||6,1),15);
 const searchResult=await searchStoreProducts(q,{supplier,limit});
 res.json(searchResult);
}));
app.post('/api/suppliers/import-batch',authenticate,asyncRoute(async(req,res)=>{
 const items=Array.isArray(req.body?.items)?req.body.items:[];
 if(!items.length)fail('Nenhum item informado para importação.');
 let imported=0;
 let updated=0;
 let skipped=0;
 const stamp=now();

 for(const it of items){
  if(!it.title||!it.url||!it.supplier){
   skipped++;
   continue;
  }
  try{
   await validateUrlSecurity(it.url);
  }catch{
   skipped++;
   continue;
  }

  // Deduplicação confiável por URL ou (supplierId + storeSku)
  let existing=await store.get('SELECT id FROM supplier_offers WHERE url=?',[it.url]);
  if(!existing&&it.storeSku){
   existing=await store.get('SELECT id FROM supplier_offers WHERE supplierId=? AND storeSku=?',[it.supplier,it.storeSku]);
  }

  // Tentar associar automaticamente à peça do catálogo por SKU/EAN/código
  let partId=it.partId?safeId(it.partId):null;
  if(!partId&&(it.storeSku||it.ean||it.manufacturerCode)){
   const matchPart=await store.get(
    `SELECT id FROM parts WHERE active=1 AND (
      (sku IS NOT NULL AND sku!='' AND (sku=? OR sku=? OR sku=?))
    ) LIMIT 1`,
    [it.ean||'',it.storeSku||'',it.manufacturerCode||'']
   );
   if(matchPart) partId=matchPart.id;
  }

  const pricePix=it.pricePix!==null&&it.pricePix!==undefined&&it.pricePix!==''?money(it.pricePix):null;
  const priceCard=it.priceCard!==null&&it.priceCard!==undefined&&it.priceCard!==''?money(it.priceCard):null;
  const shippingFee=it.shippingFee!==null&&it.shippingFee!==undefined&&it.shippingFee!==''?money(it.shippingFee):null;

  if(existing){
   await mutate(()=>store.run(
    `UPDATE supplier_offers SET
      partId=COALESCE(?,partId),
      title=?,pricePix=COALESCE(?,pricePix),
      priceCard=COALESCE(?,priceCard),
      cardInstallments=?,availability=?,seller=?,fulfillmentBy=?,
      shippingConsulted=?,shippingFee=?,lastChecked=?,isStale=0,updated=?
     WHERE id=?`,
    [
     partId,text(it.title,250),pricePix,priceCard,
     text(it.cardInstallments||'',100),
     ['em_estoque','esgotado','sob_consulta'].includes(it.availability)?it.availability:'em_estoque',
     text(it.seller||it.supplier,80),text(it.fulfillmentBy||it.supplier,80),
     it.shippingConsulted?1:0,shippingFee,stamp,stamp,existing.id
    ]
   ));
   updated++;
  }else{
   const id='so_'+crypto.randomUUID().replace(/-/g,'');
   await mutate(()=>store.run(
    `INSERT INTO supplier_offers(
      id,partId,supplierId,storeSku,ean,manufacturerCode,title,url,seller,fulfillmentBy,condition,pricePix,priceCard,cardInstallments,availability,shippingConsulted,shippingFee,lastChecked,isStale,autoSync,lastError,created,updated
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
     id,partId,it.supplier,
     text(it.storeSku||'',60),text(it.ean||'',60),text(it.manufacturerCode||'',60),
     text(it.title,250),it.url,text(it.seller||it.supplier,80),text(it.fulfillmentBy||it.supplier,80),
     ['novo','openbox','reembalado'].includes(it.condition)?it.condition:'novo',
     pricePix,priceCard,text(it.cardInstallments||'',100),
     ['em_estoque','esgotado','sob_consulta'].includes(it.availability)?it.availability:'em_estoque',
     it.shippingConsulted?1:0,shippingFee,
     stamp,0,1,null,stamp,stamp
    ]
   ));
   imported++;
  }
 }

 res.json({success:true,imported,updated,skipped,total:items.length});
}));
app.get('/api/supplier-offers',authenticate,asyncRoute(async(req,res)=>{
 const partId=req.query.partId?safeId(req.query.partId):null;
 const supplierId=req.query.supplierId?safeId(req.query.supplierId):null;
 let sql=`SELECT o.*, s.name AS supplierName, s.status AS supplierStatus, p.brand AS partBrand, p.model AS partModel, p.category AS partCategory, p.price AS partSellPrice, p.cost AS partCost
  FROM supplier_offers o
  LEFT JOIN suppliers s ON s.id=o.supplierId
  LEFT JOIN parts p ON p.id=o.partId
  WHERE 1=1`;
 const params=[];
 if(partId){sql+=' AND o.partId=?';params.push(partId);}
 if(supplierId){sql+=' AND o.supplierId=?';params.push(supplierId);}
 sql+=' ORDER BY o.updated DESC';
 res.json(await store.all(sql,params));
}));
app.post('/api/supplier-offers',authenticate,asyncRoute(async(req,res)=>{
 const b=req.body||{};
 const id='so_'+crypto.randomUUID().replace(/-/g,'');
 const partId=b.partId?safeId(b.partId):null;
 const supplierId=safeId(b.supplierId||'');
 const title=text(b.title||'',250);
 const url=text(b.url||'',1000);
 if(!supplierId||!title||!url)fail('Fornecedor, título e URL da oferta são obrigatórios.');
 await validateUrlSecurity(url);
 const pricePix=b.pricePix!==null&&b.pricePix!==undefined&&b.pricePix!==''?money(b.pricePix):null;
 const priceCard=b.priceCard!==null&&b.priceCard!==undefined&&b.priceCard!==''?money(b.priceCard):null;
 const stamp=now();
 await mutate(()=>store.run(
  `INSERT INTO supplier_offers(id,partId,supplierId,storeSku,ean,manufacturerCode,title,url,seller,fulfillmentBy,condition,pricePix,priceCard,cardInstallments,availability,shippingConsulted,shippingFee,lastChecked,isStale,autoSync,lastError,created,updated)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [
   id,partId,supplierId,
   text(b.storeSku||'',60),text(b.ean||'',60),text(b.manufacturerCode||'',60),
   title,url,text(b.seller||supplierId,80),text(b.fulfillmentBy||supplierId,80),
   ['novo','openbox','reembalado'].includes(b.condition)?b.condition:'novo',
   pricePix,priceCard,text(b.cardInstallments||'',100),
   ['em_estoque','esgotado','sob_consulta'].includes(b.availability)?b.availability:'em_estoque',
   b.shippingConsulted?1:0,b.shippingFee!==null&&b.shippingFee!==undefined&&b.shippingFee!==''?money(b.shippingFee):null,
   stamp,0,b.autoSync!==false?1:0,null,stamp,stamp
  ]
 ));
 res.status(201).json({success:true,id});
}));
app.put('/api/supplier-offers/:id',authenticate,asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const b=req.body||{};
 const partId=b.partId?safeId(b.partId):null;
 const title=text(b.title||'',250);
 const url=text(b.url||'',1000);
 if(!title||!url)fail('Título e URL da oferta são obrigatórios.');
 await validateUrlSecurity(url);
 const pricePix=b.pricePix!==null&&b.pricePix!==undefined&&b.pricePix!==''?money(b.pricePix):null;
 const priceCard=b.priceCard!==null&&b.priceCard!==undefined&&b.priceCard!==''?money(b.priceCard):null;
 const stamp=now();
 const r=await mutate(()=>store.run(
  `UPDATE supplier_offers SET partId=?,storeSku=?,ean=?,manufacturerCode=?,title=?,url=?,seller=?,fulfillmentBy=?,condition=?,pricePix=?,priceCard=?,cardInstallments=?,availability=?,shippingConsulted=?,shippingFee=?,autoSync=?,updated=? WHERE id=?`,
  [
   partId,text(b.storeSku||'',60),text(b.ean||'',60),text(b.manufacturerCode||'',60),
   title,url,text(b.seller||'',80),text(b.fulfillmentBy||'',80),
   ['novo','openbox','reembalado'].includes(b.condition)?b.condition:'novo',
   pricePix,priceCard,text(b.cardInstallments||'',100),
   ['em_estoque','esgotado','sob_consulta'].includes(b.availability)?b.availability:'em_estoque',
   b.shippingConsulted?1:0,b.shippingFee!==null&&b.shippingFee!==undefined&&b.shippingFee!==''?money(b.shippingFee):null,
   b.autoSync!==false?1:0,stamp,id
  ]
 ));
 if(!r.changes)fail('Oferta não encontrada.',404);
 res.json({success:true});
}));
app.post('/api/supplier-offers/:id/sync',authenticate,asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const offer=await store.get('SELECT o.*, s.status AS supplierStatus FROM supplier_offers o JOIN suppliers s ON s.id=o.supplierId WHERE o.id=?',[id]);
 if(!offer)fail('Oferta não encontrada.',404);
 if(offer.supplierStatus!=='ativo'){
  fail(`Fornecedor ${offer.supplierId} está inativo ou com integração pendente.`);
 }
 const stamp=now();
 try{
  const data=await fetchSupplierPreview(offer.url);
  await mutate(()=>store.run(
   `UPDATE supplier_offers SET title=CASE WHEN ?>'' THEN ? ELSE title END,
    pricePix=CASE WHEN ?>0 THEN ? ELSE pricePix END,
    priceCard=CASE WHEN ?>0 THEN ? ELSE priceCard END,
    cardInstallments=?,availability=?,seller=?,fulfillmentBy=?,
    lastChecked=?,isStale=0,lastError=NULL,updated=? WHERE id=?`,
   [
    data.title||'',data.title||'',
    data.pricePix||0,data.pricePix||0,
    data.priceCard||0,data.priceCard||0,
    data.cardInstallments||'',data.availability||'em_estoque',
    data.seller||offer.seller,data.fulfillmentBy||offer.fulfillmentBy,
    stamp,stamp,id
   ]
  ));
  res.json({success:true,data});
 }catch(err){
  await mutate(()=>store.run(
   'UPDATE supplier_offers SET isStale=1,lastError=?,updated=? WHERE id=?',
   [text(err.message,300),stamp,id]
  ));
  res.status(502).json({
   error:`Não foi possível atualizar: ${err.message}. O último preço registrado foi preservado e marcado como antigo.`,
   isStale:true
  });
 }
}));
app.delete('/api/supplier-offers/:id',authenticate,asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const r=await mutate(()=>store.run('DELETE FROM supplier_offers WHERE id=?',[id]));
 if(!r.changes)fail('Oferta não encontrada.',404);
 res.json({success:true});
}));
app.post('/api/quotes/:id/check-supplier-prices',authenticate,asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const q=await store.get('SELECT * FROM quotes WHERE id=?',[id]);
 if(!q)fail('Orçamento não encontrado.',404);
 const items=await store.all('SELECT * FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[id]);
 const comparisons=[];
 for(const it of items){
  let bestOffer=null;
  if(it.type==='peca'&&it.itemId){
   const offers=await store.all(
    `SELECT o.*, s.name AS supplierName FROM supplier_offers o
     JOIN suppliers s ON s.id=o.supplierId
     WHERE o.partId=? AND s.status='ativo'
        AND (o.isStale IS NULL OR o.isStale=0)
        AND o.availability IN ('em_estoque','disponivel')
        AND o.pricePix IS NOT NULL
     ORDER BY o.pricePix ASC LIMIT 1`,
    [it.itemId]
   );
   bestOffer=offers[0]||null;
  }
  comparisons.push({
   quoteItemId:it.id,
   itemName:it.name,
   currentUnitCost:it.unitCost,
   currentUnitPrice:it.unitPrice,
   quantity:it.quantity,
   subtotal:it.subtotal,
   supplierOffer:bestOffer?{
    id:bestOffer.id,
    supplierId:bestOffer.supplierId,
    supplierName:bestOffer.supplierName,
    pricePix:bestOffer.pricePix,
    priceCard:bestOffer.priceCard,
    lastChecked:bestOffer.lastChecked,
    isStale:bestOffer.isStale,
    url:bestOffer.url,
    suggestedCost:bestOffer.pricePix
   }:null,
   hasDiff:bestOffer?Math.abs(bestOffer.pricePix - it.unitCost)>0.01:false
  });
 }
 res.json({quoteId:id,version:q.version,comparisons});
}));
app.post('/api/quotes/:id/apply-supplier-prices',authenticate,asyncRoute(async(req,res)=>{
 const id=safeId(req.params.id);
 const updates=Array.isArray(req.body?.updates)?req.body.updates:[];
 if(updates.length===0)fail('Nenhuma alteração de preço informada.');
 const stamp=now();
 const result=await mutate(()=>transaction(async()=>{
  const q=await store.get('SELECT * FROM quotes WHERE id=?'+(store.isPostgres?' FOR UPDATE':''),[id]);
  if(!q)fail('Orçamento não encontrado.',404);
  const items=await store.all('SELECT * FROM quote_items WHERE quoteId=? ORDER BY position ASC,id ASC',[id]);
  const wasSentOrApproved=isQuoteSentOrApproved(q.status,q.approvedVersion);

  let newVersion=q.version;
  let newApprovedVersion=q.approvedVersion;
  let newStatus=q.status;

  if(wasSentOrApproved){
   await store.run(
    'INSERT INTO quote_versions(quoteId,version,status,total,summary,itemsSnapshot,created) VALUES(?,?,?,?,?,?,?)',
    [id,q.version,q.status,q.total,q.title,JSON.stringify(items),stamp]
   );
   newVersion=q.version+1;
   newApprovedVersion=null;
   newStatus='aguardando_aprovacao';
  }

  const updatedItems=items.map(it=>{
   const up=updates.find(u=>u.quoteItemId===it.id);
   if(up){
    const newCost=up.newUnitCost!==undefined?money(up.newUnitCost):it.unitCost;
    const newPrice=up.newUnitPrice!==undefined?money(up.newUnitPrice):it.unitPrice;
    return {...it,unitCost:newCost,unitPrice:newPrice};
   }
   return it;
  });

  const financials=calculateQuoteFinancials(updatedItems,q.shippingTotal,q.discountTotal);

  await store.run(
   `UPDATE quotes SET partsTotal=?,servicesTotal=?,customTotal=?,shippingTotal=?,discountTotal=?,total=?,totalCost=?,profit=?,profitMargin=?,version=?,approvedVersion=?,status=?,updated=? WHERE id=?`,
   [financials.partsTotal,financials.servicesTotal,financials.customTotal,financials.shippingTotal,financials.discountTotal,financials.total,financials.totalCost,financials.profit,financials.profitMargin,newVersion,newApprovedVersion,newStatus,stamp,id]
  );

  await store.run('DELETE FROM quote_items WHERE quoteId=?',[id]);
  for(const it of financials.items){
   await store.run(
    'INSERT INTO quote_items(id,quoteId,type,itemId,name,details,quantity,unitCost,unitPrice,subtotal,costSubtotal,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [it.id,id,it.type,it.itemId,it.name,it.details,it.quantity,it.unitCost,it.unitPrice,it.subtotal,it.costSubtotal,it.position]
   );
  }

  return {success:true,version:newVersion,requiresNewApproval:wasSentOrApproved,total:financials.total};
 }));
 res.json(result);
}));
app.get('/api/supplier-sync-logs',authenticate,asyncRoute(async(req,res)=>{
 const limit=Math.min(parseInt(req.query.limit,10)||50,100);
 const rows=await store.all(
  `SELECT l.*, s.name AS supplierName FROM supplier_sync_logs l
   LEFT JOIN suppliers s ON s.id=l.supplierId
   ORDER BY l.id DESC LIMIT ?`,
  [limit]
 );
 res.json(rows);
}));
app.get('/api/supplier-settings',authenticate,asyncRoute(async(req,res)=>{
 const rows=await store.all('SELECT key,value FROM supplier_settings');
 const settings=Object.fromEntries(rows.map(r=>[r.key,r.value]));
 res.json(settings);
}));
app.put('/api/supplier-settings',authenticate,asyncRoute(async(req,res)=>{
 const allowedKeys=['daily_sync_enabled','daily_sync_time','timezone','max_retries','cooldown_seconds'];
 await mutate(()=>transaction(async()=>{
  for(const [k,v] of Object.entries(req.body||{})){
   if(allowedKeys.includes(k)&&typeof v==='string'){
    await store.run('INSERT INTO supplier_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[k,text(v,100)]);
   }
  }
 }));
 res.json({success:true});
}));

app.use('/api',(req,res)=>res.status(404).json({error:'Recurso não encontrado.'}));
// Only this directory is exposed. Database, secrets and server source stay outside.
app.get(['/painel','/painel.html','/bios_os_manager.html'],(req,res)=>{res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});res.sendFile(path.join(__dirname,'public/painel.html'));});
app.get(['/acompanhar','/privacidade','/proposta'],(req,res)=>{res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});res.sendFile(path.join(__dirname,'public',req.path.slice(1).replace('.html','')+'.html'));});
app.get('/proposta.html',(req,res)=>{res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});res.sendFile(path.join(__dirname,'public/proposta.html'));});
app.use(express.static(path.join(__dirname,'public'),{dotfiles:'deny',etag:true,maxAge:0,setHeaders(res,file){res.set('Cache-Control',file.endsWith('.html')?'no-cache':'public, max-age=3600');}}));
app.use((req,res)=>res.status(404).sendFile(path.join(__dirname,'public/404.html')));
app.use((err,req,res,next)=>{
 if(res.headersSent)return next(err);
 if(err.status)return res.status(err.status).json({error:err.status===400&&err.type==='entity.parse.failed'?'JSON inválido.':err.message});
 if(err.code==='SQLITE_CONSTRAINT'||['23505','23503','23502'].includes(err.code))return res.status(409).json({error:'Verifique vínculos e valores únicos antes de salvar ou excluir.'});
 console.error('Falha interna:',err.code||err.name);res.status(500).json({error:'Não foi possível concluir a operação.'});
});
async function initialize(){
 if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL&&!process.env.DB_PATH)throw new Error('Defina DATABASE_URL ou DB_PATH persistente antes de iniciar em produção.');
 if(JWT_SECRET.length<32)throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres aleatórios.');
 fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});const existed=fs.existsSync(DB_PATH)&&fs.statSync(DB_PATH).size>0;
 store=await openDatabase(DB_PATH);
 const version=await store.get('PRAGMA user_version');
 if(!store.isPostgres&&existed&&version.user_version<1){const backupDir=path.resolve(process.env.BACKUP_DIR||path.join(path.dirname(DB_PATH),'backups'));fs.mkdirSync(backupDir,{recursive:true});const target=path.join(backupDir,`antes-migracao-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.sqlite`);await store.run('VACUUM INTO ?',[target]);console.log('Backup de migração criado.');}
 await store.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,doc TEXT,city TEXT,neighborhood TEXT,address TEXT,obs TEXT,created TEXT);
 CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL,desc TEXT);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,clientId TEXT NOT NULL,device TEXT NOT NULL,brand TEXT,serviceId TEXT NOT NULL,status TEXT DEFAULT 'recebido',value REAL DEFAULT 0,problem TEXT,solution TEXT,payStatus TEXT DEFAULT 'pendente',payMethod TEXT,dueDate TEXT,payDate TEXT,payObs TEXT,created TEXT,updated TEXT,FOREIGN KEY(clientId) REFERENCES clients(id),FOREIGN KEY(serviceId) REFERENCES services(id));
 CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY AUTOINCREMENT,orderId TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,actor TEXT,FOREIGN KEY(orderId) REFERENCES orders(id));
 CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,orderId TEXT NOT NULL,version INTEGER NOT NULL,value REAL NOT NULL,description TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(orderId,version),FOREIGN KEY(orderId) REFERENCES orders(id));
 CREATE TABLE IF NOT EXISTS parts(id TEXT PRIMARY KEY,category TEXT NOT NULL,brand TEXT NOT NULL,model TEXT NOT NULL,sku TEXT,specs TEXT,supplier TEXT,cost REAL NOT NULL DEFAULT 0,price REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'em_estoque',active INTEGER NOT NULL DEFAULT 1,notes TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY,publicCode TEXT UNIQUE NOT NULL,trackingToken TEXT UNIQUE NOT NULL,clientId TEXT,orderId TEXT,title TEXT NOT NULL,device TEXT,status TEXT NOT NULL DEFAULT 'rascunho',partsTotal REAL NOT NULL DEFAULT 0,servicesTotal REAL NOT NULL DEFAULT 0,customTotal REAL NOT NULL DEFAULT 0,shippingTotal REAL NOT NULL DEFAULT 0,discountTotal REAL NOT NULL DEFAULT 0,total REAL NOT NULL DEFAULT 0,totalCost REAL NOT NULL DEFAULT 0,profit REAL NOT NULL DEFAULT 0,profitMargin REAL NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,approvedVersion INTEGER,validUntil TEXT,paymentTerms TEXT,deliveryTime TEXT,notes TEXT,internalNotes TEXT,created TEXT NOT NULL,updated TEXT NOT NULL,FOREIGN KEY(clientId) REFERENCES clients(id),FOREIGN KEY(orderId) REFERENCES orders(id));
 CREATE TABLE IF NOT EXISTS quote_items(id TEXT PRIMARY KEY,quoteId TEXT NOT NULL,type TEXT NOT NULL,itemId TEXT,name TEXT NOT NULL,details TEXT,quantity INTEGER NOT NULL DEFAULT 1,unitCost REAL NOT NULL DEFAULT 0,unitPrice REAL NOT NULL DEFAULT 0,subtotal REAL NOT NULL DEFAULT 0,costSubtotal REAL NOT NULL DEFAULT 0,position INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(quoteId) REFERENCES quotes(id));
 CREATE TABLE IF NOT EXISTS quote_approvals(id INTEGER PRIMARY KEY AUTOINCREMENT,quoteId TEXT NOT NULL,version INTEGER NOT NULL,total REAL NOT NULL,summary TEXT,itemsSnapshot TEXT,created TEXT NOT NULL,ip TEXT,FOREIGN KEY(quoteId) REFERENCES quotes(id));
 CREATE TABLE IF NOT EXISTS quote_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,quoteId TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,total REAL NOT NULL,summary TEXT,itemsSnapshot TEXT NOT NULL,created TEXT NOT NULL,FOREIGN KEY(quoteId) REFERENCES quotes(id));
 CREATE TABLE IF NOT EXISTS suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,domain TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ativo',rateLimitMs INTEGER DEFAULT 2500,timeoutMs INTEGER DEFAULT 10000,notes TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supplier_offers(id TEXT PRIMARY KEY,partId TEXT,supplierId TEXT NOT NULL,storeSku TEXT,ean TEXT,manufacturerCode TEXT,title TEXT NOT NULL,url TEXT NOT NULL,seller TEXT,fulfillmentBy TEXT,condition TEXT NOT NULL DEFAULT 'novo',pricePix REAL,priceCard REAL,cardInstallments TEXT,availability TEXT NOT NULL DEFAULT 'em_estoque',shippingFee REAL,shippingConsulted INTEGER NOT NULL DEFAULT 0,couponCode TEXT,couponDiscount REAL,lastChecked TEXT,lastPricePix REAL,statusHistory TEXT,lastError TEXT,isStale INTEGER NOT NULL DEFAULT 0,autoSync INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL,FOREIGN KEY(partId) REFERENCES parts(id),FOREIGN KEY(supplierId) REFERENCES suppliers(id));
 CREATE TABLE IF NOT EXISTS supplier_sync_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,supplierId TEXT NOT NULL,offerId TEXT,trigger TEXT NOT NULL,status TEXT NOT NULL,oldPricePix REAL,newPricePix REAL,durationMs INTEGER,message TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS supplier_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 if(store.isPostgres){
  // These tables are accessed through the authenticated Express server, never anonymous Data API calls.
  for(const name of ['clients','services','orders','users','counters','order_events','approvals','parts','quotes','quote_items','quote_approvals','quote_versions','company_settings','suppliers','supplier_offers','supplier_sync_logs','supplier_settings'])await store.exec('ALTER TABLE '+name+' ENABLE ROW LEVEL SECURITY');
 }
 async function addColumn(table,name,definition){const columns=await store.all(`PRAGMA table_info(${table})`);if(!columns.some(x=>(x.name||'').toLowerCase()===name.toLowerCase()))await store.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);}
 await addColumn('users','authVersion','INTEGER NOT NULL DEFAULT 0');await addColumn('users','mustChange','INTEGER NOT NULL DEFAULT 0');
 await addColumn('parts','imageUrl','TEXT');await addColumn('supplier_offers','imageUrl','TEXT');
 for(const [name,definition]of [['trackingToken','TEXT'],['publicCode','TEXT'],['quoteVersion','INTEGER NOT NULL DEFAULT 0'],['quoteDescription',"TEXT NOT NULL DEFAULT ''"],['quoteEnabled','INTEGER NOT NULL DEFAULT 0'],['approvedVersion','INTEGER'],['quoteId','TEXT']])await addColumn('orders',name,definition);
 for(const o of await store.all('SELECT id,status,created FROM orders WHERE trackingToken IS NULL')){await store.run('UPDATE orders SET trackingToken=? WHERE id=?',[token(),o.id]);await store.run('INSERT INTO order_events(orderId,status,created,actor) VALUES(?,?,?,?)',[o.id,o.status,o.created||now(),'migração']);}
 await store.exec('CREATE UNIQUE INDEX IF NOT EXISTS order_tracking ON orders(trackingToken)');
 for(const o of await store.all('SELECT id FROM orders WHERE publicCode IS NULL')){
  for(let attempt=0;attempt<5;attempt++){
   const candidate=generatePublicCode();
   try{
    await store.run('UPDATE orders SET publicCode=? WHERE id=?',[candidate,o.id]);
    break;
   }catch(e){}
  }
 }
 await store.exec('CREATE UNIQUE INDEX IF NOT EXISTS order_public_code ON orders(publicCode)');
 await store.exec('CREATE UNIQUE INDEX IF NOT EXISTS quote_tracking ON quotes(trackingToken)');
 await store.exec('CREATE UNIQUE INDEX IF NOT EXISTS quote_public_code ON quotes(publicCode)');
 await store.exec('CREATE INDEX IF NOT EXISTS quote_items_quote ON quote_items(quoteId)');
 await store.exec('CREATE INDEX IF NOT EXISTS parts_active ON parts(active)');
 await store.exec('CREATE INDEX IF NOT EXISTS quote_versions_quote ON quote_versions(quoteId)');
 await store.exec('CREATE INDEX IF NOT EXISTS supplier_offers_part ON supplier_offers(partId)');
 await store.exec('CREATE INDEX IF NOT EXISTS supplier_offers_supplier ON supplier_offers(supplierId)');
 await store.exec('CREATE INDEX IF NOT EXISTS supplier_sync_logs_supplier ON supplier_sync_logs(supplierId)');
 const defSettings=[
  ['company_name','Bios Informática'],
  ['trade_name','Manutenção e Montagem de Computadores'],
  ['phone','(13) 99622-2130'],
  ['whatsapp','5513996222130'],
  ['email','contato@biosinformatica.store'],
  ['address','Santos e Guarujá - SP'],
  ['city','Guarujá / Santos'],
  ['state','SP'],
  ['warranty_terms','Garantia legal de 90 dias referente aos serviços prestados conforme art. 26 do CDC. Peças e componentes novos contam com a garantia do fabricante segundo seus termos. Não cobre mau uso, umidade, quedas, sobretensão elétrica ou lacres rompidos.'],
  ['default_validity_days','7'],
  ['default_payment_terms','À vista via Pix ou Cartão de Crédito em até 12x'],
  ['default_delivery_time','2 a 5 dias úteis após aprovação e disponibilidade de peças'],
  ['logo_url','/assets/brand/chronos-bios.png']
 ];
 for(const [k,v] of defSettings){
  await store.run('INSERT INTO company_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING',[k,v]);
 }
 await store.run("UPDATE company_settings SET value=? WHERE key='logo_url' AND value='/assets/favicon.svg'",['/assets/brand/chronos-bios.png']);
 const defSuppliers=[
  ['kabum','KaBuM!','kabum','kabum.com.br','ativo',2500,10000,'Conector automatizado oficial KaBuM!'],
  ['pichau','Pichau','pichau','pichau.com.br','ativo',2500,10000,'Conector automatizado oficial Pichau'],
  ['terabyte','TerabyteShop','terabyte','terabyteshop.com.br','integracao_pendente',3000,10000,'Integração pendente - suporte a cotações manuais']
 ];
 for(const s of defSuppliers){
  await store.run('INSERT INTO suppliers(id,name,slug,domain,status,rateLimitMs,timeoutMs,notes,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',[
   s[0],s[1],s[2],s[3],s[4],s[5],s[6],s[7],now(),now()
  ]);
 }
 const defSupplierSettings=[
  ['daily_sync_enabled','0'],
  ['daily_sync_time','06:00'],
  ['timezone','America/Sao_Paulo'],
  ['max_retries','2'],
  ['cooldown_seconds','3']
 ];
 for(const [k,v] of defSupplierSettings){
  await store.run('INSERT INTO supplier_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING',[k,v]);
 }
 const ids=await store.all('SELECT id FROM orders');const max=ids.reduce((m,o)=>/^OS\d+$/.test(o.id)?Math.max(m,Number(o.id.slice(2))):m,0);
 await store.run("INSERT INTO counters(name,value) VALUES('order',?) ON CONFLICT(name) DO UPDATE SET value=CASE WHEN excluded.value > counters.value THEN excluded.value ELSE counters.value END",[max]);
 for(const u of await store.all('SELECT username,password FROM users')){
  if(!u.password.startsWith('$2')){
   const isDefault=u.password==='123456';
   const hashed=await bcrypt.hash(u.password,12);
   await store.run('UPDATE users SET password=?,mustChange=CASE WHEN ?=1 THEN 1 ELSE mustChange END WHERE username=?',[hashed,isDefault?1:0,u.username]);
  }else if(await bcrypt.compare('123456',u.password)){
   await store.run('UPDATE users SET mustChange=1 WHERE username=?',[u.username]);
  }
 }
 const count=await store.get('SELECT COUNT(*) AS n FROM users');count.n=Number(count.n);
 if(!count.n&&process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD){if(!strongPassword(process.env.ADMIN_PASSWORD))throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres e no máximo 72 bytes.');await store.run('INSERT INTO users(username,password,authVersion,mustChange) VALUES(?,?,0,0)',[text(process.env.ADMIN_USERNAME,80),await bcrypt.hash(process.env.ADMIN_PASSWORD,12)]);console.log('Administrador inicial configurado. Remova ADMIN_PASSWORD do ambiente.');}
 else if(!count.n)console.warn('Nenhum administrador. Configure ADMIN_USERNAME e ADMIN_PASSWORD para o primeiro acesso.');
 await store.exec('PRAGMA user_version=1');return store;
}
async function start(){await initialize();const server=app.listen(Number(process.env.PORT)||8000,()=>console.log('Bios disponível na porta '+(process.env.PORT||8000)));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close(async()=>{await mutationQueue;await store.close();process.exit(0);});});return server;}
start().catch(e=>{console.error(e.message);process.exit(1);});
module.exports={app,initialize,start,getStore:()=>store};
