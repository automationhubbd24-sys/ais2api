'use strict';
// Settings › 安全: console password and client API keys.
(()=>{
 const $=id=>document.getElementById(id);
 if(!$('pw-form'))return;
 const day=v=>v?new Date(v).toLocaleDateString('zh-CN'):'—';
 const say=(id,text,bad)=>{const n=$(id);n.textContent=text||'';n.classList.toggle('warn',Boolean(bad));};
 let busy=false,loaded=false;
 function render(d){
  loaded=true;
  $('pw-state').textContent=d.passwordSet?'已设置 · '+day(d.passwordUpdatedAt):'未设置';
  $('pw-state').className='badge '+(d.passwordSet?'good':'warn');
  $('pw-current').placeholder=d.passwordSet?'':'首次修改请填当前 API Key';
  const list=$('key-list');list.replaceChildren();
  const row=(name,masked,meta,actions)=>{const li=document.createElement('li'),t=document.createElement('div'),b=document.createElement('b'),c=document.createElement('code'),m=document.createElement('small');
   b.textContent=name;c.textContent=masked;m.textContent=meta;t.append(b,c,m);li.append(t);const box=document.createElement('div');box.className='key-actions';actions.forEach(a=>box.append(a));li.append(box);list.append(li);return li;};
  const btn=(text,fn,cls)=>{const x=document.createElement('button');x.type='button';x.textContent=text;if(cls)x.className=cls;x.addEventListener('click',fn);return x;};
  const internal=row('默认 Key',d.internalMasked,d.internalExternal?'内部通信用，也可供客户端使用':'仅内部通信，客户端已停用',
   [btn(d.internalExternal?'停用于客户端':'恢复',()=>post('/api/auth/internal',{enabled:!d.internalExternal},d.internalExternal?'停用后，用默认 Key 的客户端会立即无法访问。继续？':null))]);
  internal.classList.toggle('off',!d.internalExternal);
  for(const k of d.keys){
   const li=row(k.name,k.masked,'创建于 '+day(k.createdAt)+(k.disabled?' · 已停用':''),[
    btn(k.disabled?'启用':'停用',()=>post('/api/auth/key',{id:k.id,disabled:!k.disabled})),
    btn('删除',()=>post('/api/auth/key',{id:k.id,remove:true},'删除 Key「'+k.name+'」？使用它的客户端会立即无法访问。'),'danger')]);
   li.classList.toggle('off',k.disabled);
  }
 }
 async function load(){try{render(await api('/api/auth'));say('key-msg','');}catch(e){say('key-msg','读取失败：'+e.message,true);}}
 async function post(path,body,question){
  if(busy||(question&&!confirm(question)))return null;busy=true;
  try{const d=await api(path,body);render(d);say('key-msg','');return d;}catch(e){say('key-msg',e.message,true);return null;}finally{busy=false;}
 }
 $('pw-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  if($('pw-next').value!==$('pw-again').value)return say('pw-msg','两次输入的新密码不一致',true);
  busy=true;$('pw-save').disabled=true;
  try{render(await api('/api/auth/password',{current:$('pw-current').value,next:$('pw-next').value}));
   $('pw-form').reset();say('pw-msg','已修改，下次登录请使用新密码');}
  catch(err){say('pw-msg',err.message,true);}finally{busy=false;$('pw-save').disabled=false;}
 });
 $('key-form').addEventListener('submit',async e=>{
  e.preventDefault();const d=await post('/api/auth/keys',{name:$('key-name').value});
  if(d?.created){$('key-name').value='';$('key-new-value').textContent=d.created.key;$('key-new').hidden=false;}
 });
 $('key-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('key-new-value').textContent);$('key-copy').textContent='已复制';}catch{const r=document.createRange();r.selectNodeContents($('key-new-value'));getSelection().removeAllRanges();getSelection().addRange(r);}});
 const show=()=>{if(location.hash==='#settings'&&!loaded)load();};
 addEventListener('hashchange',show);show();
})();
