import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { createCodeOperationsHandlers } from '../src/code-operations.mjs';

function harness({input = {},rows = [],verifyHost = async () => true} = {}) {
  const calls=[], responses=[];
  const pool={async query(query,params=[]){
    calls.push({query,params});
    if(query.includes('COUNT(*)::integer AS total FROM blofy_code_host_presets'))
      return {rows:[{total:0}]};
    if(query.startsWith('INSERT INTO blofy_code_host_presets'))
      return {rowCount:1,rows:[]};
    if(query.startsWith('DELETE FROM blofy_code_host_presets'))
      return {rowCount:1};
    if(query.startsWith('SELECT base_url FROM blofy_code_host_presets'))
      return {rows:[{base_url:'https://example.org'}]};
    if(query.startsWith('SELECT id,name,source,base_url'))
      return {rows:[]};
    if(query.includes('COUNT(*)::integer AS total,'))
      return {rows:[{total:5,enabled:3,revoked:1,expired:1,expiring:2,bound:3,unbound:0}]};
    if(query.includes('GROUP BY source_label'))return {rows:[{source:'BLOFY',count:5}]};
    if(query.includes('BETWEEN NOW() AND NOW() + INTERVAL'))
      return {rows:[]};
    return {rows,rowCount:rows.length};
  }};
  let admin=true;
  const api=createCodeOperationsHandlers({pool,secretHex:'12'.repeat(32),
    json:(_res,status,body)=>responses.push({status,body}),
    readJson:async()=>input,requireAdmin:()=>admin,verifyHost
  });
  return {api,calls,responses,deny:()=>admin=false};
}

test('code overview uses SQL aggregates across the full database, never page size',async()=>{
  const ctx=harness();await ctx.api.summary({},{});
  assert.equal(ctx.responses[0].status,200);
  assert.equal(ctx.responses[0].body.totals.total,5);
  assert.equal(ctx.responses[0].body.totals.expiring,2);
  assert.ok(ctx.calls.some(x=>x.query.includes('COUNT(*) FILTER')));
  assert.equal(JSON.stringify(ctx.responses[0]).includes('username_enc'),false);
});

test('global registry search is paginated, bound, parameterized and never exposes secrets',async()=>{
  const now=new Date();
  const sample={id:'99999999-9999-9999-9999-999999999999',active:true,device_id:'BLOFY-A31',
    source_label:'STROING 8K',created_at:now,expires_at:null,
    username_enc:'super-secret',password_enc:'super-secret'};
  const ctx=harness({rows:[sample]});
  const url=new URL('https://blofyplayer.com/api/v1/admin/code-ops/search?q=%25%27%20OR%201%3D1&status=bound&page=2');
  await ctx.api.search({}, {},url);
  assert.equal(ctx.responses[0].status,200);
  assert.equal(ctx.responses[0].body.items.length,1);
  assert.equal(ctx.responses[0].body.items[0].source,'STROING 8K');
  assert.equal(JSON.stringify(ctx.responses[0]).includes('super-secret'),false);
  const call=ctx.calls[0];
  assert.equal(call.query.includes('OR 1=1'),false);
  assert.equal(call.params.at(-1),50);
  assert.equal(call.params.at(-2),50);
  assert.equal(call.params[0].includes('\\%'),true);
});

test('host presets refuse malformed/private sources and do not store credentials',async()=>{
  const denied=harness({input:{name:'Private',source:'custom',host:'http://127.0.0.1:80'}});
  await denied.api.addHost({},{});
  assert.equal(denied.responses[0].status,400);
  assert.equal(denied.calls.length,0);
  const ctx=harness({input:{name:'STRONG 8K',source:'strong',host:'https://tv.example.org:443'}});
  await ctx.api.addHost({},{});
  assert.equal(ctx.responses[0].status,201);
  assert.equal(ctx.calls[1].query.startsWith('INSERT'),true);
  assert.equal(ctx.calls[1].params.some(p=>String(p).includes('password')),false);
  assert.equal(ctx.calls[1].params[1],'STRONG 8K');
  assert.equal(ctx.calls[1].params[3],'https://tv.example.org');
});

test('host DNS test never falsely reports a working IPTV subscription',async()=>{
  const ctx=harness();await ctx.api.checkHost({},{},'11111111-1111-1111-1111-111111111111');
  assert.equal(ctx.responses[0].status,200);
  assert.equal(ctx.responses[0].body.status,'dns_verified');
  assert.equal(ctx.responses[0].body.accountChecked,false);
});

test('admin authorization is required even for aggregate counts',async()=>{
  const ctx=harness();ctx.deny();await ctx.api.summary({},{});
  assert.equal(ctx.calls.length,0);
  assert.equal(ctx.responses.length,0);
});

test('admin page, CSS, JS and static mapping are shipped and parse safely',async()=>{
  const html=await readFile(new URL('../web/admin.html',import.meta.url),'utf8');
  const javascript=await readFile(new URL('../web/admin-code-ops.js',import.meta.url),'utf8');
  const stylesheet=await readFile(new URL('../web/admin-code-ops.css',import.meta.url),'utf8');
  const mapping=await readFile(new URL('../src/experience-handlers.mjs',import.meta.url),'utf8');
  new Script(javascript,{filename:'admin-code-ops.js'});
  for(const id of ['code-ops-stats','code-ops-alert-list','code-ops-host-form',
                   'code-ops-search-form','code-ops-csv','code-ops-bulk-start']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.ok(html.includes('/admin-code-ops.js'));
  assert.ok(stylesheet.includes('#codes-view .code-ops-grid'));
  assert.ok(mapping.includes("'/admin-code-ops.js':'admin-code-ops.js'"));
  assert.ok(javascript.includes('file.size>16_384'));
  assert.ok(javascript.includes('rows.length>20'));
  assert.equal(javascript.includes('localStorage.setItem'),false);
});
