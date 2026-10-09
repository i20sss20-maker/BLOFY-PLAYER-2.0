import { execFileSync } from 'node:child_process';
import { INDEXNOW_KEY, INDEXNOW_KEY_PATH } from '../../services/activation/src/indexnow-key.mjs';

const origin = 'https://blofyplayer.com';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function urlsToNotify() {
  let changed = '';
  try {
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { encoding: 'utf8' });
  } catch {
    console.log('Could not inspect changed paths; using official public page list.');
  }
  const paths = changed.trim().split('\n').filter(Boolean);
  if (paths.length === 0 || paths.includes('.github/workflows/indexnow.yml') ||
      paths.includes('services/activation/src/server.mjs')) {
    return ['/', '/connect', '/downloads', '/privacy', '/status'];
  }
  const selected = new Set();
  for (const path of paths) {
    if (path === 'services/activation/web/index.html') {
      selected.add('/'); selected.add('/connect');
    } else if (path === 'services/activation/src/public-downloads.mjs') {
      selected.add('/downloads');
    } else if (path.includes('privacy')) {
      selected.add('/privacy');
    } else if (path.includes('status')) {
      selected.add('/status');
    } else if (path.startsWith('services/activation/web/')) {
      selected.add('/'); selected.add('/downloads');
    }
  }
  return [...selected];
}

const paths = urlsToNotify();
if (paths.length === 0) {
  console.log('No affected public URLs to notify.');
  process.exit(0);
}

// Railway auto-deploys after main changes. Wait until the key is live before
// asking IndexNow to verify it. Do not use site login credentials or secrets.
let ready = false;
for (let attempt = 0; attempt < 36; attempt++) {
  try {
    const res = await fetch(origin + INDEXNOW_KEY_PATH, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok && (await res.text()).trim() === INDEXNOW_KEY) {
      ready = true;
      break;
    }
  } catch (error) {
    console.log('Waiting for public key deployment: ' + String(error?.message || error));
  }
  await sleep(10000);
}
if (!ready) {
  throw new Error('IndexNow key is not publicly readable at the apex domain yet.');
}
console.log('IndexNow key reachable at canonical public domain.');

const payload = {
  host: 'blofyplayer.com',
  key: INDEXNOW_KEY,
  keyLocation: origin + INDEXNOW_KEY_PATH,
  urlList: paths.map(path => origin + path)
};
const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(20000)
});
const responseBody = await response.text();
console.log('IndexNow status: ' + response.status + '; pages notified: ' + payload.urlList.join(', '));
if (![200, 202].includes(response.status)) {
  throw new Error('IndexNow rejected notification: HTTP ' + response.status + ' ' + responseBody.slice(0, 300));
}
