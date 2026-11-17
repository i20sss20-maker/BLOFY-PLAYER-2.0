import test from 'node:test';
import assert from 'node:assert/strict';
import {SITE_OPERATOR_READINESS_TARGETS,probeSiteOperatorAction,siteOperatorReadiness}
  from '../src/site-operator-readiness.mjs';

const secret='LOCAL_READINESS_TEST_ONLY_SECRET_VALUE_12345678901';
const fixedOrigin='https://blofy-stream-api-production.up.railway.app';
const urlFor=t=>fixedOrigin+t.path;
const probe=(target,fetchImpl)=>probeSiteOperatorAction(target,{secret,fetchImpl,clock:()=>1000});

test('readiness checks exactly eight allowlisted existing STREAM GET routes',()=>{
  assert.equal(SITE_OPERATOR_READINESS_TARGETS.length,8);
  assert.deepEqual(SITE_OPERATOR_READINESS_TARGETS.map(x=>x.id),
    ['overview','sources','library','accounts','codes','distributors','restream','security']);
  for(const target of SITE_OPERATOR_READINESS_TARGETS){
    assert.ok(target.path.startsWith('/operator/api/'));
    assert.equal(new URL(target.path,fixedOrigin).origin,fixedOrigin);
    assert.ok(Object.isFrozen(target));
  }
});

test('no operator bridge token fails closed without external network calls',async()=>{
  let calls=0;
  const result=await probeSiteOperatorAction(SITE_OPERATOR_READINESS_TARGETS[0],{
    secret:'',fetchImpl:async()=>{calls++;throw Error('no network')}
  });
  assert.equal(calls,0);
  assert.equal(result.state,'unknown');
  assert.equal(result.code,'operator_bridge_not_configured');
});

test('exact fixed server address and read-only Basic token never leak to the browser',async()=>{
  const target=SITE_OPERATOR_READINESS_TARGETS[3];
  let calls=0;
  const result=await probe(target,async(url,opts)=>{
    calls++;
    assert.equal(url,urlFor(target));
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.headers.authorization,'Basic '+Buffer.from('operator:'+secret).toString('base64'));
    assert.equal(opts.headers['accept-encoding'],'identity');
    assert.equal(opts.headers.accept,'application/json');
    return Response.json({ok:true,password:'DO_NOT_RETURN_ACCOUNT_PASSWORD',accounts:[
      {username:'PRIVATE_ACCOUNT_NAME',password:'PRIVATE_PASSWORD'}]});
  });
  assert.equal(calls,1);
  assert.equal(result.state,'connected');
  assert.equal(result.code,'operator_read_ok');
  assert.equal(result.httpStatus,200);
  const flattened=JSON.stringify(result);
  assert.doesNotMatch(flattened,/DO_NOT_RETURN|PRIVATE_|Basic |operator:|PASSWORD|password|username/);
});

test('server 200 with ok:false is marked degraded, not healthy',async()=>{
  const out=await probe(SITE_OPERATOR_READINESS_TARGETS[0],
    async()=>Response.json({ok:false,code:'source_catalog_unavailable'}, {status:200}));
  assert.equal(out.state,'degraded');
  assert.equal(out.code,'operator_reported_unhealthy');
  assert.doesNotMatch(JSON.stringify(out),/source_catalog_unavailable/);
});

test('authentication, 404, server failure and redirect are not marked green',async()=>{
  const target=SITE_OPERATOR_READINESS_TARGETS[5];
  for(const [status,state] of [[401,'blocked'],[403,'blocked'],[404,'unavailable'],[502,'unavailable']]){
    const result=await probe(target,async()=>new Response('Sensitive server diagnostic',{status}));
    assert.equal(result.state,state);
    assert.equal(result.httpStatus,status);
    assert.doesNotMatch(JSON.stringify(result),/Sensitive/);
  }
  const redirect=await probe(target,async()=>new Response(null,{status:302,
    headers:{location:'https://untrusted.invalid/leak?key=SECRET'}}));
  assert.equal(redirect.state,'unknown');
  assert.equal(redirect.code,'operator_redirect_rejected');
  assert.doesNotMatch(JSON.stringify(redirect),/untrusted|SECRET/);
});

test('huge catalog response stays reachable only and is never returned or parsed',async()=>{
  const target=SITE_OPERATOR_READINESS_TARGETS[4];
  const large=JSON.stringify({ok:true,codes:Array(70000).fill('secret')});
  const response=await probe(target,async()=>new Response(large,{
    status:200,headers:{'content-type':'application/json'}
  }));
  assert.equal(response.state,'reachable');
  assert.equal(response.code,'operator_http_ok_only');
  assert.doesNotMatch(JSON.stringify(response),/secret/);
});

test('non-json body, network failure and unknown path fail safely',async()=>{
  const target=SITE_OPERATOR_READINESS_TARGETS[1];
  const nonJson=await probe(target,async()=>new Response('<html>login required</html>',{
    status:200,headers:{'content-type':'text/html'}
  }));
  assert.equal(nonJson.state,'reachable');
  const offline=await probe(target,async()=>{throw Error('PRIVATE URL CREDENTIAL')});
  assert.equal(offline.state,'unknown');
  assert.equal(offline.code,'operator_probe_network_error');
  assert.doesNotMatch(JSON.stringify(offline),/PRIVATE URL/);
  const arbitrary={id:'evil',label:'x',path:'https://127.0.0.1/private'};
  let called=0;
  const refused=await probe(arbitrary,async()=>{called++;return Response.json({ok:true})});
  assert.equal(called,0);
  assert.equal(refused.code,'unknown_readiness_target');
});

test('full site audit only performs GET and reports no unverified media claims',async()=>{
  let requests=0;
  const result=await siteOperatorReadiness({secret,fetchImpl:async(url,opts)=>{
    requests++;
    assert.equal(opts.method,'GET');
    assert.equal(new URL(url).origin,fixedOrigin);
    return Response.json({ok:true});
  }});
  assert.equal(requests,8);
  assert.equal(result.checks.length,8);
  assert.equal(result.summary.connected,8);
  assert.equal(result.summary.unavailable,0);
  assert.match(result.scope,/no POST/);
  assert.match(result.scope,/media transfer/);
});

test('admin monitor displays real subsystem readiness without making write actions',async()=>{
  const {readFile}=await import('node:fs/promises');
  const page=await readFile(new URL('../web/admin-control-center.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../web/admin-control-center.js',import.meta.url),'utf8');
  const service=await readFile(new URL('../src/admin-control-center.mjs',import.meta.url),'utf8');
  assert.match(page,/id="operator-readiness"/);
  assert.match(page,/id="operator-readiness-summary"/);
  assert.match(script,/showOperatorReadiness\(data\.operatorReadiness\)/);
  assert.match(script,/\/admin\/control-center#/);
  assert.match(service,/siteOperatorReadiness\(\)/);
  assert.doesNotMatch(page,/<script(?:\s|>)(?![^>]*src)/);
});
