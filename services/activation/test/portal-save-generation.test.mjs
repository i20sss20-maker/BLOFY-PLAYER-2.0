import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Narrow DOM/network doubles execute the real injected JavaScript. These are
// behavioral unit tests, not browser, PostgreSQL, receiver or end-to-end tests.
const previousWhatsapp = process.env.BLOFY_RENEWAL_WHATSAPP;
process.env.BLOFY_RENEWAL_WHATSAPP = '+966 50 000 0000';
const configured = await import('../src/subscriber-portal-ui-hook.mjs?runtime-configured');
delete process.env.BLOFY_RENEWAL_WHATSAPP;
const unconfigured = await import('../src/subscriber-portal-ui-hook.mjs?runtime-unconfigured');
if (previousWhatsapp === undefined) delete process.env.BLOFY_RENEWAL_WHATSAPP;
else process.env.BLOFY_RENEWAL_WHATSAPP = previousWhatsapp;

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const session = {
  providerId: 'test-provider', providerName: 'Test subscriber',
  baseUrl: 'https://example.invalid/api/v1/subscribers/xtream',
  username: 'opaque-session-test-token', password: 'opaque-session-test-proof'
};
const reply = (body, ok = true) => ({ ok, json: async () => body });

function harness({ transport, whatsapp = true, authenticated = true } = {}) {
  const ids = new Map();
  const observers = [];
  const requests = [];
  const opened = [];
  const alerts = [];
  let mutations = 0;
  let loads = 0;
  let clears = 0;
  let legacySaves = 0;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.dataset = {}; this.style = {}; this.listeners = {}; this.attrs = {};
      this.value = ''; this.checked = true; this.disabled = false; this._text = '';
      this._classes = new Set();
      this.classList = {
        add: x => this._classes.add(x), remove: x => this._classes.delete(x),
        contains: x => this._classes.has(x),
        toggle: (x, on) => { if (on) this._classes.add(x); else this._classes.delete(x); }
      };
    }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set className(value) { this._classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this._classes].join(' '); }
    set textContent(value) { this._text = String(value); mutations++; }
    get textContent() { return this._text; }
    get options() { return this.children.filter(x => x.tagName === 'OPTION'); }
    get firstChild() { return this.children[0] || null; }
    appendChild(node) { node.parentNode = this; this.children.push(node); mutations++; return node; }
    insertBefore(node, before) {
      node.parentNode = this;
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
      mutations++; return node;
    }
    remove() {
      if (this.parentNode) {
        const list = this.parentNode.children;
        const index = list.indexOf(this);
        if (index >= 0) { list.splice(index, 1); mutations++; }
        this.parentNode = null;
      }
    }
    closest(selector) {
      if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
      return this.parentNode?.closest(selector) || null;
    }
    querySelectorAll(selector) {
      const matches = node => {
        if (selector === '[data-plan]') return Object.hasOwn(node.attrs, 'data-plan');
        if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
        const option = selector.match(/^option\[value="([^"]+)"\]$/);
        return !!option && node.tagName === 'OPTION' && node.value === option[1];
      };
      const result = [];
      for (const child of this.children) {
        if (matches(child)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setCustomValidity(value) { this.validationMessage = value; }
    set innerHTML(value) {
      // Parse only the fixed, trusted renewal fixture used by the production injector.
      this.children = [];
      for (const match of value.matchAll(/data-plan="([^"]+)" data-price="([^"]+)"/g)) {
        const button = new Element('button');
        button.attrs['data-plan'] = match[1]; button.attrs['data-price'] = match[2];
        this.appendChild(button);
      }
      if (value.includes('blofy-renew-close')) {
        const close = new Element('button'); close.className = 'blofy-renew-close';
        this.appendChild(close);
      }
    }
    addEventListener(name, fn, capture = false) {
      (this.listeners[name] ||= []).push({ fn, capture });
    }
    dispatchEvent(event) {
      event.target ||= this;
      const work = [];
      for (const { fn } of [...(this.listeners[event.type] || [])].sort((a,b) => Number(b.capture)-Number(a.capture))) {
        work.push(fn.call(this, event));
        if (event.stopped) break;
      }
      if (!event.stopped && typeof this['on' + event.type] === 'function') {
        work.push(this['on' + event.type].call(this, event));
      }
      return Promise.all(work);
    }
    click() { return this.dispatchEvent(new BrowserEvent('click')); }
  }
  class BrowserEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
  }
  const body = new Element('body');
  const actions = new Element(); actions.className = 'actions'; body.appendChild(actions);
  const grid = new Element(); grid.className = 'form-grid'; body.appendChild(grid);
  for (const id of ['deviceId','activationCode','name','baseUrl','username','password','providerType','active','saveBtn','newBtn','editor','editorStatus']) {
    const tag = id === 'providerType' ? 'select' : id.endsWith('Btn') ? 'button' : 'input';
    const node = new Element(tag); node.id = id;
    const wrapper = new Element(); wrapper.className = 'field'; grid.appendChild(wrapper); wrapper.appendChild(node);
  }
  const n = id => ids.get(id);
  for (const value of ['xtream','m3u']) { const option = new Element('option'); option.value = value; option.textContent = value; n('providerType').appendChild(option); }
  n('providerType').value = 'xtream';
  n('deviceId').value = authenticated ? 'BLOFY-TEST-0001' : '';
  n('activationCode').value = authenticated ? 'test-only-pin' : '';
  n('name').value = 'My test list'; n('username').value = 'typed-test-user'; n('password').value = 'typed-test-password';
  const document = {
    readyState: 'complete', body, documentElement: body,
    getElementById: id => ids.get(id) || null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === '.dashboard-head .actions' ? actions : null
  };
  const context = vm.createContext({
    document, Event: BrowserEvent, URL, encodeURIComponent, console,
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    requestAnimationFrame: fn => fn(), alert: message => alerts.push(message),
    fetch: async (url, options) => {
      const request = { url, body: JSON.parse(options.body), method: options.method };
      requests.push(request);
      return transport ? transport(request) : reply(url.endsWith('/session') ? session : { ok: true });
    }
  });
  context.auth = { deviceId: n('deviceId').value, activationCode: n('activationCode').value };
  context.window = context;
  context.location = { reload: () => { loads++; } };
  context.open = (...args) => opened.push(args);
  context.load = async () => { loads++; };
  context.typeUi = () => {
    if (n('providerType').value !== 'xtream') { n('username').value = ''; n('password').value = ''; }
  };
  context.clearEditor = () => {
    clears++; n('providerType').value = 'xtream';
    for (const id of ['name','baseUrl','username','password']) n(id).value = '';
  };
  context.openEditor = () => { context.clearEditor(); n('editor').classList.remove('hidden'); };
  context.edit = item => {
    n('providerType').value = 'xtream';
    for (const id of ['name','baseUrl','username','password']) n(id).value = item[id] || '';
    n('editor').classList.remove('hidden');
  };
  n('providerType').onchange = context.typeUi;
  n('newBtn').onclick = context.openEditor;
  n('saveBtn').onclick = () => { legacySaves++; };
  const injector = whatsapp ? configured.injectSubscriberPortalUi : unconfigured.injectSubscriberPortalUi;
  const html = injector('<html><body></body></html>');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context, { timeout: 1000 });
  return {
    n, context, requests, opened, alerts,
    refresh: () => observers.forEach(fn => fn()),
    mutationCount: () => mutations,
    loadCount: () => loads, clearCount: () => clears, legacyCount: () => legacySaves,
    subscriber: () => { n('providerType').value = 'blofy'; return n('providerType').dispatchEvent(new BrowserEvent('change')); },
    save: () => n('saveBtn').click(),
    newEditor: () => n('newBtn').click(),
    addM3u: () => { const option = new Element('option'); option.value = 'm3u'; n('providerType').appendChild(option); }
  };
}

test('runtime: v5 retains its selector, optional name and single save interceptor', () => {
  const h = harness();
  assert.deepEqual(h.n('providerType').options.map(x => x.value), ['blofy', 'xtream']);
  assert.equal(h.n('saveBtn').listeners.click.length, 1);
  assert.equal(h.n('name').required, false);
});

test('runtime: subscriber creation posts the resolved session exactly once', async () => {
  const h=harness(); await h.subscriber(); h.n('active').checked=false; await h.save();
  assert.equal(h.requests.length,2); assert.equal(h.legacyCount(),0);
  const [login,saved]=h.requests;
  assert.equal(login.body.username,'typed-test-user');
  assert.equal(saved.url,'/api/v1/portal/playlists');
  assert.equal(saved.body.providerType,'xtream'); assert.equal(saved.body.username,session.username);
  assert.equal(saved.body.password,session.password); assert.equal(saved.body.baseUrl,session.baseUrl);
  assert.equal(saved.body.name,'My test list'); assert.equal(saved.body.active,false);
  assert.equal(Object.hasOwn(saved.body,'id'),false);
  assert.equal(h.n('saveBtn').disabled,false); assert.equal(h.loadCount(),1);
});

test('runtime: rapid duplicate clicks share one save operation', async () => {
  const hold=deferred();
  const h=harness({transport:req=>req.url.endsWith('/session')?hold.promise:reply({ok:true})});
  await h.subscriber(); const first=h.save(); const second=h.save();
  assert.equal(h.requests.length,1); assert.equal(h.n('saveBtn').disabled,true);
  hold.resolve(reply(session)); await Promise.all([first,second]);
  assert.equal(h.requests.length,2); assert.equal(h.n('saveBtn').disabled,false);
});

test('runtime: editing hides opaque credentials and preserves the playlist ID', async () => {
  const h=harness();
  h.context.edit({...session,id:77,name:'Existing list'});
  assert.equal(h.n('username').value,''); assert.equal(h.n('password').value,'');
  assert.equal(h.n('providerType').value,'blofy');
  h.n('username').value='replacement-user'; h.n('password').value='replacement-password';
  await h.save(); assert.equal(h.requests[1].body.id,77);
});

test('runtime: opening a new list clears a previous subscriber edit identity', async () => {
  const h=harness(); h.context.edit({...session,id:77,name:'Existing list'});
  await h.newEditor(); await h.subscriber();
  h.n('username').value='new-user'; h.n('password').value='new-password';
  await h.save(); assert.equal(Object.hasOwn(h.requests[1].body,'id'),false);
});

test('runtime: a failed login cannot write a playlist and releases the save lock', async () => {
  const h=harness({transport:()=>reply({error:'subscriber_login_failed'},false)});
  await h.subscriber(); await h.save();
  assert.equal(h.requests.length,1); assert.equal(h.n('saveBtn').disabled,false);
  assert.equal(h.n('saveBtn').dataset.blofyBusy,'0');
  assert.match(h.n('editorStatus').textContent,/غير صحيحة/);
});

test('runtime: failed save retains the editor and does not echo server secrets', async () => {
  const h=harness({transport:req=>reply(req.url.endsWith('/session')?session:{error:'SECRET-test-provider-password'},req.url.endsWith('/session'))});
  await h.subscriber(); await h.save();
  assert.equal(h.requests.length,2); assert.equal(h.clearCount(),0);
  assert.equal(h.n('saveBtn').disabled,false);
  assert.doesNotMatch(h.n('editorStatus').textContent,/SECRET/);
});

test('runtime: editor change while resolving a session cancels the old write', async () => {
  const hold=deferred(); const h=harness({transport:()=>hold.promise});
  await h.subscriber(); const saving=h.save(); await h.newEditor();
  hold.resolve(reply(session)); await saving;
  assert.equal(h.requests.length,1);
  assert.doesNotMatch(h.n('editorStatus').textContent,/تغير الجهاز أو القائمة/);
});

test('runtime: device change while resolving a session cancels the old write', async () => {
  const hold=deferred(); const h=harness({transport:()=>hold.promise});
  await h.subscriber(); const saving=h.save(); h.context.auth = { ...h.context.auth, deviceId:'BLOFY-OTHER-0002' };
  hold.resolve(reply(session)); await saving;
  assert.equal(h.requests.length,1); assert.equal(h.n('saveBtn').disabled,false);
});

test('runtime: a late successful write leaves a newer editor untouched', async () => {
  const hold=deferred(); const reached=deferred();
  const h=harness({transport:req=>{if(req.url.endsWith('/session'))return reply(session);reached.resolve();return hold.promise;}});
  await h.subscriber(); const saving=h.save(); await reached.promise;
  await h.newEditor(); h.n('name').value='Do not erase'; const before=h.clearCount();
  hold.resolve(reply({ok:true})); await saving;
  assert.equal(h.n('name').value,'Do not erase'); assert.equal(h.clearCount(),before);
  assert.equal(h.loadCount(),0);
});

test('runtime: missing device credentials never reach the network', async () => {
  const h=harness({authenticated:false}); await h.subscriber(); await h.save();
  assert.equal(h.requests.length,0); assert.equal(h.n('saveBtn').disabled,false);
});

test('runtime: incomplete session payload never reaches playlist storage', async () => {
  const h=harness({transport:()=>reply({providerId:'incomplete'})});
  await h.subscriber(); await h.save();
  assert.equal(h.requests.length,1); assert.equal(h.n('saveBtn').disabled,false);
});

test('runtime: ordinary Xtream saves retain the original event handler', async () => {
  const h=harness(); await h.save();
  assert.equal(h.requests.length,0); assert.equal(h.legacyCount(),1);
});

test('runtime: renewal opens an encoded message without PIN or provider password', async () => {
  const h=harness(); await h.n('blofyRenewBtn').click();
  assert.equal(h.n('blofyRenewModal').classList.contains('hidden'),false);
  const plans=h.n('blofyRenewModal').querySelectorAll('[data-plan]');
  assert.deepEqual(plans.map(x=>[x.getAttribute('data-plan'),x.getAttribute('data-price')]),[
    ['3 شهور','10 ريال'],['6 شهور','18 ريال'],['سنة','25 ريال'],['مدى الحياة','40 ريال']
  ]);
  await plans[0].click(); assert.equal(h.opened.length,1);
  const [url,target,features]=h.opened[0];
  const parsed=new URL(url); assert.equal(parsed.hostname,'wa.me'); assert.equal(parsed.pathname,'/966500000000');
  assert.match(parsed.searchParams.get('text'),/BLOFY-TEST-0001/);
  assert.match(parsed.searchParams.get('text'),/3 شهور/);
  assert.ok(parsed.searchParams.get('text').includes('\n\nرقم جهازي:'));
  assert.doesNotMatch(parsed.searchParams.get('text'),/test-only-pin|typed-test-password/);
  assert.equal(target,'_blank'); assert.equal(features,'noopener');
});

test('runtime: missing renewal configuration cannot open an arbitrary recipient', async () => {
  const h=harness({whatsapp:false});
  await h.n('blofyRenewModal').querySelectorAll('[data-plan]')[0].click();
  assert.equal(h.opened.length,0); assert.equal(h.alerts.length,1);
});

test('runtime: injected v5 markup is idempotent', () => {
  const first = configured.injectSubscriberPortalUi('<html><body></body></html>');
  assert.equal(configured.injectSubscriberPortalUi(first), first);
  assert.doesNotMatch(first, /MutationObserver/);
});

test('runtime: cleared login inputs do not replace authenticated page state', async () => {
  const h = harness(); h.n('deviceId').value=''; h.n('activationCode').value='';
  await h.subscriber(); await h.save();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.deviceId, 'BLOFY-TEST-0001');
});

test('runtime: reauthentication with the same values still invalidates the old session result', async () => {
  const hold=deferred(); const h=harness({transport:()=>hold.promise});
  await h.subscriber(); const saving=h.save(); h.context.auth = {...h.context.auth};
  hold.resolve(reply(session)); await saving;
  assert.equal(h.requests.length, 1);
});

test('runtime: a late failed save cannot overwrite a newer editor status', async () => {
  const hold=deferred(); const reached=deferred();
  const h=harness({transport:req=>{if(req.url.endsWith('/session'))return reply(session);reached.resolve();return hold.promise;}});
  await h.subscriber(); const saving=h.save(); await reached.promise;
  await h.newEditor(); h.n('editorStatus').textContent='New editor status';
  hold.resolve(reply({error:'upstream-secret'}, false)); await saving;
  assert.equal(h.n('editorStatus').textContent, 'New editor status');
});

test('runtime: changing the selected type while login is pending cancels the old save', async () => {
  const hold=deferred(); const h=harness({transport:()=>hold.promise});
  await h.subscriber(); const saving=h.save();
  h.n('providerType').value='xtream'; h.context.typeUi();
  hold.resolve(reply(session)); await saving;
  assert.equal(h.requests.length, 1);
});

test('runtime: save snapshots name and enabled state before the login resolves', async () => {
  const hold=deferred(); const h=harness({transport:req=>req.url.endsWith('/session')?hold.promise:reply({ok:true})});
  await h.subscriber(); h.n('name').value='Original'; h.n('active').checked=false;
  const saving=h.save(); h.n('name').value='Changed while pending'; h.n('active').checked=true;
  hold.resolve(reply(session)); await saving;
  assert.equal(h.requests[1].body.name, 'Original'); assert.equal(h.requests[1].body.active, false);
});
