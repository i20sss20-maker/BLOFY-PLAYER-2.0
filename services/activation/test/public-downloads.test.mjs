import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { renderPublicDownloads, servePublicDownloads } from '../src/public-downloads.mjs';

const release = { versionCode: 2000051, versionName: '2.0.0-rc07.40', isPrimary: true,
  channel: 'testing', downloadUrl: 'https://example.com/blofy-40.apk', releaseNotes: 'تحديث آمن' };

test('complete page and APK links exist in initial HTML with no scripts or loading placeholder', () => {
  const html = renderPublicDownloads([release]);
  assert.match(html, /data-server-rendered="true"/);
  assert.ok(html.includes('href="https://example.com/blofy-40.apk"'));
  assert.ok(html.includes('href="/download/latest.apk"'));
  assert.match(html, /★ الإصدار الأساسي/);
  assert.doesNotMatch(html, /<script\b|experience\.js|release-manager\.js|جارٍ قراءة|onclick\s*=/i);
  for (const part of ['tv', 'phone', 'computer']) {
    assert.ok(html.includes(`href="#install-${part}"`));
    assert.ok(html.includes(`id="install-${part}"`));
  }
});

test('primary sorts first independently of channel or version without mutating catalogue', () => {
  const other = { ...release, versionCode: 2000099, versionName: '2.0.0-test', isPrimary: false, channel: 'stable' };
  const items = [other, release]; const html = renderPublicDownloads(items);
  assert.ok(html.indexOf('data-version-code="2000051"') < html.indexOf('data-version-code="2000099"'));
  assert.equal(items[0], other);
});

test('escapes stored text and URL attributes; never turns notes into executable markup', () => {
  const html = renderPublicDownloads([{ ...release, versionName: '<img onerror="evil">', releaseNotes: '</p><script>evil()</script>&', downloadUrl: 'https://example.com/app.apk?a=1&b=2' }]);
  assert.ok(html.includes('&lt;img onerror=&quot;evil&quot;&gt;'));
  assert.ok(html.includes('&lt;script&gt;evil()&lt;/script&gt;'));
  assert.ok(html.includes('href="https://example.com/app.apk?a=1&amp;b=2"'));
  assert.doesNotMatch(html, /<script\b|<img onerror/);
});

for (const url of ['http://example.com/a.apk', 'javascript:alert(1)', 'https://user:pass@example.com/a.apk', 'https://example.com/a.apk#part', 'https://example.com/a.html', 'https://example.com/a.apk\n']) {
  test('omits unsafe or non-APK link: ' + JSON.stringify(url), () => {
    const html = renderPublicDownloads([{ ...release, downloadUrl: url }]);
    assert.doesNotMatch(html, /data-version-code=/);
    assert.ok(!html.includes('id="download-primary"'));
  });
}

test('empty and invalid catalogue does not show an endless loading state', () => {
  for (const items of [[], null, {}, [null, {}]]) {
    const html = renderPublicDownloads(items);
    assert.match(html, /لا توجد إصدارات/);
    assert.doesNotMatch(html, /جارٍ قراءة|<script\b/);
  }
});

test('unrelated and non-read requests are not intercepted', async () => {
  for (const [method, path] of [['GET','/admin'], ['POST','/releases'], ['GET','/portal'], ['GET','/health']]) {
    assert.equal(await servePublicDownloads({ method }, {}, path, { list: () => { throw new Error('must not run'); } }), false);
  }
});

test('HTTP GET/HEAD, aliases, live catalogue changes and bounded human-readable errors', async () => {
  let mode = 'ok', records = [release], reads = 0;
  const server = http.createServer(async (req, res) => {
    const handled = await servePublicDownloads(req, res, new URL(req.url, 'http://localhost').pathname, {
      list: async () => { reads++; if (mode === 'error') throw new Error('private-database-detail'); if (mode === 'hang') return new Promise(() => {}); return { items: records }; },
      timeoutMs: 50
    });
    if (!handled) { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/releases', '/releases/', '/downloads', '/downloads/?reload=1']) {
      const r = await fetch(base + path, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/59.0 Downloader' } });
      assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /charset=utf-8/);
      assert.match(r.headers.get('cache-control'), /no-store/); assert.match(r.headers.get('content-security-policy'), /script-src 'none'/);
      assert.ok((await r.text()).includes(release.downloadUrl));
    }
    let r = await fetch(base + '/releases', { method: 'HEAD' });
    assert.equal(r.status, 200); assert.ok(Number(r.headers.get('content-length')) > 100); assert.equal(await r.text(), '');
    records = [{ ...release, versionName: '2.0.0-new', versionCode: 2000052, downloadUrl: 'https://example.com/new.apk' }];
    r = await fetch(base + '/releases'); const changed = await r.text();
    assert.ok(changed.includes('https://example.com/new.apk')); assert.ok(!changed.includes(release.downloadUrl)); assert.equal(reads, 6);
    for (mode of ['error', 'hang']) {
      r = await fetch(base + '/releases'); assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '15');
      const html = await r.text(); assert.match(html, /تعذّر قراءة الإصدارات/);
      assert.doesNotMatch(html, /private-database-detail|جارٍ قراءة|<script\b/);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
