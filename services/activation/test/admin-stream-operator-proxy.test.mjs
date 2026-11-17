import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {
  operatorProxyPath,operatorProxyMethod,operatorProxyTarget,proxyStreamOperator,distributorProxyPath,proxyStreamDistributor
} from '../src/admin-stream-operator-proxy.mjs';
const token='test-website-to-stream-backend-secret-123456789012345678';
async function withProxy(fetchImpl,run,secret=token){
  const app=http.createServer((req,res)=>void proxyStreamOperator(req,res,{secret,fetchImpl}));
  app.listen(0,'127.0.0.1');await once(app,'listening');
  try{await run('http://127.0.0.1:'+app.address().port);}
  finally{await new Promise(resolve=>app.close(resolve));}
}
test('operator allows only original UI, API and protected video route',()=>{
  assert.equal(operatorProxyPath('/operator'),true);
  assert.equal(operatorProxyPath('/operator/api/overview'),true);
  for(const path of ['/','/admin','/operatorX','/distributor','/operator/api','/internal/secret'])
    assert.equal(operatorProxyPath(path),false,path);
  assert.equal(operatorProxyMethod('POST','/operator'),false);
  assert.equal(operatorProxyMethod('POST','/operator/api/codes'),true);
  assert.equal(operatorProxyMethod('DELETE','/operator/api/codes'),false);
});
test('upstream stays fixed even when request target is misleading',()=>{
  assert.equal(operatorProxyTarget('/operator/api/state?day=1'),
    'https://blofy-stream-api-production.up.railway.app/operator/api/state?day=1');
  assert.equal(operatorProxyTarget('/admin/control-center?foo=bar','/operator'),
    'https://blofy-stream-api-production.up.railway.app/operator?foo=bar');
  assert.throws(()=>operatorProxyTarget('/internal/secret'));
});
test('GET passes the real console HTML unchanged with its nonce CSP',async()=>{
  await withProxy(async (url,options)=>{
    assert.equal(url,'https://blofy-stream-api-production.up.railway.app/operator');
    assert.match(options.headers.authorization,/^Basic /);
    assert.equal(Buffer.from(options.headers.authorization.slice(6),'base64').toString('utf8'),'operator:'+token);
    return new Response('<html><script nonce="ABC">ok()</script></html>',{
      status:200,headers:{'content-type':'text/html; charset=utf-8',
        'content-security-policy':"default-src 'none'; script-src 'nonce-ABC'; connect-src 'self'; media-src 'self' blob:"}
    });
  },async base=>{
    const response=await fetch(base+'/operator');
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/nonce-ABC/);
    assert.equal(await response.text(),'<html><script nonce="ABC">ok()</script></html>');
  });
});
test('video Range, Content-Range and media bytes survive same-origin proxy',async()=>{
  await withProxy(async (url,options)=>{
    assert.equal(url,'https://blofy-stream-api-production.up.railway.app/operator/api/live/live-123456789abc/playlist.m3u8');
    assert.equal(options.headers.range,'bytes=0-3');
    return new Response('abcd',{status:206,headers:{
      'content-type':'video/mp2t','content-range':'bytes 0-3/100',
      'accept-ranges':'bytes','content-length':'4'
    }});
  },async base=>{
    const response=await fetch(base+'/operator/api/live/live-123456789abc/playlist.m3u8',{headers:{range:'bytes=0-3'}});
    assert.equal(response.status,206);
    assert.equal(response.headers.get('content-range'),'bytes 0-3/100');
    assert.equal(response.headers.get('accept-ranges'),'bytes');
    assert.equal(await response.text(),'abcd');
  });
});
test('POST action forwarded to upstream without exposing request browser cookies',async()=>{
  await withProxy(async (url,options)=>{
    assert.equal(url,'https://blofy-stream-api-production.up.railway.app/operator/api/codes');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['x-blofy-operator-action'],'code-issue');
    assert.ok(!('cookie' in options.headers));
    assert.equal(Buffer.from(options.body).toString('utf8'),'{"count":1}');
    return Response.json({ok:true});
  },async base=>{
    const response=await fetch(base+'/operator/api/codes',{
      method:'POST',headers:{cookie:'blofy_admin_session=never-forward',
        'content-type':'application/json','x-blofy-operator-action':'code-issue'},
      body:'{"count":1}'
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true});
  });
});
test('upstream invalid credential is sanitized and browser is never prompted for Basic',async()=>{
  await withProxy(async()=>new Response('operator secret invalid',{status:401,
    headers:{'www-authenticate':'Basic realm="operator"'}}),async base=>{
    const response=await fetch(base+'/operator');
    assert.equal(response.status,502);
    assert.equal(response.headers.get('www-authenticate'),null);
    assert.equal((await response.json()).code,'operator_bridge_auth_failed');
  });
});
test('no secret means fail closed',async()=>{
  await withProxy(async()=>{throw Error('must not connect');},async base=>{
    const response=await fetch(base+'/operator');
    assert.equal(response.status,503);
  },'');
});


async function withReseller(fetchImpl,run){
 const app=http.createServer((req,res)=>void proxyStreamDistributor(req,res,{fetchImpl}));
 app.listen(0,'127.0.0.1');await once(app,'listening');
 try{await run('http://127.0.0.1:'+app.address().port);}
 finally{await new Promise(resolve=>app.close(resolve));}
}
test('reseller portal is same origin with independent cookie and no admin credentials',async()=>{
 assert.equal(distributorProxyPath('/distributor'),true);
 assert.equal(distributorProxyPath('/distributor/api/login'),true);
 assert.equal(distributorProxyPath('/internal/distributor'),false);
 await withReseller(async (url,options)=>{
   assert.equal(url,'https://blofy-stream-api-production.up.railway.app/distributor');
   assert.ok(!('authorization' in options.headers));
   assert.ok(!('cookie' in options.headers));
   return new Response('<html><title>لوحة توزيع</title></html>',{
     headers:{'content-type':'text/html; charset=utf-8'}});
 },async base=>{
   const response=await fetch(base+'/distributor');
   assert.equal(response.status,200);
   assert.match(await response.text(),/لوحة توزيع/);
 });
});
test('reseller POST rewrites backend Origin only after website caller has verified true origin',async()=>{
 const distToken='A'.repeat(43);
 await withReseller(async (url,options)=>{
   assert.equal(url,'https://blofy-stream-api-production.up.railway.app/distributor/api/login');
   assert.equal(options.headers.origin,'https://blofy-stream-api-production.up.railway.app');
   assert.equal(options.headers['x-blofy-distributor-action'],'login');
   assert.equal(options.headers.cookie,'blofy_dist='+distToken);
   assert.equal(Buffer.from(options.body).toString('utf8'),'{"username":"test"}');
   assert.ok(!('authorization' in options.headers));
   return new Response('{"ok":true}',{status:200,headers:{
     'content-type':'application/json',
     'set-cookie':'blofy_dist='+distToken+'; Path=/distributor; Max-Age=43200; HttpOnly; Secure; SameSite=Strict'
   }});
 },async base=>{
   const response=await fetch(base+'/distributor/api/login',{
     method:'POST',headers:{'origin':'https://blofyplayer.com',
       'cookie':'blofy_admin_session=forbidden; blofy_dist='+distToken,
       'x-blofy-distributor-action':'login','content-type':'application/json'},
     body:'{"username":"test"}'
   });
   assert.equal(response.status,200);
   assert.match(response.headers.get('set-cookie'),/^blofy_dist=/);
   assert.doesNotMatch(response.headers.get('set-cookie'),/blofy_admin_session/);
 });
});


test('operator business policy 403 is not turned into a false bridge 502',async()=>{
  await withProxy(async()=>Response.json({
    ok:false,code:'operator_action_header_required'
  },{status:403,headers:{'content-type':'application/json; charset=utf-8'}}),async base=>{
    const response=await fetch(base+'/operator/api/codes',{
      method:'POST',headers:{'content-type':'application/json',
      'x-blofy-operator-action':'bad-action'},body:'{}'
    });
    assert.equal(response.status,403);
    assert.deepEqual(await response.json(),{ok:false,code:'operator_action_header_required'});
  });
});

test('upstream location redirect cannot move media or browser to another host',async()=>{
  await withProxy(async()=>new Response(null,{status:302,
    headers:{location:'https://malicious.invalid/redirect?key=do-not-leak'}}),async base=>{
    const response=await fetch(base+'/operator/api/state',{redirect:'manual'});
    assert.equal(response.status,502);
    assert.equal(response.headers.get('location'),null);
    assert.equal((await response.json()).code,'operator_upstream_redirect_not_allowed');
  });
});

test('admin shortcut links point to actual original STREAM tab IDs',async()=>{
  const {readFile}=await import('node:fs/promises');
  const admin=await readFile(new URL('../web/admin.html',import.meta.url),'utf8');
  for(const id of ['library','restream','accounts','codes','distributors','sources','diagnostics']){
    assert.ok(admin.includes('/admin/control-center#'+id),id);
  }
});
