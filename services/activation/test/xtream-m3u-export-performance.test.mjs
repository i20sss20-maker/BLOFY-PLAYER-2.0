import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseXtreamM3uCatalog} from '../src/xtream-m3u-catalog.mjs';

test('large M3U catalogs keep each channel, group and Arabic metadata', () => {
  const url='http://iptv.example.test:80';
  const lines=['#EXTM3U'];
  for(let i=0;i<12000;i++){
    const group=i%2?'Arabic Movies':'Live Channels';
    const kind=i%2?'movie':'live';
    const ext=i%2?'mp4':'ts';
    lines.push('#EXTINF:-1 tvg-id="id'+i+'" group-title="'+group+'",قناة عربية '+i);
    lines.push(url+'/'+kind+'/demo-user/demo-pass/'+(i+1)+'.'+ext);
  }
  const catalog=parseXtreamM3uCatalog(lines.join('\r\n'),{
    baseUrl:url,username:'demo-user',password:'demo-pass'
  });
  assert.equal(catalog.records.live.length,6000);
  assert.equal(catalog.records.movie.length,6000);
  assert.equal(catalog.records.series.length,0);
  assert.equal(catalog.categories.live.length,1);
  assert.equal(catalog.categories.movie.length,1);
  assert.equal(catalog.records.live[0].name,'قناة عربية 0');
  assert.equal(catalog.records.movie.at(-1).metadata.epgChannelId,'id11999');
  assert.equal(catalog.records.movie[0].categoryId,catalog.categories.movie[0].sourceCategoryId);
  assert.equal(catalog.records.live[0].categoryId,catalog.categories.live[0].sourceCategoryId);
});

test('M3U parsing preserves strict origin/account checks, final line and item cap',()=>{
  const playlist=[
    '#EXTM3U',
    '#EXTINF:-1 group-title="Allowed",Valid',
    'http://iptv.example.test:80/live/demo-user/demo-pass/11.ts',
    '#EXTINF:-1 group-title="Allowed",Wrong account',
    'http://iptv.example.test:80/live/other/demo-pass/12.ts',
    '#EXTINF:-1 group-title="Allowed",Wrong origin',
    'http://evil.example.test:80/live/demo-user/demo-pass/13.ts',
    '#EXTINF:-1 group-title="Allowed",Valid last',
    'http://iptv.example.test:80/live/demo-user/demo-pass/14.ts'
  ].join('\n');
  const opts={baseUrl:'http://iptv.example.test:80',username:'demo-user',password:'demo-pass'};
  const data=parseXtreamM3uCatalog(playlist,opts);
  assert.deepEqual(data.records.live.map(item=>item.sourceId),['11','14']);
  assert.equal(data.categories.live.length,1);
  const capped=parseXtreamM3uCatalog(playlist,{...opts,maxItems:1});
  assert.equal(capped.records.live.length,1);
  assert.throws(()=>parseXtreamM3uCatalog('not a playlist',opts),/xtream_m3u_invalid_header/);
});

test('stream export skips unused Xtream formatting and writes one complete M3U record',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=gateway.indexOf('async function handleM3u(');
  const end=gateway.indexOf('async function gatewayHealth(',start);
  const body=gateway.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.doesNotMatch(body,/formatGatewayItem\(mediaType, row\)/);
  assert.match(body,/await writeStreamChunk\(res,`#EXTINF:-1[\s\S]*\+\s*`\$\{base\}\/\$\{kind\}/);
  assert.match(body,/await walkGatewayItems\(mediaType, null/);
  const parser=await readFile(new URL('../src/xtream-m3u-catalog.mjs',import.meta.url),'utf8');
  assert.match(parser,/const newline=playlist\.indexOf\('\\n',pos\)/);
  assert.doesNotMatch(parser,/playlist\.split\(/);
  assert.match(parser,/categoryIds\.get\(groupKey\)/);
});
