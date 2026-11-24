import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {stableAccountProfileKey,legacyTokenProfileKey} from '../web-profile-key.mjs';
const k=Buffer.from('a'.repeat(64),'hex');
const id='937ba740-b1dd-44cf-9ff4-55b99e4ca15a',other='4e0ce9b3-1b26-4405-af70-86be533e2ffc';
const token=(account,mac)=>'v1.'+account+'.'+String(mac).repeat(43);
const first=token(id,'A'),renew=token(id,'B'),otherAccount=token(other,'A');
test('same account stays on the same opaque browser partition through token/MAC and code renewals',()=>{
 const old=stableAccountProfileKey(first,k),fresh=stableAccountProfileKey(renew,k);
 assert.match(old,/^[a-f0-9]{24}$/);
 assert.equal(old,fresh);
 assert.notEqual(old,stableAccountProfileKey(otherAccount,k));
 assert.notEqual(old,stableAccountProfileKey(first,Buffer.from('b'.repeat(64),'hex')));
 assert.notEqual(old,id.slice(0,24),'no raw server account IDs');
 assert.notEqual(old,first.slice(0,24),'no raw access token segments');
});
test('old version1 storage partition is exactly preserved for local upgrade migration',()=>{
 const expected=createHmac('sha256',k).update('BLOFY-WEB-PROFILE-V1\0'+first).digest('hex').slice(0,24);
 assert.equal(legacyTokenProfileKey(first,k),expected);
 assert.notEqual(legacyTokenProfileKey(renew,k),expected);
 assert.notEqual(legacyTokenProfileKey(first,k),stableAccountProfileKey(first,k));
});
test('malformed account IDs, invalid token formats and incorrect keys are refused',()=>{
 for(const invalid of [null,'','Bearer '+first,token('f'.repeat(36),'A'),
  token('937ba740-b1dd-44cf-9ff4-55b99e4ca15a','!'),
  first+'.extra','v2.'+first.slice(3)]){
  assert.equal(stableAccountProfileKey(invalid,k),null,String(invalid));
  assert.equal(legacyTokenProfileKey(invalid,k),null,String(invalid))
 }
 assert.equal(stableAccountProfileKey(first,Buffer.alloc(15)),null);
 assert.equal(legacyTokenProfileKey(first,null),null);
});
test('web server issues stable opaque ID only after upstream auth and includes old local migration partition',()=>{
 const code=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
 assert.match(code,/stableAccountProfileKey\(v\.accessToken,KEY\)/);
 assert.match(code,/legacyTokenProfileKey\(v\.accessToken,KEY\)/);
 assert.match(code,/v\.active\?stableAccountProfileKey\(token\(req\),KEY\):null/);
 assert.match(code,/v\.active\?legacyTokenProfileKey\(token\(req\),KEY\):null/);
 assert.match(code,/HttpOnly; Secure; SameSite=Strict/);
 assert.match(docker,/COPY server\.ts web-profile-key\.mjs/);
 assert.doesNotMatch(code,/accountId:v\.account|accessToken:v\.accessToken[,}]/);
});
test('migrator only copies current legacy profile keys and never overwrites newer saved profile',()=>{
 const code=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const begin=code.indexOf('function migrateLegacyProfile('),end=code.indexOf('\nfunction useProfile(',begin);
 assert.ok(begin>0&&end>begin);
 const source=code.slice(begin,end);
 const stable='1'.repeat(24),legacy='2'.repeat(24),
  newKey='blofy_web_profile_v1:'+stable+':favorites',
  oldKey='blofy_web_profile_v1:'+legacy+':favorites',
  oldWatchKey='blofy_web_profile_v1:'+legacy+':watch',
  newWatchKey='blofy_web_profile_v1:'+stable+':watch',
  store=Object.create(null);
 store[oldKey]='{"movie:11":true}';
 store[newKey]='{"movie:22":true}';
 store[oldWatchKey]='{"movie:11":{"position":500,"duration":7200,"updated":1000}}';
 const mockStorage={
  getItem:key=>Object.prototype.hasOwnProperty.call(store,key)?store[key]:null,
  setItem:(key,value)=>{store[key]=String(value)}
 };
 const migrate=runInNewContext(source+';migrateLegacyProfile',{localStorage:mockStorage});
 migrate(stable,legacy);
 assert.equal(store[newKey],'{"movie:22":true}','newer current favorite must survive');
 assert.equal(store[newWatchKey],store[oldWatchKey],'missing checkpoint recovered');
 assert.equal(store[oldKey],'{"movie:11":true}','legacy remains available for rollback');
 migrate('3'.repeat(24),'bad!!');
 assert.equal(Object.keys(store).length,4,'malformed legacy marker cannot be migrated');
});
test('session and redeem frontend use verified legacy migration pointer only for same-account profile',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(app,/useProfile\(r\.profileKey,r\.legacyProfileKey\)/);
 assert.match(app,/useProfile\(json\.profileKey,json\.legacyProfileKey\)/);
 assert.match(app,/migrateLegacyProfile\(id,legacy\)/);
});
