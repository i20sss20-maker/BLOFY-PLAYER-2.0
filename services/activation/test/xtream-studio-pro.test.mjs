import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateStudioBulk,validateStudioSchedule} from '../src/xtream-studio-pro.mjs';
const serverId='11111111-1111-4111-8111-111111111111';

test('batch curation is scoped to existing live source IDs and at most 50 channels',()=>{
  assert.deepEqual(validateStudioBulk({serverId,mediaType:'live',ids:['1','2'],action:'renumber',startNumber:101}),{
    serverId,ids:['1','2'],action:'renumber',startNumber:101
  });
  for(const input of [
    {serverId,mediaType:'movie',ids:['1'],action:'hide'},
    {serverId,mediaType:'live',ids:['1','1'],action:'hide'},
    {serverId,mediaType:'live',ids:[],action:'feature'},
    {serverId,mediaType:'live',ids:Array.from({length:51},(_,i)=>String(i)),action:'feature'},
    {serverId,mediaType:'live',ids:['../../1'],action:'hide'},
    {serverId,mediaType:'live',ids:['1'],action:'delete'},
    {serverId,mediaType:'live',ids:['1','2'],action:'renumber',startNumber:99999},
  ])assert.throws(()=>validateStudioBulk(input));
});
test('opt-in schedule has bounded interval, known media types and no auto-enable',()=>{
  assert.deepEqual(validateStudioSchedule({enabled:false,intervalHours:24,types:['live','movie']}),{
    enabled:false,intervalHours:24,types:['live','movie']
  });
  for(const input of [{enabled:'true',intervalHours:24,types:['live']},
    {enabled:true,intervalHours:0,types:['live']},
    {enabled:true,intervalHours:24,types:['vod']},
    {enabled:true,intervalHours:24,types:['live','live']},
    {enabled:true,intervalHours:24,types:[]},
  ])assert.throws(()=>validateStudioSchedule(input));
});
test('studio curation preserves native provider fields, subscriber accounts and upstream keys',async()=>{
  const src=await readFile(new URL('../src/xtream-studio-pro.mjs',import.meta.url),'utf8');
  assert.match(src,/CHECK|snapshot/i);
  assert.match(src,/FOR UPDATE/);
  assert.match(src,/jsonb_to_recordset/);
  assert.match(src,/ROLLBACK/);
  assert.match(src,/created_at/);
  assert.match(src,/next_run_at/);
  assert.match(src,/SKIP LOCKED/);
  assert.doesNotMatch(src,/DELETE FROM blofy_xtream_items/i);
  assert.doesNotMatch(src,/DELETE FROM blofy_xtream_servers/i);
  assert.doesNotMatch(src,/UPDATE blofy_xtream_gateway_accounts/i);
  assert.doesNotMatch(src,/username_secret|password_secret/i);
  assert.doesNotMatch(src,/https:\/\/api\.openai|eval\(/i);
});
test('Studio Pro has real admin-only API routes and a classic script served locally',async()=>{
  const routes=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const host=await readFile(new URL('../src/sources-admin-hook.mjs',import.meta.url),'utf8');
  const html=await readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8');
  const ui=await readFile(new URL('../web/blofy-studio-pro.js',import.meta.url),'utf8');
  assert.match(routes,/createStudioPro/);
  assert.match(routes,/if \(!requireAdmin\(req, res\)\) return/);
  for(const path of ['overview','bulk','snapshots','collections','schedule','epg'])
    assert.ok(routes.includes("suffix==='"+path+"'")||routes.includes("suffix.match(/^"+path),path);
  assert.match(host,/\/blofy-studio-pro\.js/);
  assert.match(html,/blofy-studio-pro\.js/);
  assert.match(ui,/window\.confirm/);
  for(const id of ['studioProSource','studioProApplyBulk','studioProCreateCollection',
    'studioProCreateSnapshot','studioProScheduleHours','studioProLoadHealth',
    'studioProEpg','studioProSnapshots','studioProHealth'])
    assert.ok(html.includes('id="'+id+'"'),id);
});
