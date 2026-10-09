import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { injectAzurePortalLuxe } from '../src/azure-portal-luxe-hook.mjs';

test('premium Azure portal skin keeps BLOFY mark prominent and injects once', () => {
  const source = '<html><head></head><body><header class="topbar"></header><div class="hero-panel"></div><section class="dashboard-panel"></section></body></html>';
  const html = injectAzurePortalLuxe(source);
  assert.match(html, /data-blofy-azure-luxe="1"/);
  assert.match(html, /background:url\('\/blofy-logo\.png'\)/);
  assert.match(html, /#blofyRenewBtn/);
  assert.match(html, /\.blofy-renew-card/);
  assert.match(html, /\.dashboard-panel::after/);
  assert.match(html, /\.brand-stage/);
  assert.match(html, /\.dashboard-brandbar/);
  assert.match(html, /\.blofy-modal-brand/);
  assert.equal(injectAzurePortalLuxe(html), html);
});

test('portal document exposes BLOFY icon for tabs and saved shortcuts', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="icon"[^>]+href="\/blofy-logo\.png"/);
  assert.match(html, /rel="apple-touch-icon"[^>]+href="\/blofy-logo\.png"/);
  assert.match(html, /class="brand-logo" src="\/blofy-logo\.png"/);
  assert.match(html, /class="brand-stage"/);
  assert.match(html, /إدارة الجهاز/);
  assert.match(html, /class="dashboard-brandbar"/);
  assert.match(html, /مركز إدارة الجهاز/);
});


test('portal base document constrains structural BLOFY marks without relying on Azure skin', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /\.brand-stage-mark\s*\{[\s\S]*?width:\s*72px;[\s\S]*?height:\s*72px;/);
  assert.match(html, /\.brand-stage-mark img\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/);
  assert.match(html, /class="brand-stage-mark"><img[^>]+width="72"[^>]+height="72"/);
  assert.match(html, /\.dashboard-brand-logo\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
});
