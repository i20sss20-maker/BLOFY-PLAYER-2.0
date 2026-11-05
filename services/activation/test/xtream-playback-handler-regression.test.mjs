import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');

test('playback lookup joins category alias before using its visibility flag',()=>{
  const lookup=source.slice(source.indexOf('async function gatewayItemById('),source.indexOf('function decryptServerCredentials('));
  assert.match(lookup,/LEFT JOIN blofy_xtream_categories c ON c\.server_id=i\.server_id/);
  assert.match(lookup,/LEFT JOIN blofy_xtream_gateway_category_map cm ON/);
  assert.match(lookup,/\(c\.enabled IS NULL OR c\.enabled=TRUE\)/);
  assert.ok(lookup.indexOf('LEFT JOIN blofy_xtream_categories c') < lookup.indexOf('WHERE m.gateway_id=$1'));
});

test('Xtream API and media request errors are awaited by the HTTP boundary',()=>{
  const handler=source.slice(source.indexOf('const previousCreateServer ='),source.length);
  assert.match(handler,/return await handlePlayerApi\(req, res, url\)/);
  assert.match(handler,/return await handleM3u\(req, res, url\)/);
  assert.match(handler,/return await proxyMedia\(req, res, mediaMatch/);
  assert.match(handler,/catch \(error\) \{\s*console\.error\('xtream gateway request failed:'/);
  assert.doesNotMatch(handler,/return proxyMedia\(req, res/);
});
