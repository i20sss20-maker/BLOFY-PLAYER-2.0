import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const [gateway,admin,ui,html,css]=await Promise.all([
  read('src/xtream-gateway-hook.mjs'),read('src/xtream-admin-hook.mjs'),
  read('web/sources-admin.js'),read('web/sources-admin.html'),read('web/sources-admin.css')
]);

test('production Xtream gateway waits for real media before responding to clients',()=>{
  const media=gateway.slice(gateway.indexOf('async function proxyMedia('),gateway.indexOf('function playerServerInfo('));
  assert.match(media,/setTimeout\(\(\) => controller.abort\(new Error\('headers_timeout'\)\), 12000\)/);
  assert.match(media,/await readChunk\(15000\)/);
  assert.match(media,/await readChunk\(45000\)/);
  assert.match(media,/const first = await readChunk/);
  assert.ok(media.indexOf('const first = await readChunk')<media.indexOf('res.writeHead(response.status, outputHeaders);\n        const stream'));
  assert.match(media,/\[408,500,502,503,504\]/);
  assert.match(media,/req.once\('aborted', abort\)/);
  assert.match(media,/res.once\('close', onClose\)/);
  assert.match(media,/await pipeline\(stream, res\)/);
  assert.doesNotMatch(media,/console\.(warn|error)\([^\n]*upstream\.toString/);
  assert.match(gateway,/await response\.body\?\.cancel\(\)\.catch\(\(\)=>\{\}\)/);
});

test('admin video probe reads data and rejects empty successful HTTP responses',()=>{
  const probe=admin.slice(admin.indexOf('async function probeXtreamPlayback('),admin.indexOf('async function fetchAccount('));
  assert.match(probe,/const first=await reader\.read\(\)/);
  assert.match(probe,/errorCode='empty_media'/);
  assert.match(probe,/!errorCode &&/);
  assert.match(probe,/9500/);
  assert.doesNotMatch(probe,/password:creds\.password/);
});

test('real blofyplayer.com admin supports simple one-click category organization',()=>{
  const move=admin.slice(admin.indexOf('async function moveCategory('),admin.indexOf('async function patchItem('));
  assert.match(move,/\['up','down','top'\]/);
  assert.match(move,/direction==='top'\?0/);
  assert.match(move,/WITH ORDINALITY AS rank\(category_id,pos\)/);
  assert.match(move,/await client\.query\('COMMIT'\)/);
  assert.match(html,/id="categoryVisibility"/);
  assert.match(html,/value="live">القنوات/);
  assert.match(ui,/\['للأول','top'/);
  assert.match(ui,/categoryVisibility'\)\.addEventListener/);
  assert.match(ui,/await loadCategories\(\)/);
  assert.match(css,/\.category-toolbar/);
});
