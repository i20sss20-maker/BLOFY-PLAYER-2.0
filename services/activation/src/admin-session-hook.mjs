import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag':'noindex', 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
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
      if (origin && (()=>{try{return new URL(origin).host !== req.headers.host;}catch{return true;}})()) return json(res,403,{error:'invalid_origin'});
      if (validSession(req) && !origin && !req.headers.authorization) return json(res,403,{error:'invalid_origin'});
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
