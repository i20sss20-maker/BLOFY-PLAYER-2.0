import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAdminSessionStore } from './admin-session-store.mjs';
import { verifyNativeXtreamCsrf } from './xtream-native-csrf.mjs';

const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const ADMIN_USERNAME = String(process.env.BLOFY_ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.BLOFY_ADMIN_PASSWORD || '').trim();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'blofy_admin_session';
// Domain-separated sessions are invalidated when any admin credential changes.
// This intentionally requires one new admin login on deployment; device activation is unrelated.
const SESSION_KEY = crypto.createHmac('sha256', ADMIN_TOKEN)
  .update(JSON.stringify(['blofy-admin-session-v3', ADMIN_USERNAME, ADMIN_PASSWORD])).digest();
const sessionStore = createAdminSessionStore({ key: SESSION_KEY });

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
  res.end(payload);
}
function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy':'camera=(), microphone=(), geolocation=()', 'strict-transport-security':'max-age=31536000', 'x-robots-tag':'noindex', 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
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
  // Trust the platform's overwritten client header only inside a Vercel deployment.
  const forwarded = process.env.VERCEL_ENV && (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for']);
  return String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0,128);
}
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');
}
async function makeSession() {
  const issued=Date.now(), expires=issued+SESSION_TTL_MS;
  const nonce=crypto.randomBytes(16).toString('base64url');
  const payload=Buffer.from(JSON.stringify({v:3,u:ADMIN_USERNAME,i:issued,e:expires,n:nonce})).toString('base64url');
  await sessionStore.create(nonce, expires);
  return `${payload}.${sign(payload)}`;
}
function parseCookies(req) {
  const out=Object.create(null); String(req.headers.cookie||'').split(';').forEach(part=>{const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=part.slice(i+1).trim();}); return out;
}
function sessionClaims(req) {
  if (!ADMIN_TOKEN || !ADMIN_USERNAME || !ADMIN_PASSWORD) return false;
  const raw=parseCookies(req)[COOKIE]; if(!raw || raw.length>2048) return false;
  const dot=raw.lastIndexOf('.'); if(dot<1) return false;
  const payload=raw.slice(0,dot), sig=raw.slice(dot+1); if(!safeEqual(sig,sign(payload))) return false;
  try {
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')), now=Date.now();
    const valid = data?.v===3 && data.u===ADMIN_USERNAME && Number.isSafeInteger(data.i) && Number.isSafeInteger(data.e) &&
      data.i<=now+30_000 && data.e-data.i===SESSION_TTL_MS && data.e>now &&
      typeof data.n==='string' && /^[A-Za-z0-9_-]{22}$/.test(data.n);
    return valid ? data : false;
  } catch { return false; }
}
async function validSession(req) {
  const claims = sessionClaims(req);
  return !!claims && await sessionStore.active(claims.n);
}
function sameOrigin(req) {
  try {
    const value=req.headers.origin;
    const forwardedHost=String(req.headers['x-forwarded-host']||'').split(',')[0].trim();
    const directHost=String(req.headers.host||'').split(',')[0].trim();
    const host=forwardedHost||directHost;
    const forwardedProto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();
    const protocol=forwardedProto==='http'||forwardedProto==='https'?forwardedProto:'https';
    if (typeof value!=='string' || !host) return false;
    const source=new URL(value), target=new URL(`${protocol}://${host}`);
    if (target.username || target.password || target.pathname!=='/' || target.search || target.hash) return false;
    if (source.origin!==value) return false;
    // Local integration tests may use HTTP. Production proxies must provide the
    // public host/protocol through trusted forwarded headers.
    const local=!process.env.VERCEL_ENV && process.env.NODE_ENV!=='production' &&
      ['localhost','127.0.0.1','[::1]'].includes(target.hostname);
    if (local && source.protocol==='http:') target.protocol='http:';
    if (source.origin===target.origin) return true;
    // BLOFY's public website is served through an upstream reverse proxy on
    // Railway. Some requests arrive with Railway's internal forwarded host
    // while Chromium correctly sends Origin: https://blofyplayer.com for
    // native HTML form POSTs. Trust the *exact* canonical browser Origin in
    // that deployment, never arbitrary forwarded-host values or HTTP.
    // Browser Origin is not settable by cross-origin pages; authorization
    // still requires the existing signed admin session or admin bearer.
    return !process.env.VERCEL_ENV &&
      source.origin==='https://blofyplayer.com';
  } catch { return false; }
}
function validSignedXtreamControl(req,url) {
  if (req.method!=='POST' ||
    !/^\/api\/v1\/admin\/xtream\/controls\/(?:new\/add|[a-z0-9-]+\/(?:toggle-enabled|toggle-publish|test|probe-live|probe-movie|sync-all|sync-live|sync-movie|sync-series|cancel-sync|save|delete))$/i.test(url.pathname))
    return false;
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))
    return false;
  // Even a correct token must not override an explicitly foreign Origin.
  const claimedOrigin=String(req.headers.origin||'');
  if(claimedOrigin && claimedOrigin!=='null' &&
      claimedOrigin!=='https://blofyplayer.com' && !sameOrigin(req))return false;
  // Independent session-bound CSRF proof: an outside site cannot read this
  // token due to SOP, and it cannot mint a token for another cookie.
  if(!sessionClaims(req))return false;
  return verifyNativeXtreamCsrf(req,SESSION_KEY,url.searchParams.get('csrf'));
}
function validAdminBearer(req) {
  return !!ADMIN_TOKEN && safeEqual(req.headers.authorization||'', 'Bearer '+ADMIN_TOKEN);
}
function cookie(value,maxAgeSeconds) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
async function loginPage() { return readFile(new URL('../web/admin-login.html',import.meta.url),'utf8'); }
async function dashboardPage() { return readFile(new URL('../web/admin.html',import.meta.url),'utf8'); }
async function contentHubPage() { return readFile(new URL('../web/admin-content-hub.html',import.meta.url),'utf8'); }
async function blofyOnePage() { return readFile(new URL('../web/blofy-one.html',import.meta.url),'utf8'); }
async function blofyOnePreviewPage() { return readFile(new URL('../web/blofy-one-preview.html',import.meta.url),'utf8'); }

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedAdminSessionCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    try {
    let url; try{url=new URL(req.url||'/','http://localhost')}catch{return listener(req,res)}
    if (req.method==='GET' && ['/Admin','/Admin/','/admin/'].includes(url.pathname)) { res.writeHead(302,{'location':'/admin','cache-control':'no-store'}); res.end(); return; }
    if (req.method==='GET' && url.pathname==='/releases-admin') { res.writeHead(302,{'location':'/admin#releases','cache-control':'no-store'}); res.end(); return; }
    if (req.method==='GET' && url.pathname==='/admin') return html(res, await validSession(req)?await dashboardPage():await loginPage());
    // The private Content Hub dashboard is an admin subpage, not a public
    // route. Reuse exactly the same signed admin session as /admin.
    if (req.method==='GET' && url.pathname==='/admin/content-hub')
      return html(res,await validSession(req)?await contentHubPage():await loginPage());

    // BLOFY ONE uses the existing signed admin cookie and login page.
    // No separate admin users, tokens, customer store or session model.
    if (req.method==='GET' && url.pathname==='/one') return html(res, await validSession(req)?await blofyOnePage():await loginPage());
    if (req.method==='GET' && url.pathname==='/one/media-lab') return html(res, await validSession(req)?await blofyOnePreviewPage():await loginPage());
    if (!url.pathname.startsWith('/api/v1/admin/')) return listener(req,res);
    if (!['GET','HEAD'].includes(req.method) && url.pathname.startsWith('/api/v1/admin/')) {
      const origin=req.headers.origin;
      const signedNativeForm=validSignedXtreamControl(req,url);
      if (origin!==undefined && !sameOrigin(req) && !signedNativeForm)
        return json(res,403,{error:'invalid_origin'});
      // Keep the original strict Origin policy on every other admin request.
      if (sessionClaims(req) && !origin && !validAdminBearer(req) && !signedNativeForm)
        return json(res,403,{error:'invalid_origin'});
    }
    if (req.method==='POST' && url.pathname==='/api/v1/admin/session/login') {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_TOKEN) return json(res,503,{error:'admin_login_not_configured'});
      const rate = await sessionStore.consumeLogin(clientKey(req));
      if (!rate.allowed) return json(res,429,{error:'rate_limited'},{'retry-after':String(rate.retryAfterSeconds)});
      const body=await readJson(req).catch(()=>({}));
      if(!safeEqual(String(body.username||''),ADMIN_USERNAME) || !safeEqual(String(body.password||''),ADMIN_PASSWORD)) return json(res,401,{error:'invalid_credentials'});
      return json(res,200,{ok:true},{'set-cookie':cookie(await makeSession(),Math.floor(SESSION_TTL_MS/1000))});
    }
    if (req.method==='POST' && url.pathname==='/api/v1/admin/session/logout') {
      const claims = sessionClaims(req);
      if (claims) await sessionStore.revoke(claims.n);
      return json(res,200,{ok:true},{'set-cookie':cookie('',0)});
    }
    if (!validAdminBearer(req) && await validSession(req)) req.headers.authorization=`Bearer ${ADMIN_TOKEN}`;
    return listener(req,res);
    } catch {
      if (!res.headersSent && !res.writableEnded) return json(res,503,{error:'admin_unavailable'});
      if (!res.writableEnded) res.destroy();
    }
  });
};
