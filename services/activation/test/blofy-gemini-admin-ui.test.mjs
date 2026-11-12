import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const folder=new URL('../',import.meta.url);
test('Gemini UI is visible inside the real BLOFY Stream catalog screen',async()=>{
 const html=await readFile(new URL('web/sources-admin.html',folder),'utf8');
 assert.match(html,/id="blofyGeminiBox"/);
 assert.match(html,/id="blofyGeminiTest"/);
 assert.match(html,/id="blofyGeminiSuggest"/);
 assert.match(html,/blofy-gemini-ui\.js/);
 assert.match(html,/blofy-gemini-ui\.css/);
});
test('Gemini UI invokes session protected admin routes and renders as text',async()=>{
 const js=await readFile(new URL('web/blofy-gemini-ui.js',folder),'utf8');
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/\/api\/v1\/admin\/xtream\/library-ai\/suggest/);
 assert.match(js,/\/api\/v1\/admin\/xtream\/library-ai\/connection-test/);
 assert.ok(!js.includes('innerHTML'));
 assert.ok(!js.includes('localStorage'));
 assert.ok(!js.includes('apiKey'));
});
test('Gemini browser routes require existing token and are separated from internal bridge',async()=>{
 const source=await readFile(new URL('src/xtream-admin-hook.mjs',folder),'utf8');
 const begin=source.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream')) return listener(req, res);");
 const auth=source.indexOf('if (!requireAdmin(req, res)) return;',begin);
 const exposed=source.indexOf("url.pathname==='/api/v1/admin/xtream/library-ai/status'",begin);
 assert.ok(begin>0&&auth>begin&&exposed>auth);
 assert.match(source,/library-ai\/connection-test/);
});
