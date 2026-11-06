import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {mergeXtreamPlayerRequest} from '../src/xtream-player-post.mjs';

const input=(method,type,body)=>Object.assign(
  Readable.from([Buffer.from(body||'')]),
  {method,headers:{'content-type':type}}
);

test('Xtream POST form works for standard login and category actions',async()=>{
  const request=input('POST','application/x-www-form-urlencoded; charset=UTF-8',
    'username=demo_user&password=example_only&action=get_live_categories');
  const value=await mergeXtreamPlayerRequest(request,new URL('https://localhost/player_api.php'));
  assert.equal(value.searchParams.get('username'),'demo_user');
  assert.equal(value.searchParams.get('password'),'example_only');
  assert.equal(value.searchParams.get('action'),'get_live_categories');
});

test('Xtream JSON POST supports actions and preserves explicit URL credentials',async()=>{
  const request=input('POST','application/json',
    JSON.stringify({username:'form_user',password:'temporary_test_password',action:'get_vod_streams',category_id:'42'}));
  const url=new URL('https://localhost/panel_api.php?username=url_user');
  const value=await mergeXtreamPlayerRequest(request,url);
  assert.equal(value.searchParams.get('username'),'url_user');
  assert.equal(value.searchParams.get('action'),'get_vod_streams');
  assert.equal(value.searchParams.get('category_id'),'42');
  assert.equal(value.searchParams.get('password'),'temporary_test_password');
});

test('GET credentials and unknown POST types are not rewritten',async()=>{
  const url=new URL('https://localhost/player_api.php?username=normal&password=fake');
  assert.equal(await mergeXtreamPlayerRequest(input('GET','application/json','{}'),url),url);
  assert.equal(await mergeXtreamPlayerRequest(input('POST','text/plain','username=other'),url),url);
});

test('Xtream POST ignores invalid field names and nested objects',async()=>{
  const request=input('POST','application/json',JSON.stringify({
    username:'guest',password:{nested:'never'},'strange-field':'skip',action:'get_series'
  }));
  const url=await mergeXtreamPlayerRequest(request,new URL('https://localhost/player_api.php'));
  assert.equal(url.searchParams.get('username'),'guest');
  assert.equal(url.searchParams.get('password'),null);
  assert.equal(url.searchParams.get('strange-field'),null);
  assert.equal(url.searchParams.get('action'),'get_series');
});

test('malformed or oversized POST bodies fail safely',async()=>{
  await assert.rejects(
    mergeXtreamPlayerRequest(input('POST','application/json','{'),new URL('https://localhost/player_api.php')),
    {message:'xtream_post_invalid_json',status:400}
  );
  await assert.rejects(
    mergeXtreamPlayerRequest(input('POST','application/x-www-form-urlencoded','a='.padEnd(32005,'A')),new URL('https://localhost/player_api.php')),
    {message:'xtream_post_too_large',status:413}
  );
});

test('production gateway reads POST credentials before authorization, with no secret logs',async()=>{
  const s=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=s.indexOf('async function handlePlayerApi('),end=s.indexOf('async function handleM3u(',start);
  const route=s.slice(start,end);
  const merge=route.indexOf('await mergeXtreamPlayerRequest(req, url)');
  const authenticate=route.indexOf('await authenticate(username, password');
  assert.ok(merge>=0 && authenticate>merge);
  assert.match(s,/req.method === 'GET' \|\| req.method === 'POST'/);
  assert.doesNotMatch(route,/console\.(log|warn|error)\([^\n]*(username|password)/);
});
