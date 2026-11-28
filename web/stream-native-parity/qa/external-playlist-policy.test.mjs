import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {externalPlaylistOrigins} from '../external-playlist-policy.mjs';
test('external playlist policy fails closed on non-public HTTPS origin configurations',()=>{
 assert.deepEqual(externalPlaylistOrigins('https://provider.example.com, https://media.example.com/'),['https://provider.example.com','https://media.example.com']);
 for(const origin of ['http://provider.example.com','https://127.0.0.1','https://[::1]','https://foo.local','https://localhost','https://foo.internal','https://user:secret@provider.example.com','https://provider.example.com:8443','https://provider.example.com/path','https://provider.example.com?query=1','https://*.example.com','https://ok.example.com,https://127.0.0.1'])assert.deepEqual(externalPlaylistOrigins(origin),[]);
});
test('separate playlist routes require explicit flag and leave native account CSP untouched',()=>{
 const server=readFileSync('server.ts','utf8'),app=readFileSync('app.js','utf8'),client=readFileSync('playlist-preview.js','utf8'),html=readFileSync('playlist-preview.html','utf8');
 assert.match(server,/BLOFY_WEB_EXTERNAL_PLAYLIST_QA==='1'\?externalPlaylistOrigins/);
 assert.match(server,/!PLAYLIST_ORIGINS.length\|\|Bun.env.BLOFY_WEB_SYNTHETIC_ONLY==='1'/);
 assert.match(server,/connect-src 'self' "\+allowed/);
 assert.match(server,/media-src 'self' blob: "\+allowed/);
 assert.match(app,/if\(st===200&&v.external===true\)/);
 assert.match(html,/crossorigin="anonymous"/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|document\.cookie|\/api\/direct-login/);
 assert.match(client,/xhr.withCredentials=false/);
});
