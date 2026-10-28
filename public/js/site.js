'use strict';
const toggle=document.querySelector('.menu-toggle');
const menu=document.querySelector('#menu');
if(toggle&&menu){
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));menu.classList.toggle('open',open)});
 menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{menu.classList.remove('open');toggle.setAttribute('aria-expanded','false')}));
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.focus()}});
}
const year=document.querySelector('#year');if(year)year.textContent=new Date().getFullYear();
// Optional integration point. No analytics cookies, persistence or transmission here.
document.querySelectorAll('[data-contact]').forEach(link=>link.addEventListener('click',()=>{
 window.dispatchEvent(new CustomEvent('bios:contact-click',{detail:{placement:link.dataset.contact}}));
}));
