import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('missing-media summary uses existing native admin session, not public route',async()=>{
 const s=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const auth=s.indexOf('if (!requireAdmin(req, res)) return;');
 const summary=s.indexOf("url.pathname==='/api/v1/admin/xtream/unavailable-media'");
 const proxy=s.indexOf("url.pathname==='/api/v1/admin/xtream/unavailable-media/recheck-now'");
 const serverList=s.indexOf("url.pathname === '/api/v1/admin/xtream/servers'");
 assert.ok(auth>0&&summary>auth&&proxy>summary&&serverList>proxy);
 assert.match(s.slice(summary,proxy),/await unavailableMediaSummary\(pool\)/);
});
test('source-only operator recheck proxy cannot take arbitrary URL or leak bearer to browser',async()=>{
 const s=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=s.indexOf("url.pathname==='/api/v1/admin/xtream/unavailable-media/recheck-now'");
 const b=s.indexOf("url.pathname === '/api/v1/admin/xtream/servers'",a);
 const part=s.slice(a,b);
 assert.ok(a>0&&b>a);
 assert.match(part,/if\(!validUuid\(sourceId\)\|\|!recoverySources\(\)\.has\(sourceId\)\)/);
 assert.match(part,/fetch\('http:\/\/127\.0\.0\.1:'\+port\+/);
 assert.match(part,/\/api\/v1\/admin\/xtream-gateway\/unavailable-media\/recheck-now/);
 assert.match(part,/authorization:'Bearer '\+ADMIN_TOKEN/);
 assert.match(part,/JSON\.stringify\(\{sourceId\}\)/);
 assert.match(part,/AbortSignal\.timeout\(55000\)/);
 assert.match(part,/raw\.length>4096/);
 assert.match(part,/sourceId,/);
 assert.match(part,/catalogMutation:false,subscriberCutover:false/);
 assert.doesNotMatch(part,/body\.url|req\.headers\.host|req\.headers\['x-forwarded-host'\]|sourceUrl|providerPassword/);
});
test('source cards render only count-based recovery pills, never source media IDs',async()=>{
 const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 const a=ui.indexOf('function updateUnavailableSourceRows(');
 const b=ui.indexOf('function updateSourceMediaIndicators(',a);
 assert.ok(a>0&&b>a);
 const area=ui.slice(a,b);
 assert.match(area,/unavailableBySource/);
 assert.match(area,/missingMovies/);
 assert.match(area,/missingEpisodes/);
 assert.match(area,/recovered/);
 assert.match(area,/updateRecoveryIndicator\(/);
 assert.match(area,/first-byte|أول بايتات/);
 assert.doesNotMatch(area,/row\.itemId|row\.seriesId|row\.providerUrl|row\.password/);
 assert.match(ui,/updateRecoveryIndicator\(indicators,item\)/);
 assert.match(ui,/updateRecoveryIndicator\(card\.querySelector\('\.source-quick-status'\),item\)/);
 assert.match(ui,/refreshRecoveryButton\(card,item\)/);
});
test('manual source button uses same admin session and reports verified media first bytes only',async()=>{
 const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 assert.match(ui,/\['إعادة فحص المتعطل الآن', 'retry-unavailable', 'button ghost'\]/);
 assert.match(ui,/action === 'retry-unavailable'/);
 assert.match(ui,/\/api\/v1\/admin\/xtream\/unavailable-media\/recheck-now/);
 assert.match(ui,/method:'POST',body:JSON\.stringify\(\{sourceId:item\.id\}\)/);
 assert.match(ui,/لا يثبت ذلك تشغيل الصوت والصورة كاملًا/);
 assert.match(ui,/const \[data,unavailable\]=await Promise\.all/);
 assert.match(ui,/api\('\/api\/v1\/admin\/xtream\/unavailable-media'\)\.catch\(\(\)=>null\)/);
});
