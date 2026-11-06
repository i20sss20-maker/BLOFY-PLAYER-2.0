import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  normalizeStudioName,normalizeStudioArtworkUrl,
  normalizeStudioItemEdit,validateStudioLogo,readStudioLogoRequest
} from '../src/xtream-studio-policy.mjs';
import {gatewayItemsPageQuery} from '../src/xtream-gateway-query.mjs';
import {formatGatewayItem} from '../src/xtream-gateway-core.mjs';

test('studio names and custom icons are validated',()=>{
  assert.equal(normalizeStudioName('  BLOFY PREMIUM  '),'BLOFY PREMIUM');
  assert.throws(()=>normalizeStudioName('  '),/studio_name_invalid/);
  assert.throws(()=>normalizeStudioName('a'.repeat(73)),/studio_name_invalid/);
  assert.equal(normalizeStudioArtworkUrl('https://cdn.example.com/logo.png'),
    'https://cdn.example.com/logo.png');
  for(const url of ['javascript:alert(1)','data:image/svg+xml,foo','http://example.com/a.png',
    'https://user:pass@example.com/img.png','ftp://example.com/icon']){
    assert.throws(()=>normalizeStudioArtworkUrl(url),/studio_icon_invalid/);
  }
  assert.equal(normalizeStudioArtworkUrl(''),null);
});

test('studio channel edits are bounded and only live channels accept priority',()=>{
  assert.deepEqual(normalizeStudioItemEdit({displayName:'قناة مفضلة',iconUrl:null,
    featured:true,channelNumber:15},'live'),{
    customName:'قناة مفضلة',customIconUrl:null,featured:true,channelNumber:15
  });
  assert.deepEqual(normalizeStudioItemEdit({displayName:'',channelNumber:null},'live'),
    {customName:null,channelNumber:null});
  assert.throws(()=>normalizeStudioItemEdit({channelNumber:0},'live'),/studio_channel_number_invalid/);
  assert.throws(()=>normalizeStudioItemEdit({featured:'true'},'live'),/studio_featured_invalid/);
  assert.throws(()=>normalizeStudioItemEdit({featured:true},'series'),/studio_channel_only/);
  assert.throws(()=>normalizeStudioItemEdit({password:'secret'},'live'),/studio_item_invalid/);
  assert.throws(()=>normalizeStudioItemEdit({},'live'),/studio_item_invalid/);
});

test('logo upload accepts only bounded PNG/JPEG/WebP with matching magic bytes',async()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0]);
  const jpeg=Buffer.from([255,216,255,224,0,1]);
  const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),Buffer.alloc(4)]);
  assert.equal(validateStudioLogo(png,'image/png'),'image/png');
  assert.equal(validateStudioLogo(jpeg,'image/jpeg'),'image/jpeg');
  assert.equal(validateStudioLogo(webp,'image/webp'),'image/webp');
  assert.throws(()=>validateStudioLogo(Buffer.from('<svg><script>'), 'image/svg+xml'),
    /studio_logo_type_invalid/);
  assert.throws(()=>validateStudioLogo(jpeg,'image/png'),/studio_logo_type_invalid/);
  assert.throws(()=>validateStudioLogo(Buffer.alloc(1024*1024+1),'image/png'),
    /studio_logo_size_invalid/);
  const req={headers:{'content-type':'image/png'},async *[Symbol.asyncIterator](){yield png;}};
  const result=await readStudioLogoRequest(req);
  assert.equal(result.mime,'image/png');
  assert.deepEqual(result.image,png);
});

test('gateway output uses the custom name/logo with stable source ID',()=>{
  const query=gatewayItemsPageQuery('live',0,{sourceId:'11111111-1111-4111-8111-111111111111'});
  assert.match(query.text,/custom_name/);
  assert.match(query.text,/custom_icon_url/);
  assert.match(query.text,/channel_number/);
  assert.match(query.text,/m.gateway_id ASC/);
  assert.equal(query.values[2],'11111111-1111-4111-8111-111111111111');
  const item=formatGatewayItem('live',{
    gateway_id:345,name:'BLOFY Channel',icon_url:'https://cdn.example.com/a.png',
    category_gateway_id:22,channel_number:7,featured:true,metadata:{}
  });
  assert.equal(item.stream_id,345);
  assert.equal(item.num,7);
  assert.equal(item.is_favorite,1);
  assert.equal(item.name,'BLOFY Channel');
  assert.equal(item.stream_icon,'https://cdn.example.com/a.png');
});

test('admin editing does not mutate original upstream name/icon or credentials',async()=>{
  const file=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  assert.match(file,/ADD COLUMN IF NOT EXISTS custom_name/);
  assert.match(file,/ADD COLUMN IF NOT EXISTS custom_icon_url/);
  assert.match(file,/UPDATE blofy_xtream_items SET \$\{assignments\.join/);
  assert.match(file,/UPDATE blofy_xtream_studio_branding SET logo_mime/);
  assert.match(file,/readStudioLogoRequest\(req\)/);
  assert.match(file,/if \(req\.method === 'GET' && url\.pathname === '\/xtream\/studio-logo'\)/);
  assert.match(file,/studioItemMatch/);
  assert.doesNotMatch(file,/UPDATE blofy_xtream_servers SET username_secret=\$1/);
});
