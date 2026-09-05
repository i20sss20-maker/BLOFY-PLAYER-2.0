import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

const injectedScript = () => injectSubscriberPortalUi('<html><body></body></html>')
  .match(/<script data-blofy-subscriber-ui="1">([\s\S]*?)<\/script>/)[1];

// Browser contract: the portal's original typeUi hides all non-Xtream credentials;
// login clears the device inputs but retains auth in the page's lexical scope.
function browser({ mode = 'xtream', authenticated = true, responseOk = true } = {}) {
  const nodes = {};
  const requests = [];
  const saves = [];
  const observers = [];
  function element(id = '') {
    const classes = new Set();
    const listeners = [];
    const node = {
      id, value: '', textContent: '', dataset: {}, style: {}, children: [], disabled: false,
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, force) { const show = force ?? !classes.has(value); show ? classes.add(value) : classes.delete(value); return show; }
      },
      setCustomValidity(value) { this.validityMessage = value; },
      closest(selector) { return selector === '.field' ? this.wrapper : selector === '.form-grid' ? nodes.grid : null; },
      querySelector() { return this.children.find(child => child.value === 'blofy') || null; },
      appendChild(child) { this.children.push(child); if (child.id) nodes[child.id] = child; },
      insertBefore(child) { this.children.unshift(child); },
      addEventListener(type, callback, capture) { listeners.push({ type, callback, capture }); },
      async dispatchEvent(event) {
        for (const listener of listeners.filter(entry => entry.type === event.type && entry.capture)) {
          await listener.callback(event);
          if (event.stopped) return;
        }
        if (this['on' + event.type]) await this['on' + event.type](event);
        for (const listener of listeners.filter(entry => entry.type === event.type && !entry.capture)) {
          await listener.callback(event);
          if (event.stopped) return;
        }
      },
      click() { return this.dispatchEvent(new BrowserEvent('click')); },
      listeners
    };
    if (id) nodes[id] = node;
    return node;
  }
  class BrowserEvent {
    constructor(type) { this.type = type; this.stopped = false; }
    preventDefault() { this.prevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
  }
  for (const id of ['grid', 'providerType', 'baseUrl', 'name', 'username', 'password', 'deviceId', 'activationCode', 'editorStatus', 'saveBtn']) element(id);
  for (const id of ['baseUrl', 'username', 'password']) nodes[id].wrapper = element();
  nodes.name.labels = [element('nameLabel')];
  nodes.name.required = true;
  nodes.providerType.value = mode;
  const context = vm.createContext({
    document: {
      readyState: 'complete', documentElement: element(),
      getElementById: id => nodes[id] || null,
      createElement: () => element(),
      querySelectorAll: () => [nodes.username.wrapper, nodes.password.wrapper]
    },
    Event: BrowserEvent,
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: responseOk, json: async () => responseOk
        ? { baseUrl: 'https://portal.example.com/subscriber', username: 'proxy-user', password: 'opaque-test-session', providerName: 'مشتركين BLOFY' }
        : { error: 'subscriber_login_failed' } };
    }
  });
  vm.runInContext(`
    const $ = id => document.getElementById(id);
    const translations = { ar: { playlistNameLabel: 'اسم القائمة' }, en: { playlistNameLabel: 'Playlist name' } };
    let locale = 'ar';
    function t(key) { return translations[locale][key]; }
    let auth = ${authenticated ? JSON.stringify({ deviceId: 'BLOFY-TEST-0001', activationCode: '123456' }) : 'null'};
    function typeUi() {
      const isXtream = $('providerType').value === 'xtream';
      document.querySelectorAll('.xtream').forEach(element => element.classList.toggle('hidden', !isXtream));
      if (!isXtream) { $('username').value = ''; $('password').value = ''; }
    }
    $('providerType').onchange = typeUi;
    typeUi();
  `, context);
  nodes.saveBtn.onclick = () => saves.push({ name: nodes.name.value, type: nodes.providerType.value, baseUrl: nodes.baseUrl.value, username: nodes.username.value, password: nodes.password.value });
  vm.runInContext(injectedScript(), context);
  return {
    nodes, requests, saves, observers, context,
    async change(value) { nodes.providerType.value = value; await nodes.providerType.dispatchEvent(new BrowserEvent('change')); },
    async save() { await nodes.saveBtn.click(); await new Promise(resolve => setImmediate(resolve)); }
  };
}

function hidden(node) { return node.style.display === 'none' || node.classList.contains('hidden'); }

test('injects BLOFY subscriber option and secure session flow once', () => {
  const html = '<html><body><select id="providerType"></select><button id="saveBtn"></button></body></html>';
  const injected = injectSubscriberPortalUi(html);
  assert.match(injected, /مشتركين BLOFY/);
  assert.match(injected, /\/api\/v1\/subscribers\/session/);
  assert.match(injected, /data-blofy-subscriber-ui="1"/);
  assert.match(injected, /select\.value = 'xtream'/);
  assert.equal(injectSubscriberPortalUi(injected), injected);
});

test('leaves non-html responses unchanged', () => {
  assert.equal(injectSubscriberPortalUi('{"ok":true}'), '{"ok":true}');
});

test('BLOFY reveals both credentials from M3U and hides only the host', async () => {
  const b = browser({ mode: 'm3u' });
  await b.change('blofy');
  assert.equal(hidden(b.nodes.username.wrapper), false);
  assert.equal(hidden(b.nodes.password.wrapper), false);
  assert.equal(hidden(b.nodes.baseUrl.wrapper), true);
  assert.equal(b.nodes.name.value, '');
  assert.equal(b.nodes.baseUrl.validityMessage, '');
});

test('Xtream to BLOFY preserves credentials and a custom playlist name', async () => {
  const b = browser();
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  b.nodes.name.value = 'Living room';
  await b.change('blofy');
  assert.equal(b.nodes.username.value, 'subscriber');
  assert.equal(b.nodes.password.value, 'secret');
  assert.equal(b.nodes.name.value, 'Living room');
});

test('switching to M3U clears credentials and restores the URL field', async () => {
  const b = browser({ mode: 'blofy' });
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  await b.change('m3u');
  assert.equal(hidden(b.nodes.username.wrapper), true);
  assert.equal(hidden(b.nodes.password.wrapper), true);
  assert.equal(hidden(b.nodes.baseUrl.wrapper), false);
  assert.equal(b.nodes.username.value, '');
  assert.equal(b.nodes.password.value, '');
  await b.change('xtream');
  assert.equal(hidden(b.nodes.username.wrapper), false);
  assert.equal(hidden(b.nodes.password.wrapper), false);
});

test('programmatic clear/edit typeUi calls also restore the URL field', () => {
  const b = browser({ mode: 'blofy' });
  b.nodes.providerType.value = 'xtream';
  vm.runInContext('typeUi()', b.context);
  assert.equal(hidden(b.nodes.baseUrl.wrapper), false);
  assert.equal(b.nodes.blofySubscriberHint.style.display, 'none');
});

test('uses authenticated device state after login cleared the visible inputs', async () => {
  const b = browser({ mode: 'blofy' });
  b.nodes.username.value = ' subscriber ';
  b.nodes.password.value = ' spaced password ';
  assert.equal(b.nodes.deviceId.value, '');
  assert.equal(b.nodes.activationCode.value, '');
  await b.save();
  assert.equal(b.requests.length, 1);
  assert.deepEqual(b.requests[0], { url: '/api/v1/subscribers/session', body: {
    deviceId: 'BLOFY-TEST-0001', activationCode: '123456', username: 'subscriber', password: ' spaced password '
  } });
  assert.equal(b.saves.length, 1);
  assert.deepEqual(b.saves[0], { name: '', type: 'xtream', baseUrl: 'https://portal.example.com/subscriber', username: 'proxy-user', password: 'opaque-test-session' });
});

test('logged-out pages cannot fall back to stale visible device values', async () => {
  const b = browser({ mode: 'blofy', authenticated: false });
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  b.nodes.deviceId.value = 'STALE-DEVICE';
  b.nodes.activationCode.value = '123456';
  await b.save();
  assert.equal(b.requests.length, 0);
  assert.equal(b.saves.length, 0);
  assert.match(b.nodes.editorStatus.textContent, /بيانات الجهاز غير مكتملة/);
  assert.equal(b.nodes.saveBtn.disabled, false);
});

test('rejects empty subscriber credentials without making a request', async () => {
  const b = browser({ mode: 'blofy' });
  await b.save();
  assert.equal(b.requests.length, 0);
  assert.equal(b.saves.length, 0);
  assert.match(b.nodes.editorStatus.textContent, /أدخل اسم المستخدم وكلمة المرور/);
});

test('failed subscriber login stays editable without saving a playlist', async () => {
  const b = browser({ mode: 'blofy', responseOk: false });
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  await b.save();
  assert.equal(b.requests.length, 1);
  assert.equal(b.saves.length, 0);
  assert.equal(b.nodes.providerType.value, 'blofy');
  assert.equal(b.nodes.password.value, 'secret');
  assert.equal(hidden(b.nodes.username.wrapper), false);
  assert.equal(b.nodes.saveBtn.disabled, false);
  assert.match(b.nodes.editorStatus.textContent, /غير صحيحة/);
});

test('mutation observer does not duplicate options, hints, or save handlers', () => {
  const b = browser();
  b.observers.forEach(callback => { callback(); callback(); });
  assert.equal(b.nodes.providerType.children.length, 1);
  assert.equal(b.nodes.grid.children.length, 1);
  assert.equal(b.nodes.saveBtn.listeners.length, 1);
});

test('playlist name is optional and labelled in Arabic and English', () => {
  const b = browser();
  assert.equal(b.nodes.name.required, false);
  assert.equal(b.nodes.nameLabel.textContent, 'اسم القائمة (اختياري)');
  assert.equal(vm.runInContext("locale = 'en'; t('playlistNameLabel')", b.context), 'Playlist name (optional)');
  assert.equal(b.nodes.name.value, '');
});

test('subscriber session metadata cannot rename the user playlist during save', async () => {
  const b = browser({ mode: 'blofy' });
  b.nodes.name.value = 'قائمتي الخاصة';
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  await b.save();
  assert.equal(b.saves.length, 1);
  assert.equal(b.saves[0].name, 'قائمتي الخاصة');
  assert.equal(b.nodes.name.value, 'قائمتي الخاصة');
});

test('blank name survives mode switches and successful subscriber saving', async () => {
  const b = browser();
  for (const mode of ['blofy', 'xtream', 'm3u', 'blofy']) {
    await b.change(mode);
    assert.equal(b.nodes.name.value, '');
  }
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  await b.save();
  assert.equal(b.saves.length, 1);
  assert.equal(b.saves[0].name, '');
});

test('editing and clearing a saved name do not restore the subscriber label', async () => {
  const b = browser({ mode: 'blofy' });
  b.nodes.name.value = 'مشتركين BLOFY';
  vm.runInContext('typeUi()', b.context);
  assert.equal(b.nodes.name.value, 'مشتركين BLOFY');
  b.nodes.name.value = '';
  vm.runInContext('typeUi()', b.context);
  b.observers.forEach(callback => callback());
  b.nodes.username.value = 'subscriber';
  b.nodes.password.value = 'secret';
  await b.save();
  assert.equal(b.saves.length, 1);
  assert.equal(b.saves[0].name, '');
});
