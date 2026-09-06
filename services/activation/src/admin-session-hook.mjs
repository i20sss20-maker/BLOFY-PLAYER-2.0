import http from 'node:http';
import crypto from 'node:crypto';

const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const ADMIN_USERNAME = String(process.env.BLOFY_ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.BLOFY_ADMIN_PASSWORD || '').trim();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'blofy_admin_session';
const loginAttempts = new Map();

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  res.end(payload);
}
function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(body);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function readJson(req) {
  let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error('payload_too_large'); }
  return raw ? JSON.parse(raw) : {};
}
function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0,128);
}
function rateAllowed(req) {
  const now=Date.now(), key=clientKey(req), old=loginAttempts.get(key);
  const state=!old || old.resetAt<=now ? {count:0,resetAt:now+15*60*1000} : old;
  state.count += 1; loginAttempts.set(key,state);
  if (loginAttempts.size > 2000) for (const [k,v] of loginAttempts) if (v.resetAt<=now) loginAttempts.delete(k);
  return state.count <= 12;
}
function sign(payload) {
  return crypto.createHmac('sha256', ADMIN_TOKEN).update(payload).digest('base64url');
}
function makeSession() {
  const expires=Date.now()+SESSION_TTL_MS;
  const nonce=crypto.randomBytes(16).toString('base64url');
  const payload=Buffer.from(JSON.stringify({u:ADMIN_USERNAME,e:expires,n:nonce})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function parseCookies(req) {
  const out={}; String(req.headers.cookie||'').split(';').forEach(part=>{const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=part.slice(i+1).trim();}); return out;
}
function validSession(req) {
  if (!ADMIN_TOKEN || !ADMIN_USERNAME || !ADMIN_PASSWORD) return false;
  const raw=parseCookies(req)[COOKIE]; if(!raw) return false;
  const dot=raw.lastIndexOf('.'); if(dot<1) return false;
  const payload=raw.slice(0,dot), sig=raw.slice(dot+1); if(!safeEqual(sig,sign(payload))) return false;
  try { const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); return data.u===ADMIN_USERNAME && Number(data.e)>Date.now(); } catch { return false; }
}
function cookie(value,maxAgeSeconds) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
function loginPage(error='') {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLOFY Admin</title><style>body{margin:0;background:#0c0712;color:#fff;font-family:system-ui;min-height:100vh;display:grid;place-items:center}.box{width:min(92vw,430px);background:#1a1125;border:1px solid #624180;border-radius:24px;padding:28px}input,button{width:100%;box-sizing:border-box;padding:14px;margin-top:10px;border-radius:13px;font-size:16px}input{background:#100a18;color:#fff;border:1px solid #48335b}button{background:#7c3fd0;color:#fff;border:0;font-weight:700}.err{color:#ff9eae}</style><div class="box"><h1>إدارة BLOFY</h1><p>دخول المشرف</p><input id="u" autocomplete="username" placeholder="اسم المستخدم"><input id="p" type="password" autocomplete="current-password" placeholder="كلمة المرور"><button onclick="go()">دخول</button><p id="m" class="err">${error}</p></div><script>async function go(){m.textContent='';const r=await fetch('/api/v1/admin/session/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})});if(r.ok)location='/admin';else m.textContent='بيانات الدخول غير صحيحة'}</script>`;
}
function dashboardPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLOFY Admin</title><style>body{margin:0;background:#0c0712;color:#fff;font-family:system-ui;padding:18px}.top{display:flex;gap:8px;flex-wrap:wrap;align-items:center}input,button,select{padding:11px;border-radius:10px;border:1px solid #49365d;background:#181020;color:#fff}button{background:#7440bd}.danger{background:#7a2437}.card{background:#181020;border:1px solid #392848;border-radius:16px;padding:14px;margin-top:14px}.wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:820px}td,th{border-bottom:1px solid #352642;padding:9px;text-align:right}.muted{color:#b8a8c6}</style><div class="top"><h1 style="margin-left:auto">BLOFY Admin</h1><button onclick="logout()" class="danger">خروج</button></div><div class="card"><div class="top"><input id="q" placeholder="بحث: جهاز / اسم / جوال / بريد"><button onclick="load()">بحث</button><input id="device" placeholder="رقم الجهاز"><input id="plan" placeholder="plan key"><button onclick="grant()">تمديد يدوي</button></div><p id="msg" class="muted"></p></div><div class="card wrap"><table><thead><tr><th>الجهاز</th><th>العميل</th><th>الجوال</th><th>البريد</th><th>الحالة</th><th>الخطة</th><th>الانتهاء</th><th>آخر ظهور</th></tr></thead><tbody id="rows"></tbody></table></div><script>async function api(url,opt={}){const r=await fetch(url,opt);if(r.status===401){location='/admin';throw 0}return r}async function load(){const r=await api('/api/v1/admin/users?q='+encodeURIComponent(q.value));const x=await r.json();rows.innerHTML=(x.items||[]).map(v=>'<tr><td>'+v.device_id+'</td><td>'+(v.customer_name||'-')+'</td><td>'+(v.customer_phone||'-')+'</td><td>'+(v.customer_email||'-')+'</td><td>'+v.status+'</td><td>'+(v.plan_key||'-')+'</td><td>'+(v.expires_at?new Date(v.expires_at).toLocaleString('ar-SA'):'-')+'</td><td>'+(v.last_seen_at?new Date(v.last_seen_at).toLocaleString('ar-SA'):'-')+'</td></tr>').join('')}async function grant(){msg.textContent='جاري التمديد...';const r=await api('/api/v1/admin/grant',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:device.value.trim(),planKey:plan.value.trim()})});const x=await r.json();msg.textContent=r.ok?'تم التمديد بنجاح':'تعذر التمديد: '+(x.error||'error');if(r.ok)load()}async function logout(){await fetch('/api/v1/admin/session/logout',{method:'POST'});location='/admin'}load()</script>`;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedAdminSessionCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    let url; try{url=new URL(req.url||'/','http://localhost')}catch{return listener(req,res)}
    if (req.method==='GET' && url.pathname==='/admin') return html(res, validSession(req)?dashboardPage():loginPage());
    if (req.method==='POST' && url.pathname==='/api/v1/admin/session/login') {
      if (!rateAllowed(req)) return json(res,429,{error:'rate_limited'});
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_TOKEN) return json(res,503,{error:'admin_login_not_configured'});
      const body=await readJson(req).catch(()=>({}));
      if(!safeEqual(String(body.username||''),ADMIN_USERNAME) || !safeEqual(String(body.password||''),ADMIN_PASSWORD)) return json(res,401,{error:'invalid_credentials'});
      return json(res,200,{ok:true},{'set-cookie':cookie(makeSession(),Math.floor(SESSION_TTL_MS/1000))});
    }
    if (req.method==='POST' && url.pathname==='/api/v1/admin/session/logout') return json(res,200,{ok:true},{'set-cookie':cookie('',0)});
    if (url.pathname.startsWith('/api/v1/admin/') && validSession(req)) req.headers.authorization=`Bearer ${ADMIN_TOKEN}`;
    return listener(req,res);
  });
};
