import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBrowserEngine, recoveryDelay, createBrowserStreamPlayer } from '../web/browser-playback-engine.mjs';

test('native HLS is preferred on Safari when supported', () => {
  assert.equal(selectBrowserEngine({ format: 'hls', nativeHls: true, hlsJs: true }), 'native-hls');
  assert.equal(selectBrowserEngine({ url: '/live/a.m3u8', hlsJs: true }), 'hls-js');
  assert.equal(selectBrowserEngine({ format: 'hls' }), 'unsupported');
});
test('TS is never accidentally passed to an HLS adapter', () => {
  assert.equal(selectBrowserEngine({ format: 'ts', nativeHls: true, hlsJs: true }), 'unsupported');
  assert.equal(selectBrowserEngine({ format: 'ts', mpegtsJs: true }), 'mpegts-js');
});
test('MP4 requires native codec/container support', () => {
  assert.equal(selectBrowserEngine({ url: '/media/video.mp4', nativeMp4: true }), 'native-mp4');
  assert.equal(selectBrowserEngine({ url: '/media/video.mp4' }), 'unsupported');
});
test('backoff increases with bounded jitter and cap', () => {
  assert.equal(recoveryDelay(0, 0.5), 800);
  assert.equal(recoveryDelay(1, 0.5), 1600);
  assert.ok(recoveryDelay(100, 1) <= 12000);
});
test('player rejects upstream and credential-bearing URLs', () => {
  const video = {
    canPlayType: () => 'maybe',
    addEventListener() {}, removeEventListener() {}, pause() {}, load() {},
    removeAttribute() {}, play() { return Promise.resolve(); }, currentTime: 0
  };
  const player = createBrowserStreamPlayer(video, { origin: 'https://blofyplayer.com' });
  assert.throws(() => player.open({ url: 'https://provider.example.com/secret.m3u8', format: 'hls' }), /same-origin/);
  assert.throws(() => player.open({ url: 'http://blofyplayer.com/test.m3u8', format: 'hls' }), /secure media/);
  assert.throws(() => player.open({ url: 'https://user:pass@blofyplayer.com/file.m3u8', format: 'hls' }), /same-origin/);
  player.destroy();
});

test('transient error reconnects twice while preserving the player lifecycle', async () => {
  const events = new Map();
  const state = [];
  let loads = 0;
  const video = {
    paused: false, ended: false, seeking: false, readyState: 0, currentTime: 0,
    canPlayType: (mime) => mime.includes('mpegurl') ? 'maybe' : '',
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name) { events.delete(name); },
    pause() {}, load() { loads++; }, removeAttribute() {},
    play() { return Promise.resolve(); }
  };
  const player = createBrowserStreamPlayer(video, {
    origin: 'https://blofyplayer.com',
    onStatus: (value) => state.push(value),
    maxRetries: 3
  });
  try {
    assert.equal(player.open({ url: '/api/authorized/live.m3u8', format: 'hls' }), true);
    events.get('error')();
    assert.ok(state.includes('reconnecting'));
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.ok(loads >= 3, 'first recovery must reload a media source');
    const afterFirst = loads;
    events.get('error')();
    await new Promise(resolve => setTimeout(resolve, 1900));
    assert.ok(loads > afterFirst, 'later recoveries must remain possible');
  } finally {
    player.destroy();
  }
});
test('changing channel cancels pending reconnect and never loads a previous channel', async () => {
  const events = new Map();
  const video = {
    paused: false, ended: false, seeking: false, readyState: 0, currentTime: 0,
    canPlayType: () => 'maybe',
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name) { events.delete(name); },
    pause() {}, load() {}, removeAttribute() {},
    play() { return Promise.resolve(); }
  };
  const player = createBrowserStreamPlayer(video, { origin: 'https://blofyplayer.com' });
  try {
    player.open({ url: '/api/authorized/a.m3u8', format: 'hls' });
    events.get('error')();
    player.open({ url: '/api/authorized/b.m3u8', format: 'hls' });
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.match(video.src, /\/b\.m3u8$/);
  } finally {
    player.destroy();
  }
});

test('internal teardown does not get mistaken for a manual pause', async () => {
  const events = new Map();
  let loads = 0;
  const video = {
    paused: false, ended: false, seeking: false, readyState: 0, currentTime: 0,
    canPlayType: () => 'maybe',
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name) { events.delete(name); },
    pause() { events.get('pause')?.(); },
    load() { loads++; },
    removeAttribute() {},
    play() { return Promise.resolve(); }
  };
  const states = [];
  const player = createBrowserStreamPlayer(video, { origin: 'https://blofyplayer.com', onStatus: status => states.push(status) });
  try {
    player.open({ url: '/api/live/test.m3u8', format: 'hls' });
    events.get('error')();
    assert.ok(states.includes('reconnecting'), 'internal pause should not block recovery');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.ok(loads >= 3);
    assert.equal(player.resume(), true);
  } finally {
    player.destroy();
  }
});
