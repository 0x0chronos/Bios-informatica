'use strict';
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { load } = require('cheerio');

const STORES = Object.freeze({
  kabum: { name: 'KaBuM!', host: 'www.kabum.com.br', search: q => '/busca/' + encodeURIComponent(q) },
  pichau: { name: 'Pichau', host: 'www.pichau.com.br', search: q => '/search?q=' + encodeURIComponent(q) },
  terabyte: { name: 'TerabyteShop', host: 'www.terabyteshop.com.br', search: q => '/busca?str=' + encodeURIComponent(q) }
});
const ALLOWED_DOMAINS = Object.values(STORES).flatMap(s => [s.host, s.host.replace(/^www\./, '')]);
const domainQueues = new Map();
const domainStarts = new Map();
const cooldowns = new Map();
const robotsCache = new Map();
const searchCache = new Map();
const inflight = new Map();
const MAX_BYTES = 6 * 1024 * 1024;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function supplierForUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  return Object.keys(STORES).find(id => [STORES[id].host, STORES[id].host.replace(/^www\./, '')].includes(url.hostname.toLowerCase()));
}
function isIpPrivate(ip) {
  if (!ip || !net.isIP(ip)) return true;
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) ||
      (a===192&&(b===168||b===0||b===2)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0);
  }
  // Only globally routable IPv6 unicast (2000::/3), excluding documentation space.
  // This also blocks mapped IPv4, unique-local, loopback, link-local and multicast.
  return !/^[23][0-9a-f]{3}:/i.test(ip) || /^2001:db8:/i.test(ip);
}
function canonicalUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('URL inválida ou malformada.'); }
  if (parsed.protocol!=='https:') throw new Error('Apenas conexões seguras HTTPS são permitidas.');
  if (!ALLOWED_DOMAINS.includes(parsed.hostname.toLowerCase())) throw new Error('Domínio não autorizado. Use KaBuM!, Pichau ou Terabyte.');
  if (parsed.username || parsed.password || (parsed.port && parsed.port!=='443')) throw new Error('Credenciais e portas alternativas não são permitidas.');
  parsed.hash='';
  for (const name of [...parsed.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|srsltid$)/i.test(name)) parsed.searchParams.delete(name);
  return parsed;
}
async function resolvePublic(parsed, lookup = dns.lookup.bind(dns)) {
  const records = await lookup(parsed.hostname, { all:true, verbatim:true });
  if (!records?.length || records.some(r => isIpPrivate(r.address))) throw new Error('Endereço privado ou não público bloqueado (SSRF).');
  return records;
}
async function validateUrlSecurity(rawUrl, {lookup, resolve = true} = {}) {
  const parsed=canonicalUrl(rawUrl);
  if (resolve) await resolvePublic(parsed,lookup);
  return parsed;
}
function queued(domain, action) {
  const previous=domainQueues.get(domain)||Promise.resolve();
  const result=previous.catch(()=>{}).then(async()=>{
    if ((cooldowns.get(domain)||0)>Date.now()) throw new Error('Fornecedor em pausa após resposta de limite/acesso. Tente novamente mais tarde.');
    const delay=2500-(Date.now()-(domainStarts.get(domain)||0));
    if(delay>0) await wait(delay);
    domainStarts.set(domain,Date.now());
    return action();
  });
  domainQueues.set(domain,result);
  result.finally(()=>{if(domainQueues.get(domain)===result)domainQueues.delete(domain);}).catch(()=>{});
  return result;
}
function requestPinned(url, records, timeoutMs) {
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(value);};
    const timer=setTimeout(()=>{req.destroy(new Error('Tempo limite ao consultar fornecedor.'));},timeoutMs);
    const req=https.request(url,{
      method:'GET',
      headers:{'User-Agent':'BiosInformaticaMonitor/1.2 (+https://biosinformatica.store/)',Accept:'text/html,application/xhtml+xml,text/plain;q=0.8','Accept-Language':'pt-BR,pt;q=0.9','Accept-Encoding':'identity'},
      // Pin the validated DNS result to the actual socket, keeping hostname/SNI verification.
      lookup:(_hostname,options,callback)=> options.all ? callback(null,records) : callback(null,records[0].address,records[0].family)
    },res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES)req.destroy(new Error('Página excede o limite de 6 MB.'));else chunks.push(chunk);});
      res.on('error',error=>finish(error));
      res.on('end',()=>{
        const contentType=String(res.headers['content-type']||'');
        const buffer=Buffer.concat(chunks);
        let html;
        try { html=new TextDecoder(/charset=([^;\s]+)/i.exec(contentType)?.[1]||'utf-8').decode(buffer); }
        catch { html=buffer.toString('utf8'); }
        finish(null,{status:res.statusCode,headers:res.headers,html});
      });
    });
    req.on('error',error=>finish(error));
    req.end();
  });
}
async function safeFetchHtml(rawUrl,{timeoutMs=10000,maxRedirects=3,lookup,request=requestPinned}={}) {
  let url=canonicalUrl(rawUrl);
  const supplier=supplierForUrl(url);
  return queued(supplier,async()=>{
    const deadline=Date.now()+Math.min(Math.max(timeoutMs,100),15000);
    for(let n=0;n<=maxRedirects;n++){
      const remaining=()=>Math.max(1,deadline-Date.now());
      let timer;
      const records=await Promise.race([
        resolvePublic(url,lookup),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo limite na resolução DNS.')),remaining());})
      ]).finally(()=>clearTimeout(timer));
      if(Date.now()>=deadline)throw new Error('Tempo limite ao consultar fornecedor.');
      const res=await request(url,records,remaining());
      if([301,302,303,307,308].includes(res.status)){
        if(n===maxRedirects||!res.headers.location)throw new Error('Redirecionamento inválido ou excesso de redirecionamentos.');
        url=canonicalUrl(new URL(res.headers.location,url).href);
        if(supplierForUrl(url)!==supplier)throw new Error('Redirecionamento para outro fornecedor bloqueado.');
        continue;
      }
      if(res.status===403||res.status===429){
        cooldowns.set(supplier,Date.now()+60000);
        const error=new Error('Fornecedor recusou ou limitou a consulta (HTTP '+res.status+').');error.statusCode=res.status;throw error;
      }
      if(res.status===404){const error=new Error('Página não encontrada no fornecedor (HTTP 404).');error.statusCode=404;throw error;}
      if(res.status<200||res.status>=300)throw new Error('Fornecedor retornou HTTP '+res.status+'.');
      const type=String(res.headers['content-type']||'');
      if(type&&!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type))throw new Error('O fornecedor não retornou uma página HTML/texto.');
      if(/<title[^>]*>\s*(?:Just a moment|Attention Required|Access Denied|Verifique se você é humano)/i.test(res.html)){
        const error=new Error('Página de verificação de acesso recebida; coleta interrompida.');error.statusCode=403;cooldowns.set(supplier,Date.now()+60000);throw error;
      }
      return {html:res.html,finalUrl:url.href,status:res.status};
    }
  });
}
function robotsAllows(text,path,userAgent='biosinformaticamonitor') {
  const groups=[];let agents=[],rules=[],hasRules=false;
  const push=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];hasRules=false;};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split('#')[0].trim();const colon=line.indexOf(':');if(colon<0)continue;
    const key=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
    if(key==='user-agent'){if(hasRules)push();agents.push(value.toLowerCase());}
    else if(agents.length&&['allow','disallow'].includes(key)){hasRules=true;if(value)rules.push({allow:key==='allow',path:value});}
  }push();
  const exact=groups.filter(g=>g.agents.some(a=>a!=='*'&&userAgent.includes(a)));
  const selected=exact.length?exact:groups.filter(g=>g.agents.includes('*'));
  const matches=selected.flatMap(g=>g.rules).filter(r=>{
    const pattern=r.path.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');
    return new RegExp('^'+pattern).test(path);
  }).sort((a,b)=>b.path.replace(/\*/g,'').length-a.path.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));
  return !matches.length||matches[0].allow;
}
async function fetchAllowed(rawUrl) {
  const url=canonicalUrl(rawUrl),store=supplierForUrl(url);
  let robots=robotsCache.get(store);
  if(!robots||robots.expires<Date.now()){
    try {const r=await safeFetchHtml(new URL('/robots.txt',url).href);robots={text:r.html,expires:Date.now()+3600000};}
    catch(error){if(error.statusCode!==404)throw Object.assign(new Error('Não foi possível verificar robots.txt: '+error.message),{statusCode:error.statusCode});robots={text:'',expires:Date.now()+3600000};}
    robotsCache.set(store,robots);
  }
  if(!robotsAllows(robots.text,url.pathname+url.search))throw new Error('Consulta não permitida pelas regras de robots.txt do fornecedor.');
  return safeFetchHtml(url.href);
}
function parseMoneyPtBr(value) {
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='number')return Number.isFinite(value)&&value>0?Math.round(value*100)/100:null;
  const raw=String(value).trim();if(raw.includes('-'))return null;
  let clean=raw.replace(/[^\d.,]/g,'');if(!clean)return null;
  if(clean.includes(','))clean=clean.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(clean))clean=clean.replace(/\./g,'');
  const n=Number(clean);return Number.isFinite(n)&&n>0?Math.round(n*100)/100:null;
}
function ldObjects($) {
  const out=[];
  const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;out.push(node);if(node['@graph'])walk(node['@graph']);};
  $('script[type="application/ld+json"]').each((_,el)=>{try{walk(JSON.parse($(el).text()));}catch{}});
  return out;
}
function typeIs(node,type){return (Array.isArray(node?.['@type'])?node['@type']:[node?.['@type']]).some(x=>String(x).split('/').pop()===type);}
function textOf(value){return typeof value==='string'?value.replace(/\s+/g,' ').trim():'';}
function availabilityOf(value) {
  const v=String(value||'');
  if(/OutOfStock|Discontinued|SoldOut|esgotado|indispon[ií]vel/i.test(v))return 'esgotado';
  if(/PreOrder|BackOrder/i.test(v))return 'sob_consulta';
  if(/InStock|LimitedAvailability/i.test(v))return 'em_estoque';
  return 'sob_consulta';
}
function emptyOffer(store,url) {
  return {supplier:store,supplierName:STORES[store].name,title:'',storeSku:'',ean:'',manufacturerCode:'',brand:'',specs:'',url,
    seller:'',fulfillmentBy:'',condition:'novo',pricePix:null,priceCard:null,observedPrice:null,cardInstallments:'',availability:'sob_consulta',
    shippingConsulted:0,shippingFee:null,lastChecked:new Date().toISOString()};
}
function parseProduct(html,productUrl,store) {
  const url=canonicalUrl(productUrl);if(supplierForUrl(url)!==store)throw new Error('URL pertence a outro fornecedor.');
  const $=load(html),nodes=ldObjects($),product=nodes.find(x=>typeIs(x,'Product'));
  const result=emptyOffer(store,url.href);
  if(product){
    result.title=textOf(product.name);
    result.storeSku=String(product.sku||product.productID||'');result.ean=String(product.gtin13||product.gtin||'');
    result.manufacturerCode=String(product.mpn||'');result.brand=textOf(product.brand?.name||product.brand);
    result.specs=textOf(product.description);
    const offers=Array.isArray(product.offers)?product.offers:[product.offers];
    const offer=offers.find(x=>x&&(!x.priceCurrency||x.priceCurrency==='BRL'));
    if(offer){
      result.observedPrice=parseMoneyPtBr(offer.price||offer.lowPrice);
      // A generic Offer price does not prove the payment method.
      result.availability=availabilityOf(offer.availability);
      result.seller=textOf(offer.seller?.name);result.fulfillmentBy=textOf(offer.deliveryLeadTime?.name);
      if(/UsedCondition/.test(offer.itemCondition||''))result.condition='openbox';
      if(/RefurbishedCondition/.test(offer.itemCondition||''))result.condition='reembalado';
      for(const spec of [].concat(offer.priceSpecification||[])){
        if(/pix|vista|boleto/i.test(String(spec.name||spec.description||spec.validForMemberTier||'')))result.pricePix=parseMoneyPtBr(spec.price);
        if(/cart[aã]o|credit/i.test(String(spec.name||spec.description||'')))result.priceCard=parseMoneyPtBr(spec.price);
      }
    }
  }
  // Prefer the main product, excluding related/recommended cards from price extraction.
  let scope=$('main').first();if(!scope.length)scope=$('body');
  scope=scope.clone();scope.find('script,style,nav,footer,[class*="recommend"],[class*="related"],[class*="shelf"]').remove();
  if(!result.title)result.title=textOf($('h1').first().text())||textOf($('meta[property="og:title"]').attr('content'));
  if(!result.title)result.title=textOf($('title').text()).replace(/\s*[|–-]\s*(KaBuM!?|Pichau|TerabyteShop).*$/i,'');
  const visible=scope.text().replace(/\s+/g,' ');
  const pix=visible.match(/R\$\s*([\d.,]+)\s*(?:[aà]\s*vista(?:\s+(?:no|com|via)\s+PIX)?|no\s+PIX|via\s+PIX)/i)||visible.match(/(?:[aà]\s*vista(?:\s+no\s+PIX)?|no\s+PIX)\s*:?\s*R\$\s*([\d.,]+)/i);
  if(pix)result.pricePix=parseMoneyPtBr(pix[1]);
  const card=visible.match(/(\d{1,2})\s*x\s*(?:de\s*)?R\$\s*([\d.,]+)/i);
  if(card&&Number(card[1])>0){const installment=parseMoneyPtBr(card[2]);if(installment){result.priceCard=Math.round(installment*Number(card[1])*100)/100;result.cardInstallments=card[1]+'x de R$ '+installment.toFixed(2).replace('.',',');}}
  const directCard=visible.match(/R\$\s*([\d.,]+)\s*(?:no\s+cart[aã]o|a\s+prazo)/i);
  if(directCard)result.priceCard=parseMoneyPtBr(directCard[1]);
  const ids=store==='kabum'||store==='terabyte'?url.pathname.match(/\/produto\/(\d+)/):null;
  if(!result.storeSku&&ids)result.storeSku=ids[1];
  const seller=visible.match(/(?:vendido\s+(?:e\s+entregue\s+)?por)\s*:?\s*([^|]{2,80}?)(?:\s+(?:e entregue|R\$|Comprar|Adicionar)|$)/i);
  if(seller)result.seller=textOf(seller[1]);
  if(result.availability==='sob_consulta'&&/produto\s+(?:esgotado|indispon[ií]vel)|avise-me quando/i.test(visible))result.availability='esgotado';
  if(!result.title||/^(?:Just a moment|Access denied|Attention required)|p[aá]gina n[aã]o encontrada/i.test(result.title))throw new Error('Produto não identificado na página do fornecedor.');
  // A title-only page is not a successful price observation.
  if(!result.pricePix&&!result.priceCard&&!result.observedPrice&&result.availability!=='esgotado')throw new Error('A página não informa preço verificável do produto.');
  for(const key of ['title','specs','storeSku','ean','manufacturerCode','brand','seller','fulfillmentBy'])result[key]=String(result[key]||'').slice(0,key==='specs'?3000:key==='title'?250:100);
  return result;
}
function isProductUrl(raw,store) {
  try{const u=canonicalUrl(raw);if(supplierForUrl(u)!==store)return false;
    if(store==='kabum'||store==='terabyte')return /^\/produto\/\d+\//.test(u.pathname);
    return /^\/[\w-]+-[\w-]+\/?$/.test(u.pathname)&&!/^\/(?:search|busca|ofertas|promocoes|hardware)(?:\/|$)/.test(u.pathname);
  }catch{return false;}
}
function parseSearchHtml(html,store,limit=6) {
  const $=load(html),base='https://'+STORES[store].host,items=[],seen=new Set();
  function add(value,urlHint){
    let rawUrl=value?.url||urlHint;if(!rawUrl)return;
    if(Array.isArray(rawUrl))rawUrl=rawUrl[0];
    let url;try{url=canonicalUrl(new URL(rawUrl,base).href).href;}catch{return;}
    if(!isProductUrl(url,store)||seen.has(url)||items.length>=limit)return;
    const title=textOf(value.name);if(!title||title.length<5)return;
    const offer=Array.isArray(value.offers)?value.offers[0]:value.offers;
    const result=emptyOffer(store,url);
    Object.assign(result,{id:'search_'+store+'_'+items.length,title:title.slice(0,250),storeSku:String(value.sku||value.code||''),ean:String(value.gtin13||value.ean||''),manufacturerCode:String(value.mpn||''),
      brand:textOf(value.brand?.name||value.brand),observedPrice:parseMoneyPtBr(offer?.price||offer?.lowPrice),availability:availabilityOf(offer?.availability),seller:textOf(offer?.seller?.name),pricePix:parseMoneyPtBr(value.pricePix),priceCard:parseMoneyPtBr(value.priceCard)});
    if(!result.storeSku)result.storeSku=/\/produto\/(\d+)/.exec(url)?.[1]||'';
    seen.add(url);items.push(result);
  }
  for(const node of ldObjects($)){
    if(typeIs(node,'Product'))add(node);
    if(typeIs(node,'ItemList'))for(const el of node.itemListElement||[]){const item=el.item||el;add(item,item.url||el.url);}
  }
  // Next.js and JSON state: walk product objects, never eval page JavaScript.
  $('script#__NEXT_DATA__,script[type="application/json"]').each((_,el)=>{
    let data;try{data=JSON.parse($(el).text());}catch{return;}
    let visits=0;
    const walk=(value,depth=0)=>{
      if(!value||depth>18||++visits>30000||items.length>=limit)return;
      if(Array.isArray(value))return value.forEach(x=>walk(x,depth+1));
      if(typeof value!=='object')return;
      if(value.name&&(value.url||value.code)){
        const url=value.url||(store==='kabum'&&value.code?'https://www.kabum.com.br/produto/'+value.code+'/'+(value.friendlyName||'produto'):null);
        // Retail state fields are kept conservative; regularPrice is not necessarily card price.
        add({...value,pricePix:value.priceWithDiscount??value.pricePix,offers:{price:value.price,availability:value.available===true?'InStock':value.available===false?'OutOfStock':undefined,seller:value.sellerName?{name:value.sellerName}:undefined}},url);
      }
      Object.values(value).forEach(x=>walk(x,depth+1));
    };walk(data);
  });
  $('a[href]').each((_,el)=>{
    if(items.length>=limit)return;
    const link=$(el),href=link.attr('href');let url;try{url=new URL(href,base).href;}catch{return;}
    if(!isProductUrl(url,store))return;
    const name=textOf(link.find('h2,h3,[class*="nameCard"],[class*="prod-name"]').first().text())||textOf(link.attr('title'));
    if(!name)return;
    add({name},url);
  });
  return items;
}
const parseKabumProduct=(html,url)=>parseProduct(html,url,'kabum');
const parsePichauProduct=(html,url)=>parseProduct(html,url,'pichau');
const parseTerabyteProduct=(html,url)=>parseProduct(html,url,'terabyte');
const parseKabumSearchHtml=(html,limit)=>parseSearchHtml(html,'kabum',limit);
const parsePichauSearchHtml=(html,limit)=>parseSearchHtml(html,'pichau',limit);
const parseTerabyteSearchHtml=(html,limit)=>parseSearchHtml(html,'terabyte',limit);
async function fetchSupplierPreview(rawUrl,{fetchHtml=fetchAllowed}={}) {
  const url=canonicalUrl(rawUrl),store=supplierForUrl(url);
  const page=await fetchHtml(url.href);
  return parseProduct(page.html,page.finalUrl||url.href,store);
}
async function searchStoreProducts(query,{supplier='all',limit=6,fetchHtml=fetchAllowed,useCache=true}={}) {
  const q=String(query||'').trim();if(!q||q.length>120)throw new Error('Informe uma busca de 1 a 120 caracteres.');
  if(supplier!=='all'&&!STORES[supplier])throw new Error('Fornecedor inválido.');
  limit=Math.min(Math.max(Number(limit)||6,1),15);
  const key=supplier+':'+q.toLowerCase()+':'+limit;
  if(useCache){const cached=searchCache.get(key);if(cached&&cached.expires>Date.now())return {...cached.data,cached:true};if(inflight.has(key))return inflight.get(key);}
  const job=(async()=>{
    const sources=await Promise.all((supplier==='all'?Object.keys(STORES):[supplier]).map(async store=>{
      const searchUrl='https://'+STORES[store].host+STORES[store].search(q);
      try{
        const page=await fetchHtml(searchUrl);
        const results=parseSearchHtml(page.html,store,limit);
        // Hydrate bounded product detail pages, preserving unknowns instead of guessing prices.
        const checked=[];let detailErrors=0;
        for(const item of results){
          if(item.pricePix||item.priceCard){checked.push(item);continue;}
          try{const detail=await fetchHtml(item.url);checked.push({...item,...parseProduct(detail.html,detail.finalUrl||item.url,store)});}
          catch{detailErrors++;checked.push(item);}
        }
        return {supplier:store,supplierName:STORES[store].name,status:checked.length?'sucesso':'sem_resultados',found:checked.length,detailErrors,url:searchUrl,checkedAt:new Date().toISOString(),results:checked};
      }catch(error){return {supplier:store,supplierName:STORES[store].name,status:error.statusCode===403||error.statusCode===429?'acesso_restrito':'erro',blocked:error.statusCode===403||error.statusCode===429,message:error.message,url:searchUrl,checkedAt:new Date().toISOString(),results:[]};}
    }));
    const data={query:q,results:sources.flatMap(s=>s.results),sources:sources.map(({results,...rest})=>rest),timestamp:new Date().toISOString(),cached:false};
    if(useCache){if(searchCache.size>=100)searchCache.delete(searchCache.keys().next().value);searchCache.set(key,{expires:Date.now()+(data.results.length?600000:60000),data});}
    return data;
  })();
  if(useCache)inflight.set(key,job);
  try{return await job;}finally{if(useCache)inflight.delete(key);}
}
module.exports={ALLOWED_DOMAINS,STORES,canonicalUrl,supplierForUrl,isIpPrivate,validateUrlSecurity,safeFetchHtml,robotsAllows,parseMoneyPtBr,
  parseKabumProduct,parsePichauProduct,parseTerabyteProduct,parseKabumSearchHtml,parsePichauSearchHtml,parseTerabyteSearchHtml,fetchSupplierPreview,searchStoreProducts};
