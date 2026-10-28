/* Chronos HD: fixed body and sixteen native-resolution head poses.
   Sources use normalized rectangles, so a CDN resize cannot disable animation. */
(() => {
 'use strict';
 const W=1086,H=1448;
 document.querySelectorAll('[data-chronos]').forEach(root=>{
  const canvas=root.querySelector('canvas'), fallback=root.querySelector('img');
  const context=canvas&&canvas.getContext('2d');
  if(!context||!fallback)return;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const frames=window.BIOS_CHRONOS_FRAMES;
  let ready=false,visible=true,raf=0,idleTimer=0,direction=-1,touchId=null,failed=false;
  const sheets=[],master=new Image();
  root.dataset.chronosState='loading';
  const available=()=>ready&&!failed&&visible&&!document.hidden&&!motion.matches;
  function stop(){if(raf)window.cancelAnimationFrame(raf);raf=0;if(idleTimer)window.clearTimeout(idleTimer);idleTimer=0;}
  function showFallback(state){stop();canvas.hidden=true;fallback.hidden=false;root.dataset.chronosState=state;}
  function draw(){
   raf=0;if(!available())return;
   try{
    const box=root.getBoundingClientRect();
    const imgBox=fallback.getBoundingClientRect();
    const css=canvas.hidden&&imgBox.width?imgBox:canvas.getBoundingClientRect();
    const cw=css.width||Math.min(box.width||360,360),ch=css.height||cw*H/W;
    const dpr=Math.max(1,Math.min(Number(window.devicePixelRatio)||1,3));
    const bw=Math.max(1,Math.round(cw*dpr)),bh=Math.max(1,Math.round(ch*dpr));
    if(canvas.width!==bw)canvas.width=bw;if(canvas.height!==bh)canvas.height=bh;
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.clearRect(0,0,bw,bh);
    const scale=Math.min(bw/W,bh/H),ox=(bw-W*scale)/2,oy=(bh-H*scale)/2;
    context.save();context.translate(ox,oy);context.scale(scale,scale);
    if(direction<0){context.drawImage(master,0,0,master.naturalWidth,master.naturalHeight,0,0,W,H);}
    else{
     // Notebook, B_ emblem, paws and tail never change between directions.
     context.save();context.beginPath();context.rect(0,690,W,H-690);context.rect(0,610,375,80);context.clip();
     context.drawImage(master,0,0,master.naturalWidth,master.naturalHeight,0,0,W,H);context.restore();
     const f=frames[direction],image=sheets[f[0]];
     const sw=f[3]*image.naturalWidth,sh=f[4]*image.naturalHeight;
     const s=Math.min(732/sw,658/sh),dw=sw*s,dh=sh*s;
     context.drawImage(image,f[1]*image.naturalWidth,f[2]*image.naturalHeight,sw,sh,590-dw/2,690-dh,dw,dh);
    }
    context.restore();canvas.hidden=false;fallback.hidden=true;root.dataset.chronosState='ready';
    root.dataset.chronosDirection=String(direction);
   }catch(error){failed=true;showFallback('error');}
  }
  function schedule(){if(available()&&!raf)raf=window.requestAnimationFrame(draw);}
  function rest(){direction=-1;touchId=null;schedule();}
  function update(){
   stop();direction=-1;touchId=null;
   if(available())schedule();else showFallback(failed?'error':motion.matches?'reduced-motion':ready?'paused':'loading');
  }
  function point(event){
   if(!available())return;
   if(event.pointerType==='touch'&&event.pointerId!==touchId)return;
   if(!['mouse','pen','touch'].includes(event.pointerType))return;
   const r=canvas.hidden?fallback.getBoundingClientRect():canvas.getBoundingClientRect();
   const dx=event.clientX-(r.left+r.width*590/W),dy=event.clientY-(r.top+r.height*440/H);
   if(Math.hypot(dx,dy)<Math.max(14,r.width*0.055)){direction=-1;schedule();return;}
   const a=(Math.atan2(dx,-dy)+Math.PI*2)%(Math.PI*2);
   const next=Math.round(a/(Math.PI/8))%16;
   if(next!==direction){direction=next;schedule();}
  }
  // Passive Pointer Events keep native scrolling and browser gestures intact.
  window.addEventListener('pointermove',point,{passive:true});
  window.addEventListener('pointerdown',event=>{
   if(event.pointerType==='touch'&&event.isPrimary!==false){touchId=event.pointerId;point(event);}
   else point(event);
  },{passive:true});
  for(const event of ['pointerup','pointercancel'])window.addEventListener(event,e=>{if(e.pointerId===touchId)rest();},{passive:true});
  document.addEventListener('pointerleave',rest,{passive:true});
  window.addEventListener('blur',rest);window.addEventListener('scroll',rest,{passive:true});
  document.addEventListener('visibilitychange',update);window.addEventListener('pageshow',update);
  window.addEventListener('resize',schedule,{passive:true});
  if(motion.addEventListener)motion.addEventListener('change',update);else if(motion.addListener)motion.addListener(update);
  if(window.ResizeObserver)new window.ResizeObserver(schedule).observe(root);
  if(window.IntersectionObserver)new window.IntersectionObserver(entries=>{visible=entries[0].isIntersecting;update();},{rootMargin:'80px'}).observe(root);
  let remaining=5;
  function loaded(){if(failed)return;if(--remaining===0){ready=true;update();}}
  function load(image,url){image.onload=()=>image.naturalWidth&&image.naturalHeight?loaded():error();image.onerror=error;image.src=url;}
  function error(){failed=true;showFallback('error');}
  if(!Array.isArray(frames)||frames.length!==16){error();return;}
  load(master,root.dataset.chronos);
  for(let i=0;i<4;i++){sheets[i]=new Image();load(sheets[i],`/assets/chronos/hd/chronos-heads-${i}-v3.webp`);}
 });
})();
