import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vodDownloadPath,downloadableResponse,attachmentFilename} from '../vod-download-policy.mjs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');

test('only VOD single-file assets produce a browser download endpoint',()=>{
 assert.equal(vodDownloadPath('movie','123','mp4'),'/api/download/movie/123.mp4');
 assert.equal(vodDownloadPath('series','100','mkv'),'/api/download/series/100.mkv');
 for(const input of [['live','123','ts'],['movie','123','m3u8'],['movie','../abc','mp4'],['series','0','mp4'],['movie','123','html']])
  assert.equal(vodDownloadPath(...input),null);
 assert.equal(attachmentFilename('movie','123','mp4'),'BLOFY-STREAM-movie-123.mp4');
});
test('do not treat login pages or provider denials as downloadable media',()=>{
 for(const type of ['text/html','application/json','application/vnd.apple.mpegurl'])
  assert.equal(downloadableResponse(200,type),false);
 assert.equal(downloadableResponse(200,'video/mp4'),true);
 assert.equal(downloadableResponse(206,'application/octet-stream'),false);
 assert.equal(downloadableResponse(302,'video/mp4'),false);
});
test('download pipeline remains authenticated, capped, disabled by default and does not touch LIVE',()=>{
 assert.match(server,/BLOFY_WEB_VOD_DOWNLOAD_ENABLED!=='1'/);
 assert.match(server,/if\(!h\)return json\(401,\{error:'activation_required'\}\)/);
 assert.match(server,/MAX_VOD_DOWNLOADS=2/);
 assert.match(server,/activeVodDownloads>=MAX_VOD_DOWNLOADS/);
 assert.match(server,/Content-Disposition/);
 assert.match(server,/const reader=upstream.body.getReader\(\)/);
 assert.match(server,/const stream=new ReadableStream/);
 assert.match(server,/\(movie\|series\)/);
 assert.doesNotMatch(server,/download\/(live\|movie\|series)/);
});
test('parity UI keeps subtitles, audio, quality, descriptions and explicit downloads',()=>{
 for(const part of ["player-audio","player-subtitles","player-quality","player-info-panel","detail-plot","data-download","function downloadsScreen","function webDownloadPath"])
  assert.ok(app.includes(part),part);
 assert.match(app,/downloadRequests/);
 assert.match(app,/showPlayerChoices\('الجودة',options,this\)/);
 assert.match(app,/تلقائي \(Auto\)/);
 assert.match(app,/طلبات التنزيل فقط/);
 assert.match(app,/المتصفح/);
});
