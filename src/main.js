import { createClient } from '@supabase/supabase-js';
import { Html5Qrcode } from 'html5-qrcode';
import './style.css';
const url=import.meta.env.VITE_SUPABASE_URL, key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}}):null;
const root=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('en-US')+' د.ع';
// No application data or pending sales are stored on the phone.
let user=null,profile=null,medicines=[],stock=[],activity=[],people=[],scanner=null,activeTab='dashboard',notice='';
const online=()=>navigator.onLine;
function message(t){notice=t;render();}
function layout(body){root.innerHTML=`<header><h1>💊 PharmaStock</h1><span>${online()?'🟢 متصل':'🔴 دون اتصال — العمليات متوقفة'}</span></header><main>${notice?`<div class="notice">${esc(notice)}</div>`:''}${body}</main>`;}
function render(){if(!supabase){layout('<h2>إعداد المشروع</h2><p>أضف متغيرات Supabase إلى ملف .env.local أو إعدادات GitHub Actions.</p>');return;}
 if(!user){layout(`<section class="panel"><h2>تسجيل الدخول</h2><form id="login"><label>البريد الإلكتروني<input name="email" type="email" required autocomplete="username"></label><label>كلمة المرور<input name="password" type="password" required autocomplete="current-password"></label><button>دخول</button></form></section>`);document.getElementById('login').onsubmit=login;return;}
 if(!profile?.active){layout('<section class="panel"><h2>الحساب غير مفعّل</h2><p>الحساب ينتظر التفعيل بواسطة مسؤول إعداد Supabase.</p><button id="logout">خروج</button></section>');document.getElementById('logout').onclick=logout;return;}
 const tabs=[['dashboard','الرئيسية'],['medicines','الأدوية'],['sale','البيع'],['activity','السجل']];
 let content='';if(activeTab==='dashboard')content=`<section class="panel"><h2>مرحباً ${esc(profile.display_name||user.email)}</h2><p>مخزن مشترك لجميع المندوبين</p><div class="stats"><div>أنواع الأدوية<strong>${medicines.length}</strong></div><div>القطع بالمخزن المشترك<strong>${stock.filter(s=>s.location==='pharmacy').reduce((n,s)=>n+s.qty,0)}</strong></div></div><button id="refresh">تحديث البيانات</button></section>`;
 if(activeTab==='medicines')content=`<section class="panel"><h2>الأدوية</h2><input id="search" placeholder="ابحث بالاسم أو الباركود"><div id="medlist"></div>${profile.active?`<h3>إضافة دواء</h3><form id="addmed"><label>اسم الدواء<input name="name" required></label><label>الباركود<input name="barcode" required></label><label>سعر الشراء<input name="purchase_price" type="number" min="0" step="0.01" required></label><label>سعر البيع<input name="sale_price" type="number" min="0" step="0.01" required></label><button>إضافة (يتطلب إنترنت)</button></form><h3>استلام مخزون</h3><form id="receive"><select name="medicine_id">${medicines.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><input type="hidden" name="location" value="pharmacy"><input name="qty" type="number" min="1" step="1" placeholder="الكمية" required><button>استلام (يتطلب إنترنت)</button></form>`:''}</section>`;
 if(activeTab==='sale')content=`<section class="panel"><h2>بيع من المخزن المشترك</h2><p class="hint">يتطلب البيع اتصالاً بالإنترنت. لا تُحفظ الفواتير على الهاتف.</p><button id="scan">📷 مسح باركود</button><div id="reader" class="reader"></div><form id="saleform"><label>الدواء<select name="medicine_id" id="sale-med">${medicines.map(m=>`<option value="${m.id}">${esc(m.name)} — ${money(m.sale_price)}</option>`).join('')}</select></label><label>الكمية<input type="number" name="qty" min="1" step="1" value="1" required></label><button ${medicines.length?'':'disabled'}>حفظ الفاتورة</button></form></section>`;
 if(activeTab==='activity')content=`<section class="panel"><h2>سجل جميع المندوبين</h2><p class="hint">العمليات المؤكدة في قاعدة البيانات السحابية فقط.</p>${activity.map(a=>`<div class="item"><strong>${esc(people.find(p=>p.id===a.actor_id)?.display_name||'مندوب غير معروف')}</strong><span>${esc(a.reason==='receive'?'إدخال':a.reason==='sale'?'بيع':a.reason)} — ${esc(medicines.find(m=>m.id===a.medicine_id)?.name||'دواء')} — ${a.delta>0?'+':''}${a.delta} — ${esc(new Date(a.created_at).toLocaleString('ar-IQ'))}</span></div>`).join('')||'<p>لا توجد عمليات بعد</p>'}<button id="refreshactivity">تحديث السجل</button></section>`;
 layout(`<nav>${tabs.map(([id,label])=>`<button data-tab="${id}" class="${id===activeTab?'selected':''}">${label}</button>`).join('')}</nav>${content}<footer><small>المستخدم: ${esc(user.email)} — ${esc(profile.role)}</small><button id="logout">تسجيل الخروج</button></footer>`);
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=async()=>{await stopScanner();activeTab=b.dataset.tab;notice='';render()});document.getElementById('logout').onclick=logout;
 if(activeTab==='dashboard')document.getElementById('refresh').onclick=loadData;
 if(activeTab==='activity')document.getElementById('refreshactivity').onclick=loadData;
 if(activeTab==='medicines'){document.getElementById('search').oninput=e=>drawMeds(e.target.value);drawMeds('');if(document.getElementById('addmed')){document.getElementById('addmed').onsubmit=addMedicine;document.getElementById('receive').onsubmit=receive;}}
 if(activeTab==='sale'){document.getElementById('saleform').onsubmit=saveSale;document.getElementById('scan').onclick=startScanner;}
}
function drawMeds(query){const el=document.getElementById('medlist');if(!el)return;el.innerHTML=medicines.filter(m=>(m.name+' '+m.barcode).toLowerCase().includes(query.toLowerCase())).map(m=>`<div class="item"><strong>${esc(m.name)}</strong><span>أضافه: ${esc(people.find(p=>p.id===m.created_by)?.display_name||'غير معروف')} | ${esc(m.barcode)} | بيع ${money(m.sale_price)} | الصيدلية ${stock.find(s=>s.medicine_id===m.id&&s.location==='pharmacy')?.qty??0}</span></div>`).join('')||'<p>لا توجد نتائج</p>'}
async function login(e){e.preventDefault();const f=new FormData(e.target);const {error}=await supabase.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error)message(error.message);}
async function logout(){await stopScanner();await supabase.auth.signOut();user=null;profile=null;medicines=[];stock=[];activity=[];people=[];render();}
async function loadData(){
 if(!user)return;
 if(!online())return message('لا يوجد اتصال بالإنترنت. البيانات لا تُحفظ على الهاتف.');
 try{
  const p=await supabase.from('profiles').select('*').eq('id',user.id).single();
  if(p.error)throw p.error;
  profile=p.data;
  if(profile.active){
   const [m,s,a,pr]=await Promise.all([
    supabase.from('medicines').select('*').order('name'),
    supabase.from('stock').select('*'),
    supabase.from('stock_events').select('*').order('created_at',{ascending:false}).limit(100),
    supabase.from('profiles').select('id,display_name')
   ]);
   for(const r of [m,s,a,pr])if(r.error)throw r.error;
   medicines=m.data;stock=s.data;activity=a.data;people=pr.data;
  }
  notice='تم تحديث البيانات من السحابة';render();
 }catch(e){medicines=[];stock=[];activity=[];people=[];message('فشل تحميل البيانات السحابية: '+e.message);}
}
async function addMedicine(e){e.preventDefault();if(!online())return message('الإضافة تتطلب إنترنت');const f=new FormData(e.target);const {error}=await supabase.from('medicines').insert({name:f.get('name').trim(),barcode:f.get('barcode').trim(),purchase_price:Number(f.get('purchase_price')),sale_price:Number(f.get('sale_price'))});if(error)message(error.message);else await loadData();}
async function receive(e){e.preventDefault();if(!online())return message('الاستلام يتطلب إنترنت');const f=new FormData(e.target);const {error}=await supabase.rpc('receive_stock',{p_medicine:f.get('medicine_id'),p_location:f.get('location'),p_qty:Number(f.get('qty'))});if(error)message(error.message);else await loadData();}
async function saveSale(e){
 e.preventDefault();
 if(!online())return message('البيع يحتاج إنترنت. لم يتم حفظ أي فاتورة.');
 const f=new FormData(e.target),id=f.get('medicine_id'),qty=Number(f.get('qty'));
 if(!Number.isInteger(qty)||qty<=0)return message('كمية غير صحيحة');
 if(!medicines.some(m=>m.id===id))return message('الدواء غير موجود');
 const {error}=await supabase.rpc('commit_sale',{
  p_id:crypto.randomUUID(),p_location:'pharmacy',
  p_items:[{medicine_id:id,qty}]
 });
 if(error)return message('لم يتأكد البيع: '+error.message+' — تحقق من السجل قبل إعادة المحاولة.');
 await loadData();
 notice='تم تأكيد البيع في السحابة';render();
}
async function startScanner(){if(scanner){await stopScanner();return;}const reader=document.getElementById('reader');if(!reader)return;scanner=new Html5Qrcode('reader');try{await scanner.start({facingMode:'environment'},{fps:8,qrbox:{width:250,height:130}},async code=>{const med=medicines.find(m=>m.barcode===code);await stopScanner();if(med){document.getElementById('sale-med').value=med.id;message('تم اختيار '+med.name)}else message('الباركود غير مسجل: '+code);},()=>{});}catch(e){await stopScanner();message('تعذر فتح الكاميرا: '+e.message);}}
async function stopScanner(){if(scanner){try{if(scanner.isScanning)await scanner.stop();scanner.clear();}catch{}scanner=null;}}
window.addEventListener('online',()=>{if(user)loadData();else render()});window.addEventListener('offline',()=>{medicines=[];stock=[];activity=[];people=[];notice='انقطع الإنترنت؛ توقفت العمليات حتى عودته.';render()});
if(supabase){supabase.auth.onAuthStateChange((_event,session)=>{const next=session?.user||null;if(next?.id===user?.id)return;user=next;profile=null;medicines=[];stock=[];activity=[];people=[];if(user)loadData();else render();});supabase.auth.getSession().then(({data})=>{if(data.session?.user&&!user){user=data.session.user;loadData()}else render()});}else render();
