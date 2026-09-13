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
function memoryDatabase() { return { scopes:new Map(), unavailable:false }; }
function makeRuntime(env={}, database=memoryDatabase()) {
  let now=1_800_000_000_000;
  const testEnv={...credentials,VERCEL_ENV:'production',...env};
  const http={createServer:listener=>listener};
  const context=vm.createContext({http,crypto,Buffer,URL,process:{env:testEnv},
    Date:class extends Date {static now(){return now;}},
    createAdminSessionStore:({key})=>{
      const scope=key.toString('hex');
      if(!database.scopes.has(scope))database.scopes.set(scope,{sessions:new Map(),clients:new Map(),account:null});
      const state=database.scopes.get(scope);
      const check=()=>{if(database.unavailable)throw new Error('test database unavailable');};
      const consume=(old,limit)=>{const entry=!old || old.until<=now?{count:0,until:now+900000}:old;entry.count++;return entry;};
      return {
        async create(n,e){check();state.sessions.set(n,e);},
        async active(n){check();return (state.sessions.get(n)||0)>now;},
        async revoke(n){check();state.sessions.delete(n);},
        async consumeLogin(ip){
          check();state.account=consume(state.account,120);
          if(state.account.count>120)return {allowed:false,retryAfterSeconds:Math.ceil((state.account.until-now)/1000)};
          for(const [k,v] of state.clients)if(v.until<=now)state.clients.delete(k);
          const entry=consume(state.clients.get(ip),12);state.clients.set(ip,entry);
          return {allowed:entry.count<=12,retryAfterSeconds:Math.ceil((entry.until-now)/1000)};
        }
      };
    },
    readFile:async path=>path.pathname.endsWith('admin-login.html')?'LOGIN':'DASHBOARD'});
  const script=source.replace(/^import .+;\n/gm,'').replaceAll('import.meta.url',JSON.stringify('file:///test/src/admin-session-hook.mjs'));
  vm.runInContext(script+'\n;globalThis.probes={makeSession,validSession,sessionClaims,clientKey,sign,cookie,rate:ip=>sessionStore.consumeLogin(ip)};',context,{timeout:1000});
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
  return {...context.probes,request,database,env:testEnv,advance:ms=>{now+=ms;},now:()=>now,
    sessionCookie,valid:raw=>context.probes.validSession({headers:{cookie:sessionCookie(raw)}}),
    login:()=>request({method:'POST',url:'/api/v1/admin/session/login',headers:{origin},
      body:JSON.stringify({username:testEnv.BLOFY_ADMIN_USERNAME,password:testEnv.BLOFY_ADMIN_PASSWORD})})};
}

test('same configured credentials recognize a session across independent instances',async()=>{
  const database=memoryDatabase(),a=makeRuntime({},database),b=makeRuntime({},database);assert.equal(await b.valid(await a.makeSession()),true);
});
test('password rotation invalidates existing sessions without changing the API token',async()=>{
  const a=makeRuntime(),b=makeRuntime({BLOFY_ADMIN_PASSWORD:crypto.randomBytes(32).toString('hex')});
  assert.equal(await b.valid(await a.makeSession()),false);
});
test('username and admin token rotation also invalidate sessions',async()=>{
  const a=makeRuntime(),raw=await a.makeSession();
  for(const env of [{BLOFY_ADMIN_USERNAME:'other-test-admin'},{BLOFY_ADMIN_TOKEN:crypto.randomBytes(32).toString('hex')}])
    assert.equal(await makeRuntime(env).valid(raw),false);
});
test('old domainless sessions require reauthentication and are not silently accepted',async()=>{
  const a=makeRuntime();const payload=Buffer.from(JSON.stringify({u:a.env.BLOFY_ADMIN_USERNAME,e:a.now()+3600000,n:'legacy-test'})).toString('base64url');
  const sig=crypto.createHmac('sha256',a.env.BLOFY_ADMIN_TOKEN).update(payload).digest('base64url');
  assert.equal(await a.valid(payload+'.'+sig),false);
});
test('expiry boundary and malformed session values fail closed',async()=>{
  const a=makeRuntime(),raw=await a.makeSession();a.advance(8*60*60*1000-1);assert.equal(await a.valid(raw),true);
  a.advance(1);assert.equal(await a.valid(raw),false);
  for(const bad of ['',null,'invalid','x.y','a'.repeat(4096),raw.slice(0,-2)+'xx'])assert.equal(await a.valid(bad),false);
});
test('signed claims enforce version, bounded lifetime and numeric timestamps',async()=>{
  const a=makeRuntime();const issued={v:3,u:a.env.BLOFY_ADMIN_USERNAME,i:a.now(),e:a.now()+8*60*60*1000,n:'a'.repeat(22)};
  for(const change of [{v:1},{i:a.now()+60000,e:a.now()+60000+8*60*60*1000},{e:String(issued.e)},{e:issued.e+1},{n:'invalid'}, {u:'wrong'}]){
    const payload=Buffer.from(JSON.stringify({...issued,...change})).toString('base64url');
    assert.equal(await a.valid(payload+'.'+a.sign(payload)),false);
  }
});
test('credentials are absent from the cookie payload and security attributes remain',async()=>{
  const a=makeRuntime(),res=await a.login();assert.equal(res.status,200);
  const set=res.headers['set-cookie'];assert.match(set,/HttpOnly; Secure; SameSite=Strict/);
  assert.match(set,/Max-Age=28800/);assert.doesNotMatch(set,/Domain=/);
  const payload=Buffer.from(set.split('=')[1].split('.')[0],'base64url').toString('utf8');
  assert.equal(payload.includes(a.env.BLOFY_ADMIN_TOKEN),false);assert.equal(payload.includes(a.env.BLOFY_ADMIN_PASSWORD),false);
});
test('per-client login budget is shared across instances and recovers after its window',async()=>{
  const database=memoryDatabase(),a=makeRuntime({},database),b=makeRuntime({},database);
  for(let i=0;i<12;i++)assert.equal((await (i%2?a:b).rate('test-client')).allowed,true);
  for(let i=0;i<50;i++)assert.equal((await a.rate('test-client')).allowed,false);
  a.advance(900000);b.advance(900000);assert.equal((await b.rate('test-client')).allowed,true);
});
test('rotating client keys cannot bypass the shared account budget',async()=>{
  const a=makeRuntime();
  for(let i=0;i<120;i++)assert.equal((await a.rate('client-'+i)).allowed,true);
  for(let i=0;i<30;i++)assert.equal((await a.rate('other-'+i)).allowed,false);
  a.advance(900000);assert.equal((await a.rate('new')).allowed,true);
});
test('forwarded headers are trusted only for Vercel, preferring its protected client header',async()=>{
  const req={headers:{'x-forwarded-for':'spoofed','x-vercel-forwarded-for':'platform'},socket:{remoteAddress:'direct'}};
  assert.equal(makeRuntime().clientKey(req),'platform');
  assert.equal(makeRuntime({VERCEL_ENV:undefined}).clientKey(req),'direct');
});
test('production rejects other origins, the HTTP version of its own host and malformed origins',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(await a.makeSession());
  for(const bad of ['http://'+host,'https://other.invalid',origin+':444',origin+'/',origin+'?x',origin+'#x','null','',origin+'.attacker.invalid']){
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers:{cookie,origin:bad}});
    assert.equal(res.status,403,bad);
  }
});
test('an unrelated Authorization header cannot bypass the missing-Origin cookie guard',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(await a.makeSession());
  for(const authorization of ['', 'Bearer not-valid', 'Basic not-valid']){
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers:{cookie,authorization}});
    assert.equal(res.status,403);
  }
});
test('same-origin admin cookies and actual bearer API clients still work',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(await a.makeSession());
  for(const headers of [{cookie,origin},{authorization:'Bearer '+a.env.BLOFY_ADMIN_TOKEN},
    {cookie,authorization:'Bearer '+a.env.BLOFY_ADMIN_TOKEN}]){
    const res=await a.request({method:'POST',url:'/api/v1/admin/experience/releases',headers});assert.equal(res.status,200);
  }
});
test('loopback HTTP works only for undeployed non-production local integration',async()=>{
  for(const [env,expected] of [[{VERCEL_ENV:undefined,NODE_ENV:undefined},200],[{VERCEL_ENV:'preview'},403],
    [{VERCEL_ENV:'production'},403],[{VERCEL_ENV:undefined,NODE_ENV:'production'},403]]){
    const a=makeRuntime(env),cookie=a.sessionCookie(await a.makeSession());
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
  assert.equal((await a.request({url:'/admin',headers:{cookie:a.sessionCookie(await a.makeSession())}})).body,'DASHBOARD');
});
test('logout revokes only that session across instances and rejects replay',async()=>{
  const database=memoryDatabase(),a=makeRuntime({},database),b=makeRuntime({},database),raw=await a.makeSession(),other=await b.makeSession();
  const res=await a.request({method:'POST',url:'/api/v1/admin/session/logout',headers:{cookie:a.sessionCookie(raw),origin}});
  assert.equal(res.status,200);assert.match(res.headers['set-cookie'],/Max-Age=0/);
  assert.equal(await b.valid(raw),false);assert.equal(await a.valid(other),true);
  const replay=await b.request({url:'/api/v1/admin/test',headers:{cookie:b.sessionCookie(raw)}});
  assert.equal(replay.status,401);
});


test('a signed cookie without a persisted session is rejected',async()=>{
  const a=makeRuntime(),b=makeRuntime();
  assert.equal(await b.valid(await a.makeSession()),false);
});
test('database failure denies login and cookie access, but preserves bearer and customer routes',async()=>{
  const a=makeRuntime(),cookie=a.sessionCookie(await a.makeSession());a.database.unavailable=true;
  assert.equal((await a.login()).status,503);
  assert.equal((await a.request({url:'/api/v1/admin/test',headers:{cookie}})).status,503);
  const failed=await a.request({method:'POST',url:'/api/v1/admin/session/logout',headers:{cookie,origin}});
  assert.equal(failed.status,503);assert.equal(failed.headers['set-cookie'],undefined);
  assert.equal((await a.request({url:'/api/v1/admin/test',headers:{cookie,authorization:'Bearer '+a.env.BLOFY_ADMIN_TOKEN}})).status,200);
  assert.equal((await a.request({url:'/health',headers:{cookie}})).status,200);
});
