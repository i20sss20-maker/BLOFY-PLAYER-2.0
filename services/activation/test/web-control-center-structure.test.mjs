import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const web = name => readFile(new URL('../web/' + name, import.meta.url), 'utf8');

test('admin console keeps devices, support, releases and renewal controls in one dashboard', async () => {
  const html = await web('admin.html');
  for (const id of ['devices-view','support-view','releases-view','customer-record','renewal-options','preview-renewal','admin-releases','release-form']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing ${id}`);
  }
  assert.match(html, /release-manager\.js/);
  assert.match(html, /data-panel=["']releases["']/);
  assert.match(html, /إعادة تفعيله/);
});

test('sources console keeps BLOFY gateway, upstream Xtream and catalog controls clearly separated', async () => {
  const html = await web('sources-admin.html');
  for (const id of ['gatewayCreateBtn','gatewayServerUrl','xtreamForm','xtreamServers','catalogServer','catalogType','catalogItems']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing ${id}`);
  }
  assert.match(html, /سيرفرك الخاص/);
  assert.match(html, /إنشاء بيانات دخول/);
  assert.match(html, /الكتالوج المستورد/);
});

test('download center retains release and device-specific installation controls', async () => {
  const html = await web('downloads.html');
  assert.match(html, /id=["']releases["']/);
  for (const device of ['phone','tv','computer']) assert.match(html, new RegExp(`data-install=["']${device}["']`));
  assert.match(html, /id=["']install-help["']/);
});


test('renewal confirmation includes the customer phone from the opened record', async () => {
  const js = await web('experience.js');
  assert.match(js, /\['الجوال',recordState\?\.customer\?\.phone\|\|'غير مسجل'\]/);
  assert.match(js, /\['العميل',recordState\?\.customer\?\.name\|\|'غير مسجل'\]/);
});

test('admin customer list shows stored phone numbers and can filter contacts missing numbers', async () => {
  const html = await web('admin.html');
  const js = await web('experience.js');
  assert.match(html, /<th>رقم الجوال<\/th>/);
  assert.match(js, /item\.phone\|\|'غير مسجّل'/);
  assert.match(js, /withoutPhone/);
  assert.match(js, /count\.with_phone/);
  assert.match(js, /count\.without_phone/);
});

test('admin contact directory provides registered-phone shortcut and editable search field',async()=>{
 const html=await web('admin.html');
 const js=await web('experience.js');
 for(const id of ['show-phone-customers','show-all-customers','customer-lookup'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/دليل العملاء المسجلين بأرقام جوال/);
 assert.match(js,/filter.value=onlyContacts\?'withPhone':'all'/);
 assert.match(js,/navigator.clipboard.writeText\(item.phone\)/);
});
