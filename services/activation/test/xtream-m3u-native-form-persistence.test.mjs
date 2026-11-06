import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readControlForm,controlPage} from '../src/xtream-native-controls.mjs';

function requestFromForm(pairs){
  const raw=new URLSearchParams(pairs).toString();
  return {
    headers:{'content-type':'application/x-www-form-urlencoded'},
    async *[Symbol.asyncIterator](){yield Buffer.from(raw,'utf8')}
  };
}

test('actual native edit POST preserves a credentialed M3U link instead of silently discarding it',async()=>{
  const sourceLink='https://provider.example/get.php?username=testuser&password=fixture123&type=m3u_plus&output=ts';
  const data=await readControlForm(requestFromForm([
    ['name','صالح'],['baseUrl','https://provider.example'],
    ['m3uUrl',sourceLink],['username',''],['password',''],['priority','100']
  ]));
  assert.equal(data.name,'صالح');
  assert.equal(data.m3uUrl,sourceLink);
  assert.equal(data.baseUrl,'https://provider.example');
  assert.ok(!Object.hasOwn(data,'m3uRemove'));
});

test('actual native edit POST passes explicit M3U unlink operation',async()=>{
  const data=await readControlForm(requestFromForm([
    ['name','source'],['baseUrl','https://provider.example'],
    ['m3uUrl',''],['m3uRemove','yes'],['priority','100']
  ]));
  assert.equal(data.m3uRemove,'yes');
  assert.equal(data.m3uUrl,'');
});

test('native create also preserves authorized M3U link and rights flag',async()=>{
  const data=await readControlForm(requestFromForm([
    ['name','source'],['baseUrl','https://provider.example'],
    ['username','fixture'],['password','fixture'],['rightsConfirmed','yes'],
    ['m3uUrl','https://provider.example/playlist.m3u']
  ]));
  assert.equal(data.m3uUrl,'https://provider.example/playlist.m3u');
  assert.equal(data.rightsConfirmed,'yes');
});

test('M3U fields remain protected from duplicate post bodies and oversized form requests',async()=>{
  const link='https://provider.example/list.m3u';
  await assert.rejects(readControlForm(requestFromForm([
    ['m3uUrl',link],['m3uUrl',link]
  ])),/control_duplicate_field/);
  await assert.rejects(readControlForm(requestFromForm([
    ['m3uUrl','https://provider.example/'+('a'.repeat(13000))]
  ])),/control_form_too_large/);
});

test('source admin only shows configured state, never stored signed M3U URL',()=>{
  const source={
    id:'11111111-1111-4111-8111-111111111111',
    name:'صالح',baseUrl:'https://provider.example',
    m3uConfigured:true,enabled:true,publishCatalog:true,priority:100,
    counts:{live:1,movie:1,series:1,total:3}
  };
  const html=controlPage({items:[source]});
  assert.match(html,/M3U مرتبط/);
  assert.match(html,/name="m3uUrl"/);
  assert.match(html,/name="m3uRemove"/);
  assert.doesNotMatch(html,/password=fixture123/);
});

test('source-saving native route verifies M3U is persisted before success notice',async()=>{
  const hook=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  assert.match(hook,/if\(fields\.m3uRemove==='yes'\)body\.m3uUrl=null/);
  assert.match(hook,/else if\(fields\.m3uUrl\?\.trim\(\)\)body\.m3uUrl=fields\.m3uUrl/);
  assert.match(hook,/const saved=await patchServer\(id,body\)/);
  assert.match(hook,/const readback=await serverById\(id\)/);
  assert.match(hook,/Boolean\(readback\?\.m3u_url_secret\)!==expected/);
});
