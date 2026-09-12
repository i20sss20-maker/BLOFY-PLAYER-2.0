import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
if (!process.env.BLOFY_TEST_DATABASE_URL) throw new Error('Test database required; never run against production.');
const base='http://127.0.0.1:8097';
const env={...process.env,DATABASE_URL:process.env.BLOFY_TEST_DATABASE_URL,PGSSLMODE:'disable',PORT:'8097',
  BLOFY_ADMIN_TOKEN:'test-only-admin-secret-32-characters',BLOFY_ADMIN_USERNAME:'release-test',BLOFY_ADMIN_PASSWORD:'test-password-not-production',
  BLOFY_PLAYLIST_ENCRYPTION_KEY:'9'.repeat(64)};
let log='';const server=spawn(process.execPath,['src/bootstrap.mjs'],{env,stdio:['ignore','pipe','pipe']});
server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});
try{
  let ready=false;
  for(let n=0;n<50;n++){
    try{const r=await fetch(base+'/health');if(r.ok){ready=true;break;}}catch{}
    if(server.exitCode!==null)throw new Error('Service exited: '+log);
    await wait(300);
  }
  assert.ok(ready,'service ready: '+log);
  let response=await fetch(base+'/Admin',{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/admin');
  response=await fetch(base+'/admin');assert.equal(response.status,200);assert.match(await response.text(),/admin-login/);
  response=await fetch(base+'/api/v1/admin/experience/releases');assert.equal(response.status,401);
  response=await fetch(base+'/api/v1/admin/session/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:env.BLOFY_ADMIN_USERNAME,password:env.BLOFY_ADMIN_PASSWORD})});
  assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.ok(cookie.startsWith('blofy_admin_session='));
  const headers={'content-type':'application/json',cookie,origin:base};
  const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual'});return {status:r.status,headers:r.headers,data:await r.json()};};
  response=await fetch(base+'/admin',{headers:{cookie}});const dashboard=await response.text();assert.match(dashboard,/release-manager\.js/);assert.match(dashboard,/customer-record/);
  for(const path of ['/premium.css','/release-manager.css','/experience.js','/release-manager.js','/downloads','/portal'])assert.equal((await fetch(base+path)).status,200,path);
  for(const path of ['/api/v1/admin/users','/api/v1/admin/experience/overview','/api/v1/admin/experience/tickets','/api/v1/admin/experience/renewal-options'])assert.equal((await api(path)).status,200,path);
  const root='/api/v1/admin/experience/releases';
  let snapshot=await api(root);assert.equal(snapshot.status,200);const initial=snapshot.data.items.find(x=>x.isPrimary);assert.ok(initial);
  async function publicPage(path='/releases') {
    const r=await fetch(base+path);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/charset=utf-8/);
    assert.match(r.headers.get('cache-control'),/no-store/);const html=await r.text();
    assert.match(html,/data-server-rendered="true"/);assert.doesNotMatch(html,/<script\b|جارٍ قراءة|experience\.js|release-manager\.js/);
    return html;
  }
  for(const path of ['/releases','/releases/','/downloads','/downloads/'])assert.ok((await publicPage(path)).includes(initial.versionName));
  const body={channel:'testing',versionName:'2.0.0-ci-test',versionCode:2000099,downloadUrl:'https://example.com/test.apk',releaseNotes:'اختبار CI فقط'};
  response=await fetch(base+root,{method:'POST',headers:{...headers,origin:'https://foreign.invalid'},body:JSON.stringify(body)});assert.equal(response.status,403,'CSRF');
  let created=await api(root,'POST',body);assert.equal(created.status,200);const id=created.data.id;
  let updated=await api(root+'/'+id,'PATCH',{...body,releaseNotes:'تعديل عربي',expectedRevision:1});assert.equal(updated.status,200);
  snapshot=await api(root);
  let promoted=await api(root+'/'+id+'/primary','POST',{expectedRevision:2,expectedSelectionRevision:snapshot.data.selectionRevision});assert.equal(promoted.status,200);
  let health=await (await fetch(base+'/health')).json();assert.equal(health.release.app.versionCode,2000099);assert.equal(health.release.app.releaseNotes,'تعديل عربي');
  response=await fetch(base+'/download/latest.apk',{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),body.downloadUrl);assert.match(response.headers.get('cache-control'),/no-store/);
  const promotedHtml=await publicPage();assert.ok(promotedHtml.includes(body.downloadUrl));assert.ok(promotedHtml.includes('تعديل عربي'));
  assert.ok(promotedHtml.indexOf('data-version-code="2000099"')<promotedHtml.indexOf('data-version-code="'+initial.versionCode+'"'));
  const removedPrimary=await api(root+'/'+id,'DELETE',{expectedRevision:2});assert.equal(removedPrimary.status,409);
  snapshot=await api(root);
  const restored=await api(root+'/'+initial.id+'/primary','POST',{expectedRevision:initial.revision,expectedSelectionRevision:snapshot.data.selectionRevision});assert.equal(restored.status,200);
  const removed=await api(root+'/'+id,'DELETE',{expectedRevision:2});assert.equal(removed.status,200);
  assert.equal((await api(root)).data.items.some(x=>x.id===id),false);
  const publicData=await (await fetch(base+'/api/v1/releases')).json();assert.equal(publicData.items.filter(x=>x.isPrimary).length,1);
  const restoredHtml=await publicPage();assert.ok(!restoredHtml.includes(body.downloadUrl));assert.ok(restoredHtml.includes(initial.downloadUrl));
  health=await (await fetch(base+'/health')).json();assert.equal(health.release.app.versionCode,initial.versionCode);
  console.log('PASS: canonical Admin route, authenticated dashboard, existing admin sections, CRUD, primary-delete guard, CSRF, public metadata, no-JavaScript downloads and latest-APK redirect.');
}finally{server.kill('SIGTERM');await wait(300);if(server.exitCode===null)server.kill('SIGKILL');}
