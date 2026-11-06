import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateM3uPlaylistUrl,isM3uPlaylistPrefix} from '../src/xtream-m3u-link.mjs';

const host='https://provider.example:8443';

test('M3U link supports an authorized signed playlist URL and never accepts unsafe schemes',()=>{
  const url='https://provider.example:8443/get.php?username=fixture&password=sensitive&type=m3u_plus';
  assert.equal(validateM3uPlaylistUrl(url,host),url);
  assert.equal(validateM3uPlaylistUrl('http://provider.example:8080/get.php','http://provider.example:8080'),
    'http://provider.example:8080/get.php');
  assert.throws(()=>validateM3uPlaylistUrl('http://provider.example:8443/get.php',host),
    /xtream_m3u_https_required/);
  assert.equal(validateM3uPlaylistUrl('https://partner.example/authorized.m3u',host),
    'https://partner.example/authorized.m3u');
  for(const unsafe of [
    '','not-a-url','file:///etc/passwd','ftp://example.com/file',
    'javascript:alert(1)','https://user:pass@provider.example/get.php',
    'https://provider.example/file.m3u#token',
    'https://localhost/playlist','https://example.local/play',
    'http://unrelated.example/play',
    'https://provider.example/get.php\\evil',
    'https://provider.example/get.php\nsecret',
    'https://provider.example/'+('a'.repeat(5000))
  ])assert.throws(()=>validateM3uPlaylistUrl(unsafe,host),/xtream_m3u_/,unsafe.slice(0,80));
});

test('M3U validator detects actual playlist headers and rejects HTML, JSON and blank media',()=>{
  assert.equal(isM3uPlaylistPrefix(Buffer.from('#EXTM3U\n#EXTINF:-1,Channel\n')),true);
  assert.equal(isM3uPlaylistPrefix(Buffer.from('\uFEFF#EXTM3U\r\n')),true);
  for(const value of ['<html>Forbidden</html>','{"error":404}',' ','#EXTM3UFAIL\n'])
    assert.equal(isM3uPlaylistPrefix(Buffer.from(value)),false,value);
});

test('M3U is a separate encrypted per-source configuration and never returned as plaintext',async()=>{
  const [hook,html,js,native]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../src/xtream-native-controls.mjs',import.meta.url),'utf8')
  ]);
  assert.match(hook,/ALTER TABLE blofy_xtream_servers ADD COLUMN IF NOT EXISTS m3u_url_secret TEXT/);
  assert.match(hook,/m3uConfigured: Boolean\(row.m3u_url_secret\)/);
  assert.match(hook,/encryptXtreamSecret\(await safeM3uInput\(body.m3uUrl,baseUrl\),KEY_HEX,`m3u:\$\{id\}`\)/);
  assert.match(hook,/set\('m3u_url_secret',encryptXtreamSecret\(link,KEY_HEX,`m3u:\$\{id\}`\)\)/);
  assert.match(hook,/decryptXtreamSecret\(source.m3u_url_secret,KEY_HEX,`m3u:\$\{id\}`\)/);
  assert.match(hook,/action === 'test-m3u'/);
  assert.match(html,/id="xtM3uUrl"/);
  assert.match(js,/m3uUrl:el\('xtM3uUrl'\).value.trim\(\)/);
  assert.match(js,/\['m3uUrl','رابط M3U/);
  assert.match(js,/action==='test-m3u'/);
  assert.match(js,/item.m3uConfigured/);
  assert.match(native,/name="m3uUrl"/);
  assert.match(native,/name="m3uRemove"/);
  assert.match(html,/sources-admin\.js\?v=20261107-hybrid-m3u-v1/);
});

test('real authenticated M3U probe checks source headers without returning URL or secrets',async()=>{
  const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const begin=src.indexOf('async function safeM3uInput(');
  const end=src.indexOf('async function createServer(',begin);
  assert.ok(begin>=0&&end>begin);
  let netChecks=0;
  const mocked={
    serverById:async()=>({
      id:'11111111-1111-4111-8111-111111111111',
      base_url:host,m3u_url_secret:'[encrypted]'
    }),
    decryptXtreamSecret:()=> 'https://provider.example:8443/get.php?password=sensitive',
    KEY_HEX:'99'.repeat(32),
    validateM3uPlaylistUrl,
    assertPublicXtreamUrl:async()=>{netChecks++},
    fetch:async()=>new Response('#EXTM3U\n#EXTINF:-1,Fixture\nhttps://provider.example/live/1.ts\n',{
      status:206,headers:{'content-type':'audio/x-mpegurl'}
    }),
    isM3uPlaylistPrefix,
    AbortSignal,
    Buffer,
    URL
  };
  const fn=new Function(...Object.keys(mocked),
    src.slice(begin,end)+'\nreturn checkSourceM3u;')(...Object.values(mocked));
  const result=await fn('11111111-1111-4111-8111-111111111111');
  assert.equal(result.ok,true);
  assert.equal(result.format,'m3u');
  assert.ok(netChecks>=2);
  assert.equal(JSON.stringify(result).includes('sensitive'),false);
  assert.equal(JSON.stringify(result).includes('provider.example'),false);
});
