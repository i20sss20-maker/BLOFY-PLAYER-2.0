import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Executes the actual hook with in-memory HTTP/file doubles and generated test credentials.
// No requests to production, no database mutation, no real credentials, no dependencies.
const path=process.env.BLOFY_ADMIN_HOOK_SOURCE || new URL('../src/admin-session-hook.mjs',import.meta.url);
const source=await readFile(path,'utf8');
const credentials={BLOFY_ADMIN_TOKEN:crypto.randomBytes(32).toString('hex'),
  BLOFY_ADMIN_USERNAME:'unit-test-admin',BLOFY_ADMIN_PASSWORD:crypto.randomBytes(32).toString('hex')};
const host='blofy-player-2-0.vercel.app', origin='https://'+host;
function makeRuntime(env={}) {
  let now=1_800_000_000_000;
  const testEnv={...credentials,VERCEL_ENV:'production',...env};
  const http={createServer:listener=>listener};
  const context=vm.createContext({http,crypto,Buffer,URL,process:{env:testEnv},
    Date:class extends Date {static now(){return now;}},
    readFile:async path=>path.pathname.endsWith('admin-login.html')?'LOGIN':'DASHBOARD'});
  const script=source.replace(/^import .+;\n/gm,'').replaceAll('import.meta.url',JSON.stringify('file:///test/src/admin-session-hook.mjs'));
  vm.runInContext(script+'\n;globalThis.probes={makeSession,validSession,rateAllowed,sign,cookie,size:()=>loginAttempts.size};',context,{timeout:1000});
  const handler=http.createServer((req,res)=>{
    const isAdmin=req.url.startsWith('/api/v1/admin/');
    res.writeHead(!isAdmin || req.headers.authorization==='Bearer '+testEnv.BLOFY_ADMIN_TOKEN?200:401,{});
    res.end('DOWNSTREAM');
  });
  async function request({method='GET',url='/health',headers={},body='',chunks}={}) {
    const req={method,url,headers:{host,...headers},socket:{remoteAddress:'127.0.0.1'},
      async *[Symbol.asyncIterator](){for(const b of chunks || [Buffer.from(body)])yield b;}};
    const res={status:0,headers:{},body:'',headersSent:false,writableEnded:false,
      writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;return this;},
      end(body=''){this.body=String(body);this.writableEnded=true;},destroy(){this.destroyed=true;}};
    await handler(req,res);return res;
  }
  const sessionCookie=raw=>'blofy_admin_session='+raw;
  return {...context.probes,request,env:testEnv,advance:ms=>{now+=ms;},now:()=>now,
    sessionCookie,valid:raw=>context.probes.validSession({headers:{cookie:sessionCookie(raw)}}),
    login:()=>request({method:'POST',url:'/api/v1/admin/session/login',headers:{origin},
      body:JSON.stringify({username:testEnv.BLOFY_ADMIN_USERNAME,password:testEnv.BLOFY_ADMIN_PASSWORD})})};
}

test('same configured credentials recognize a session across independent instances',()=>{
  const a=makeRuntime(),b=makeRuntime();assert.equal(b.valid(a.makeSession()),true);
});
test('password rotation invalidates existing sessions without changing the API token',()=>{
  const a=makeRuntime(),b=makeRuntime({BLOFY_ADMIN_PASSWORD:crypto.randomBytes(32).toString('hex')});
  assert.equal(b.valid(a.makeSession()),false);
});
test('username and admin token rotation also invalidate sessions',()=>{
  const a=makeRuntime(),raw=a.makeSession();
  for(const env of [{BLOFY_ADMIN_USERNAME:'other-test-admin'},{BLOFY_ADMIN_TOKEN:crypto.randomBytes(32).toString('hex')}])
    assert.equal(makeRuntime(env).valid(raw),false);
});
test('old domainless sessions require reauthentication and are not silently accepted',()=>{
  const a=makeRuntime();const payload=Buffer.from(JSON.stringify({u:a.env.BLOFY_ADMIN_USERNAME,e:a.now()+3600000,n:'legacy-test'})).toString('base64url');
  const sig=crypto.createHmac('sha256',a.env.BLOFY_ADMIN_TOKEN).update(payload).digest('base64url');
  assert.equal(a.valid(payload+'.'+sig),false);
});
test('expiry boundary and malformed session values fail closed',()=>{
  const a=makeRuntime(),raw=a.makeSession();a.advance(8*60*60*1000-1);assert.equal(a.valid(raw),true);
  a.advance(1);assert.equal(a.valid(raw),false);
  for(const bad of ['',null,'invalid','x.y','a'.repeat(4096),raw.slice(0,-2)+'xx'])assert.equal(a.valid(bad),false);
});
test('signed claims enforce version, bounded lifetime and numeric timestamps',()=>{
  const a=makeRuntime();const issued={v:2,u:a.env.BLOFY_ADMIN_USERNAME,i:a.now(),e:a.now()+8*60*60*1000,n:'a'.repeat(22)};
  for(const change of [{v:1},{i:a.now()+60000,e:a.now()+60000+8*60*60*1000},{e:String(issued.e)},{e:issued.e+1},{n:'invalid'}, {u:'wrong'}]){
    const payload=Buffer.from(JSON.stringify({...issued,...change})).toString('base64url');
    assert.equal(a.valid(payload+'.'+a.sign(payload)),false);
  }
});
test('credentials are absent from the cookie payload and security attributes remain',async()=>{
  const a=makeRuntime(),res=await a.login();assert.equal(res.status,200);
  const set=res.headers['set-cookie'];assert.match(set,/HttpOnly; Secure; SameSite=Strict/);
  assert.match(set,/Max-Age=28800/);assert.doesNotMatch(set,/Domain=/);
  const payload=Buffer.from(set.split('=')[1].split('.')[0],'base64url').toString('utf8');
  assert.equal(payload.includes(a.env.BLOFY_ADMIN_TOKEN),false);assert.equal(payload.includes(a.env.BLOFY_ADMIN_PASSWORD),false);
});
test('per-client login budget is twelve requests and recovers after its time window',()=>{
  const a=makeRuntime(),req={headers:{},socket:{remoteAddress:'test-client'}};
  for(let i=0;i<12;i++)assert.equal(a.rateAllowed(req),true);
  for(let i=0;i<50;i++)assert.equal(a.rateAllowed(req),false);
  a.advance(15*60*1000);assert.equal(a.rateAllowed(req),true);
});
test('unique active clients cannot grow limiter memory past its fixed cap or evict old counters',()=>{
  const a=makeRuntime();
  for(let i=0;i<2050;i++)a.rateAllowed({headers:{'x-forwarded-for':'test-client-'+i}});
  assert.equal(a.size(),2000);
  const req={headers:{'x-forwarded-for':'test-client-0'}};
  for(let i=0;i<11;i++)assert.equal(a.rateAllowed(req),true);
  assert.equal(a.rateAllowed(req),false);
  a.advance(15*60*1000);assert.equal(a.rateAllowed({headers:{'x-forwarded-for':'new'}}),true);assert.equal(a.size(),1);
});
test('production rejects other origins, the HTTP version of its own host and malformed origins',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(a.makeSession());
  for(const bad of ['http://'+host,'https://other.invalid',origin+':444',origin+'/',origin+'?x',origin+'#x','null','',origin+'.attacker.invalid']){
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers:{cookie,origin:bad}});
    assert.equal(res.status,403,bad);
  }
});
test('an unrelated Authorization header cannot bypass the missing-Origin cookie guard',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(a.makeSession());
  for(const authorization of ['', 'Bearer not-valid', 'Basic not-valid']){
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers:{cookie,authorization}});
    assert.equal(res.status,403);
  }
});
test('same-origin admin cookies and actual bearer API clients still work',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(a.makeSession());
  for(const headers of [{cookie,origin},{authorization:'Bearer '+a.env.BLOFY_ADMIN_TOKEN},
    {cookie,authorization:'Bearer '+a.env.BLOFY_ADMIN_TOKEN}]){
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers});assert.equal(res.status,200);
  }
});
test('loopback HTTP works only for undeployed non-production local integration',async()=>{
  for(const [env,expected] of [[{VERCEL_ENV:undefined,NODE_ENV:undefined},200],[{VERCEL_ENV:'preview'},403],
    [{VERCEL_ENV:'production'},403],[{VERCEL_ENV:undefined,NODE_ENV:'production'},403]]){
    const a=makeRuntime(env),cookie=a.sessionCookie(a.makeSession());
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers:{host:'127.0.0.1:8097',origin:'http://127.0.0.1:8097',cookie}});
    assert.equal(res.status,expected);
  }
});
test('bounded JSON parser preserves Unicode split across transport chunks and rejects nonobjects',async()=>{
  const a=makeRuntime({BLOFY_ADMIN_PASSWORD:'كلمة-للاختبار-فقط'});
  const body=Buffer.from(JSON.stringify({username:a.env.BLOFY_ADMIN_USERNAME,password:a.env.BLOFY_ADMIN_PASSWORD}));
  const res=await a.request({method:'POST',url:'/api/v1/admin/session/login',headers:{origin},chunks:Array.from(body,b=>Buffer.from([b]))});
  assert.equal(res.status,200);
  for(const body of ['null','[]','true','"string"','{',' '.repeat(8193)]){
    const failed=await a.request({method:'POST',url:'/api/v1/admin/session/login',headers:{origin},body});assert.equal(failed.status,401);
  }
});
test('missing configuration and wrong credentials never mint sessions',async()=>{
  assert.equal((await makeRuntime({BLOFY_ADMIN_PASSWORD:''}).login()).status,503);
  const res=await makeRuntime().request({method:'POST',url:'/api/v1/admin/session/login',headers:{origin},body:'{}'});
  assert.equal(res.status,401);assert.equal(res.headers['set-cookie'],undefined);
});
test('customer, streaming, update metadata and ordinary portal routes pass through unchanged',async()=>{
  const a=makeRuntime();
  for(const url of ['/health','/portal','/download/latest.apk','/api/v1/subscribers/session','/api/v1/activation/check','/api/v1/portal/playlists']){
    const res=await a.request({method:'POST',url,headers:{origin:'https://example.invalid'},body:'{}'});
    assert.equal(res.status,200);assert.equal(res.body,'DOWNSTREAM');
  }
});
test('canonical admin redirect and login/dashboard selection are preserved',async()=>{
  const a=makeRuntime();
  for(const url of ['/Admin','/Admin/','/admin/'])assert.equal((await a.request({url})).headers.location,'/admin');
  assert.equal((await a.request({url:'/admin'})).body,'LOGIN');
  assert.equal((await a.request({url:'/admin',headers:{cookie:a.sessionCookie(a.makeSession())}})).body,'DASHBOARD');
});
test('logout clears the browser cookie but makes no false claim of server-side token revocation',async()=>{
  const a=makeRuntime(),raw=a.makeSession();
  const res=await a.request({method:'POST',url:'/api/v1/admin/session/logout',headers:{cookie:a.sessionCookie(raw),origin}});
  assert.equal(res.status,200);assert.match(res.headers['set-cookie'],/Max-Age=0/);
  assert.equal(a.valid(raw),true,'durable individual-session revocation is a separate remaining requirement');
});

test('real loopback HTTP: login, authorized API, CSRF rejection and logout',async()=>{
  const {default:http}=await import('node:http');
  const {pathToFileURL}=await import('node:url');
  const keys=[...Object.keys(credentials),'VERCEL_ENV','NODE_ENV'];
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const original=http.createServer;let server;
  try {
    Object.assign(process.env,credentials,{NODE_ENV:'test'});delete process.env.VERCEL_ENV;
    const moduleUrl=path instanceof URL?new URL(path):pathToFileURL(path);
    moduleUrl.searchParams.set('httpSmoke',crypto.randomBytes(8).toString('hex'));
    await import(moduleUrl.href);
    server=http.createServer((req,res)=>{
      res.writeHead(req.headers.authorization==='Bearer '+credentials.BLOFY_ADMIN_TOKEN?200:401,{'content-type':'application/json'});
      res.end('{"ok":true}');
    });
    http.createServer=original;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port;
    const login=await fetch(base+'/api/v1/admin/session/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},
      body:JSON.stringify({username:credentials.BLOFY_ADMIN_USERNAME,password:credentials.BLOFY_ADMIN_PASSWORD})});
    assert.equal(login.status,200);await login.text();const cookie=login.headers.get('set-cookie').split(';')[0];
    for(const [headers,expected] of [[{cookie,origin:base},200],[{cookie,authorization:'Bearer incorrect'},403],
      [{cookie,origin:'https://other.invalid'},403],[{authorization:'Bearer '+credentials.BLOFY_ADMIN_TOKEN},200]]){
      const response=await fetch(base+'/api/v1/admin/test',{method:'POST',headers,body:'{}'});
      assert.equal(response.status,expected);await response.text();
    }
    const logout=await fetch(base+'/api/v1/admin/session/logout',{method:'POST',headers:{cookie,origin:base},body:'{}'});
    assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);await logout.text();
  } finally {
    http.createServer=original;
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
  }
});
