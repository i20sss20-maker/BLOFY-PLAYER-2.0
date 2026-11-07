import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { CONTROL_PATH, controlPage, deleteConfirmationPage, readControlForm } from '../src/xtream-native-controls.mjs';

const id='1195bcd7-44ba-4710-af22-cb4237dc4aa1';
const source={id,name:'Example <script>alert(1)</script>',baseUrl:'http://media.example',
  counts:{live:120,movie:25,series:5,total:150},enabled:true,publishCatalog:true,status:'online',priority:100};
const web=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
const backend=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8');

test('native controls render independently of JavaScript and never echo passwords',()=>{
  const page=controlPage({items:[source]});
  assert.match(page,/<!doctype html>/);
  assert.doesNotMatch(page,/<script(?:\s|>)/i);
  assert.match(page,/method="post"/);
  for(const action of ['toggle-enabled','toggle-publish','test','test-m3u','sync-all','sync-live','sync-movie','sync-series','cancel-sync','save']){
    assert.ok(page.includes(CONTROL_PATH+'/'+id+'/'+action),action);
  }
  assert.ok(page.includes(CONTROL_PATH+'/'+id+'/confirm-delete'));
  assert.match(page,/Example &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page,/150/);
  assert.match(page,/name="password"/);
  assert.match(page,/type="password"/);
});

test('source has a separate, explicit confirmation page before deletion',()=>{
  const page=deleteConfirmationPage(source);
  assert.ok(page.includes(CONTROL_PATH+'/'+id+'/delete'));
  assert.match(page,/name="confirmId"/);
  assert.match(page,/name="ack"/);
  assert.match(page,/required/);
  assert.match(page,/إلغاء والعودة/);
});

test('native form parser handles browser URLencoded payload with strict size and duplicate checks',async()=>{
  const body=new URLSearchParams({name:'TV user',username:'ok',password:'secret',priority:'1'}).toString();
  const request=Readable.from([Buffer.from(body)]);
  request.headers={'content-type':'application/x-www-form-urlencoded'};
  const result=await readControlForm(request);
  assert.equal(result.name,'TV user');
  assert.equal(result.password,'secret');
  assert.equal(result.priority,'1');
  const duplicate=Readable.from([Buffer.from('name=A&name=B')]);
  duplicate.headers={'content-type':'application/x-www-form-urlencoded'};
  await assert.rejects(readControlForm(duplicate),/control_duplicate_field/);
  const oversized=Readable.from([Buffer.alloc(12001)]);
  oversized.headers={'content-type':'application/x-www-form-urlencoded'};
  await assert.rejects(readControlForm(oversized),/control_form_too_large/);
});

test('BLOFY supports native POST action routes behind the existing admin bearer/session checks',()=>{
  const auth=backend.indexOf('if (!requireAdmin(req, res)) return;');
  const route=backend.indexOf("if(req.method==='GET' && url.pathname===CONTROL_PATH)");
  assert.ok(auth>=0 && route>auth);
  assert.match(backend,/async function handleControlAction\(req,res,id,action\)/);
  assert.match(backend,/if\(action==='delete'\)\{/);
  assert.match(backend,/fields\.confirmId!==id\|\|fields\.ack!=='yes'/);
  assert.match(backend,/await requestDeleteSource\(id\)/);
  assert.match(backend,/await patchServer\(id,\{enabled:next\}\)/);
  assert.match(backend,/await patchServer\(id,\{publishCatalog:next\}\)/);
  assert.match(backend,/303,\{'location':target/);
});

test('original Xtream cards have native actions with clickable fallback rather than JS-only buttons',()=>{
  assert.match(web,/function nativeSourceForm\(id, action, label/);
  assert.match(web,/form\.method='post'/);
  assert.match(web,/button\.type='submit'/);
  assert.match(web,/if\(button\.closest\('\.source-native-form'\)/);
  assert.match(web,/source-native-edit/);
  assert.match(web,/confirm-delete/);
  assert.match(html,/href="\/api\/v1\/admin\/xtream\/controls"/);
  assert.match(html,/sources-admin\.js\?v=20261107-m3u-reason-v4/);
});
