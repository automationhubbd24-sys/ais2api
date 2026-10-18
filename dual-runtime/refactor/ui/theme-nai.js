'use strict';
// Starlight theme: overview banner with live service state. Purely decorative; reads the same /api/status as the console.
(()=>{
 const ready=()=>{
  const page=document.getElementById('overview');if(!page||page.querySelector('.nai-hero'))return;
  const hero=document.createElement('div');hero.className='nai-hero';
  const text=document.createElement('div');
  const h=document.createElement('h2'),p=document.createElement('p'),chip=document.createElement('span');
  h.textContent='AIS2API';
  chip.className='nai-chip';chip.append(document.createElement('i'),document.createTextNode('正在连接…'));
  text.append(h,chip);
  const img=document.createElement('img');img.src='/console-assets/nai-mascot.webp';img.alt='';img.decoding='async';img.setAttribute('aria-hidden','true');
  hero.append(text,img);page.prepend(hero);
  const update=async()=>{
   try{const r=await fetch('/api/status',{credentials:'same-origin',cache:'no-store'});const d=await r.json();
    const slots=Object.values(d.slots||{}),ok=slots.filter(s=>s&&s.ready).length;
    chip.classList.toggle('bad',!r.ok||d.halted||!ok);
    chip.lastChild.textContent=!r.ok?'调度服务不可用':d.halted?'调度已暂停':ok+' / '+slots.length+' 个实例在线 · 队列 '+(d.queue??0);
   }catch{chip.classList.add('bad');chip.lastChild.textContent='调度服务不可用';}
  };
  update();setInterval(()=>{if(!document.hidden)update();},15000);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
// Accounts page decoration: banner with live counts and illustrated add-account cards.
(()=>{
 const ready=()=>{
  const list=document.getElementById('accounts-list');
  if(false&&list&&!list.querySelector('.nai-acc-hero')){
   const hero=document.createElement('div');hero.className='nai-acc-hero';
   const t=document.createElement('div'),h=document.createElement('h2'),p=document.createElement('p');
   h.textContent='账号池';t.append(h);
   const st=document.createElement('div');st.className='nai-acc-stats';
   const mk=l=>{const s=document.createElement('span'),b=document.createElement('b');b.textContent='—';s.append(b,document.createTextNode(l));st.append(s);return b;};
   const total=mk('个账号'),pro=mk('个 Pro'),ultra=mk('个 Ultra'),bad=mk('个失效');
   hero.append(t,st);list.prepend(hero);
   document.addEventListener('ais-status',e=>{const a=e.detail?.accounts||[];total.textContent=a.length;
    pro.textContent=a.filter(x=>x.tier==='pro').length;ultra.textContent=a.filter(x=>x.tier==='ultra'||x.tier==='ultra20').length;
    bad.textContent=a.filter(x=>['invalid','deleting'].includes(x.authStatus)).length;});
  }
  const map=[['Cookie 导入','cookie'],['浏览器油猴脚本','script'],['账号密码登录','login']];
  document.querySelectorAll('#accounts-add .form-card.legacy > h2').forEach(h=>{
   const hit=map.find(([t])=>h.textContent.trim().startsWith(t));if(hit)h.parentElement.classList.add('nai-art','nai-art-'+hit[1]);
  });
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
