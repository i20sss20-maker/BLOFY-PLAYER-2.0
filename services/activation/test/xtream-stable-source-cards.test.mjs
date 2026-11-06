import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui,html]=await Promise.all([
  readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8'),
  readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8')
]);
const card=ui.slice(ui.indexOf('function serverCard('),ui.indexOf('function renderXtream('));
const renderer=ui.slice(ui.indexOf('function renderXtream('),ui.indexOf('function scheduleXtreamPoll('));
const handler=ui.slice(ui.indexOf('async function handleServerAction('),ui.indexOf('async function syncAllXtream('));
const poll=ui.slice(ui.indexOf('function scheduleXtreamPoll('),ui.indexOf('async function loadXtream('));

test('source cards are keyed and never replaced by background sync polling',()=>{
  assert.match(renderer,/existing=new Map/);
  assert.match(renderer,/existing\.get\(item\.id\)/);
  assert.match(renderer,/refreshSourceCard\(old,item\)/);
  assert.match(renderer,/desired\.push\(old\)/);
  assert.match(renderer,/list\.insertBefore\(desired\[i\],list\.children\[i\]\|\|null\)/);
  assert.doesNotMatch(renderer,/serverCard\(item\).*old\./);
  const updater=ui.slice(ui.indexOf('function refreshSourceCard('),ui.indexOf('function renderXtream('));
  assert.match(updater,/card\._latestSource=item/);
  assert.match(updater,/card\.querySelector\('\.server-status'\)/);
  assert.match(updater,/button\[data-action="toggle-enabled"\]/);
  assert.doesNotMatch(updater,/replaceChildren/);
});

test('Xtream buttons are captured at a stable document-level handler',()=>{
  assert.match(card,/card\._latestSource = item/);
  assert.match(card,/card\.dataset\.renderSignature = JSON\.stringify\(item\)/);
  assert.doesNotMatch(card,/card\.addEventListener\('click'/);
  assert.match(ui,/document\.addEventListener\('click',event=>/);
  assert.match(ui,/el\('xtreamServers'\)\.contains\(button\)/);
  assert.match(ui,/event\.preventDefault\(\)/);
  assert.match(ui,/event\.stopPropagation\(\)/);
  assert.match(ui,/handleServerAction\(item,card,button\)/);
  assert.match(handler,/card\.dataset\.busy = '1'/);
  assert.match(handler,/button\.textContent = 'جارٍ الحفظ…'/);
  assert.match(handler,/card\.dataset\.busy = '0'/);
  assert.match(handler,/writeFeedback\('لم يُحفظ التغيير:/);
});

test('polling only runs during real syncs, not stale persisted syncing state',()=>{
  assert.match(poll,/item\.syncing === true/);
  assert.doesNotMatch(poll,/item\.status === 'syncing'/);
});

test('source control sees confirmed changes and never claims a delete before DB confirmation',()=>{
  assert.match(handler,/Boolean\(result\.item\[field\]\)!==next/);
  assert.match(handler,/await loadXtream\(true,true\)/);
  assert.match(handler,/result\.deletionQueued!==true/);
  assert.match(handler,/state\.xtreamServers\.some\(source=>source\.id===item\.id\)/);
  assert.match(ui,/cache: 'no-store'/);
  assert.match(html,/sources-admin\.js\?v=20261106-source-range-retry-v12/);
});
