'use strict';
const form=document.getElementById('tracking-form'),input=document.getElementById('tracking-key'),message=document.getElementById('tracking-message'),result=document.getElementById('tracking-result');
let currentToken='';
function extract(value){const raw=value.trim();const key=raw.includes('#')?raw.slice(raw.lastIndexOf('#')+1):raw;return /^[a-f0-9]{64}$/.test(key)?key:null;}
function dateLabel(value){if(!value)return 'A combinar';const date=new Date(value.length===10?value+'T12:00:00':value);return Number.isNaN(date.getTime())?'A combinar':date.toLocaleDateString('pt-BR');}
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function row(label,value){const item=element('div',undefined,'result-row');item.append(element('span',label),element('strong',value));return item;}
async function load(key){
 result.hidden=true;result.replaceChildren();message.className='';message.textContent='Consultando atendimento…';
 const submit=form.querySelector('button');submit.disabled=true;
 try{
  const response=await fetch('/api/tracking/'+key,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível consultar.');
  if(data.isQuote){location.href='/proposta#'+key;return;}
  currentToken=key;history.replaceState(null,'',location.pathname+'#'+key);input.value='';
  result.append(element('p',data.statusLabel,'status-pill'),element('h2',data.device),row('Recebido em',dateLabel(data.created)),row('Última atualização',dateLabel(data.updated)),row('Previsão',dateLabel(data.estimate)));
  if(data.quote){const quote=element('section',undefined,'approval');quote.append(element('h3','Orçamento · versão '+data.quote.version));const description=element('p',data.quote.description);description.style.whiteSpace='pre-wrap';quote.append(description,row('Valor total',new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(data.quote.value)));
   if(data.quote.approved)quote.append(element('p','Aprovação desta versão registrada.'));
   else if(data.status==='aguardando_aprovacao'){
    const approvalForm=element('form');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.required=true;checkbox.id='accept-quote';const label=element('label','Li a descrição e as condições e aprovo o orçamento desta versão.');label.htmlFor=checkbox.id;const button=element('button','Aprovar orçamento','button');button.type='submit';const note=element('p','A aprovação será registrada com a data e a versão do orçamento. Confirme somente se você é o cliente ou está autorizado por ele.');approvalForm.append(note,checkbox,label,element('br'),button);quote.append(approvalForm);
    approvalForm.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;try{const r=await fetch('/api/tracking/'+currentToken+'/approve',{method:'POST',headers:{'Content-Type':'application/json','X-Bios-Request':'1'},body:JSON.stringify({version:data.quote.version,accepted:checkbox.checked})});const body=await r.json();if(!r.ok)throw new Error(body.error);await load(currentToken);message.textContent='Aprovação registrada. A Bios seguirá com o atendimento.';}catch(error){message.className='error';message.textContent=error.message;}finally{button.disabled=false;}});
   }else quote.append(element('p','Consulte a Bios antes de autorizar alterações neste atendimento.'));
   result.append(quote);
  }
  if(data.linkedQuote){
   const lq=element('section',undefined,'approval');
   lq.style.marginTop='15px';
   lq.append(element('h3','Proposta Detalhada Vinculada ('+data.linkedQuote.publicCode+')'));
   const linkA=element('a','Visualizar composição completa da proposta ↗','text-link');
   linkA.href='/proposta#'+key;
   linkA.style.display='inline-block';linkA.style.marginTop='6px';
   lq.append(linkA);
   result.append(lq);
  }
  if(data.history.length){result.append(element('h3','Atualizações'));const list=element('ol',undefined,'history');for(const event of data.history){const item=element('li',event.status);item.append(element('time',dateLabel(event.created)));list.append(item);}result.append(list);}
  result.hidden=false;message.textContent='Atendimento atualizado.';
 }catch(error){message.className='error';message.textContent=error.message;}
 finally{submit.disabled=false;}
}
form.addEventListener('submit',event=>{event.preventDefault();const key=extract(input.value);if(!key){message.className='error';message.textContent='Use o link exclusivo completo enviado pela Bios. O número da OS não é o código de acesso.';return;}load(key);});
const initial=extract(location.hash.slice(1));if(initial)load(initial);
