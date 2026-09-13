import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const ADMIN_USERNAME = String(process.env.BLOFY_ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.BLOFY_ADMIN_PASSWORD || '').trim();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'blofy_admin_session';
const MAX_LOGIN_CLIENTS = 2000;
// Domain-separated sessions are invalidated when any admin credential changes.
// This intentionally requires one new admin login on deployment; device activation is unrelated.
const SESSION_KEY = crypto.createHmac('sha256', ADMIN_TOKEN)
  .update(JSON.stringify(['blofy-admin-session-v2', ADMIN_USERNAME, ADMIN_PASSWORD])).digest();
const loginAttempts = new Map();

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  res.end(payload);
}
function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag':'noindex', 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
  res.end(body);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function readJson(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size += bytes.length; if (size > 8192) throw new Error('payload_too_large');
    chunks.push(bytes);
  }
  const body=size?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
  return body;
}
function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0,128);
}
function rateAllowed(req) {
  const now=Date.now(), key=clientKey(req);
  if (loginAttempts.size >= MAX_LOGIN_CLIENTS) {
    for (const [k,v] of loginAttempts) if (v.resetAt<=now) loginAttempts.delete(k);
  }
  const old=loginAttempts.get(key);
  // Do not evict active counters: that would let a new key reset its failure budget.
  if (!old && loginAttempts.size >= MAX_LOGIN_CLIENTS) return false;
  const state=!old || old.resetAt<=now ? {count:0,resetAt:now+15*60*1000} : old;
  state.count = Math.min(state.count + 1, 13); loginAttempts.set(key,state);
  return state.count <= 12;
}
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');
}
function makeSession() {
  const issued=Date.now(), expires=issued+SESSION_TTL_MS;
  const nonce=crypto.randomBytes(16).toString('base64url');
  const payload=Buffer.from(JSON.stringify({v:2,u:ADMIN_USERNAME,i:issued,e:expires,n:nonce})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function parseCookies(req) {
  const out=Object.create(null); String(req.headers.cookie||'').split(';').forEach(part=>{const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=part.slice(i+1).trim();}); return out;
}
function validSession(req) {
  if (!ADMIN_TOKEN || !ADMIN_USERNAME || !ADMIN_PASSWORD) return false;
  const raw=parseCookies(req)[COOKIE]; if(!raw || raw.length>2048) return false;
  const dot=raw.lastIndexOf('.'); if(dot<1) return false;
  const payload=raw.slice(0,dot), sig=raw.slice(dot+1); if(!safeEqual(sig,sign(payload))) return false;
  try {
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')), now=Date.now();
    return data?.v===2 && data.u===ADMIN_USERNAME && Number.isSafeInteger(data.i) && Number.isSafeInteger(data.e) &&
      data.i<=now+30_000 && data.e-data.i===SESSION_TTL_MS && data.e>now &&
      typeof data.n==='string' && /^[A-Za-z0-9_-]{22}$/.test(data.n);
  } catch { return false; }
}
function sameOrigin(req) {
  try {
    const value=req.headers.origin, host=req.headers.host;
    if (typeof value!=='string' || typeof host!=='string' || !host) return false;
    const source=new URL(value), target=new URL('https://'+host);
    if (target.username || target.password || target.pathname!=='/' || target.search || target.hash) return false;
    if (source.origin!==value) return false;
    // Local integration tests may use HTTP; every deployed Vercel environment requires HTTPS.
    const local=!process.env.VERCEL_ENV && process.env.NODE_ENV!=='production' &&
      ['localhost','127.0.0.1','[::1]'].includes(target.hostname);
    if (local && source.protocol==='http:') target.protocol='http:';
    return source.origin===target.origin;
  } catch { return false; }
}
function validAdminBearer(req) {
  return !!ADMIN_TOKEN && safeEqual(req.headers.authorization||'', 'Bearer '+ADMIN_TOKEN);
}
function cookie(value,maxAgeSeconds) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
async function loginPage() { return readFile(new URL('../web/admin-login.html',import.meta.url),'utf8'); }
async function dashboardPage() { return readFile(new URL('../web/admin.html',import.meta.url),'utf8'); }

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedAdminSessionCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    try {
    let url; try{url=new URL(req.url||'/','http://localhost')}catch{return listener(req,res)}
    if (req.method==='GET' && ['/Admin','/Admin/','/admin/'].includes(url.pathname)) { res.writeHead(302,{'location':'/admin','cache-control':'no-store'}); res.end(); return; }
    if (req.method==='GET' && url.pathname==='/admin') return html(res, validSession(req)?await dashboardPage():await loginPage());
    if (!['GET','HEAD'].includes(req.method) && url.pathname.startsWith('/api/v1/admin/')) {
      const origin = req.headers.origin;
      if (origin !== undefined && !sameOrigin(req)) return json(res,403,{error:'invalid_origin'});
      // An arbitrary Authorization header must not exempt an authenticated cookie from CSRF checks.
      if (validSession(req) && !origin && !validAdminBearer(req)) return json(res,403,{error:'invalid_origin'});
    }
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
    } catch {
      if (!res.headersSent && !res.writableEnded) return json(res,503,{error:'admin_unavailable'});
      if (!res.writableEnded) res.destroy();
    }
  });
};
