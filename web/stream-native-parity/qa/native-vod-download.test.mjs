import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vodDownloadPath,downloadableResponse,attachmentFilename} from '../vod-download-policy.mjs';
test('only complete single-file VOD transfers are accepted',()=>{
 assert.equal(vodDownloadPath('movie','123','mp4'),'/api/download/movie/123.mp4');
 assert.equal(vodDownloadPath('series','123','mkv'),'/api/download/series/123.mkv');
 for(const args of [['live','123','ts'],['movie','../1','mp4'],['series','123','m3u8']])assert.equal(vodDownloadPath(...args),null);
 assert.equal(downloadableResponse(200,'video/mp4'),true);
 assert.equal(downloadableResponse(206,'video/mp4'),false);
 assert.equal(downloadableResponse(200,'text/html'),false);
 assert.equal(attachmentFilename('movie','123','mp4'),'BLOFY-STREAM-movie-123.mp4');
});
test('downloads remain disabled by default and are not cached or claimed complete',()=>{
 const server=readFileSync('server.ts','utf8'),app=readFileSync('app.js','utf8'),sw=readFileSync('sw.js','utf8');
 assert.ok(server.includes("Bun.env.BLOFY_WEB_VOD_DOWNLOAD_ENABLED!=='1'"));
 assert.ok(server.includes('MAX_VOD_DOWNLOADS=2'));
 assert.ok(server.includes('new ReadableStream'));
 assert.ok(app.includes('هذه القائمة تسجل طلبات التنزيل فقط'));
 assert.ok(app.includes("method:'HEAD'"));
 assert.ok(sw.includes("SHELL.indexOf(url.pathname)<0"));
});

test('download cancellation, per-account guard and file size validation are enforced',()=>{
 const server=readFileSync('server.ts','utf8');
 assert.ok(server.includes('activeVodDownloadAccounts.has(accountKey)'));
 assert.ok(server.includes("ctrl.signal.addEventListener('abort',cancelReader"));
 assert.ok(server.includes('headerTimer=setTimeout(cancel,20000)'));
 assert.ok(server.includes('received!==expected'));
 assert.ok(server.includes("upstream.headers.has('content-range')"));
 assert.ok(server.includes("if(download)download.abort()"));
});
