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
