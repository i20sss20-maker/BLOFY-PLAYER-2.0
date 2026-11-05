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

test('source cards are keyed and survive background refresh while active',()=>{
  assert.match(renderer,/existing=new Map/);
  assert.match(renderer,/existing\.get\(item\.id\)/);
  assert.match(renderer,/old\.dataset\.busy==='1'/);
  assert.match(renderer,/old\.querySelector\('details\[open\]'\)/);
  assert.match(renderer,/old\.contains\(document\.activeElement\)/);
  assert.match(renderer,/old\._latestSource=item/);
  assert.match(renderer,/list\.insertBefore\(desired\[i\],list\.children\[i\]\|\|null\)/);
  assert.doesNotMatch(renderer,/list\.replaceChildren\(\);\s*const query/);
});

test('buttons act on the current source and mutation locks its card',()=>{
  assert.match(card,/card\._latestSource = item/);
  assert.match(card,/card\.dataset\.renderSignature = JSON\.stringify\(item\)/);
  assert.match(card,/card\.dataset\.busy === '1'/);
  assert.match(card,/handleServerAction\(card\._latestSource, card, button\)/);
  assert.match(handler,/card\.dataset\.busy = '1'/);
  assert.match(handler,/button\.textContent = 'جارٍ الحفظ…'/);
  assert.match(handler,/card\.dataset\.busy = '0'/);
  assert.match(handler,/if\(document\.activeElement===button\)button\.blur\(\)/);
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
  assert.match(html,/sources-admin\.js\?v=20261105-stable-sources-v4/);
});
