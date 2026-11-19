import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {createStreamCodeXtreamLink} from '../src/xtream-code-dual-link.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {encryptGatewayAccountPassword} from '../src/xtream-account-vault.mjs';

const KEY='be'.repeat(32);
const NOW=Date.parse('2026-11-18T14:00:00Z');
const EXPIRY=new Date(NOW+30*86400000).toISOString();
const ACCOUNT='49e7e9e5-4c18-4caa-a14e-e51ab39d8ba9';
const VOUCHER='c8081f67-c405-4f08-a512-7d188bf1ae1b';
const SOURCE='d2bb0397-1c56-4751-adc9-1a17758022f6';
const OLD='ABCDEF123456ABCDEF123456';
const withPool=handle=>({
  query(sql,args){
    assert.ok(/SELECT|FROM blofy_xtream_gateway_duration_codes/.test(sql));
    assert.deepEqual(args,[streamCodeProof(OLD,KEY)]);
    return Promise.resolve(handle(sql));
  }
});
test('original old 24-hex code without any plaintext code vault still retrieves its SAME active BLOFY Xtream credentials',async()=>{
  const rows=[{
    voucher_id:VOUCHER, redeemed_at:new Date(NOW-30000).toISOString(),
    voucher_expiry:EXPIRY,revoked_at:null,code_vault:null,code_channel:'xtream',account_id:ACCOUNT,
    id:ACCOUNT,username:'BLOFYOLD123',enabled:true,expires_at:EXPIRY,
    source_id:SOURCE,credential_vault:encryptGatewayAccountPassword(ACCOUNT,'OldSafe456',KEY)
  }];
  let statements=0;
  const svc=createStreamCodeXtreamLink({
    pool:withPool(()=>{statements++;return {rows};}),keyHex:KEY,clock:()=>NOW
  });
  const result=await svc.codeToXtream({code:OLD,serverUrl:'https://blofyplayer.com'});
  assert.equal(result.ok,true);
  assert.equal(result.created,false);
  assert.equal(result.subscriptionUnchanged,true);
  assert.equal(result.accountId,ACCOUNT);
  assert.equal(result.credentials.username,'BLOFYOLD123');
  assert.equal(result.credentials.password,'OldSafe456');
  assert.equal(statements,1);
});
test('old code never auto-activates when unused and is never guessed from code hint',async()=>{
  const row={
    voucher_id:VOUCHER,redeemed_at:null,account_id:null,
    voucher_expiry:null,revoked_at:null,id:null
  };
  const svc=createStreamCodeXtreamLink({pool:withPool(()=>({rows:[row]})),keyHex:KEY,clock:()=>NOW});
  await assert.rejects(()=>svc.codeToXtream({code:OLD,serverUrl:'https://blofyplayer.com'}),/stream_link_activate_first/);
  await assert.rejects(()=>svc.codeToXtream({code:'123456',serverUrl:'https://blofyplayer.com'}),/stream_code_invalid/);
});
test('legacy code with an old missing password vault does not fabricate or rotate Xtream credentials',async()=>{
  const row={
    voucher_id:VOUCHER,redeemed_at:new Date(NOW-5000).toISOString(),
    voucher_expiry:EXPIRY,revoked_at:null,account_id:ACCOUNT,
    id:ACCOUNT,username:'BLOFYOLD123',enabled:true,expires_at:EXPIRY,
    source_id:SOURCE,credential_vault:null
  };
  const svc=createStreamCodeXtreamLink({pool:withPool(()=>({rows:[row]})),keyHex:KEY,clock:()=>NOW});
  await assert.rejects(()=>svc.codeToXtream({code:OLD,serverUrl:'https://blofyplayer.com'}),
    /stream_link_credentials_unavailable/);
});
test('BLOFY ONE legacy extractor uses authenticated exact POST lookup and requires explicit operator approval',async()=>{
  const read=name=>readFile(new URL('../web/'+name,import.meta.url),'utf8');
  const [html,js,css,auth]=await Promise.all([
    read('blofy-one.html'),read('blofy-one-legacy.js'),read('blofy-one-legacy.css'),
    readFile(new URL('../src/admin-console-hook.mjs',import.meta.url),'utf8')
  ]);
  assert.doesNotThrow(()=>new Script(js));
  assert.match(html,/id="one-legacy-lookup-form"/);
  assert.match(html,/id="one-legacy-extract-btn"/);
  assert.match(html,/id="one-legacy-credentials"/);
  assert.match(html,/الكود القديم/);
  assert.match(html,/24 خانة/);
  assert.match(js,/\[A-F0-9\]\{24\}/);
  assert.match(js,/\/api\/v1\/admin\/xtream-gateway\/codes\/lookup/);
  assert.match(js,/\/api\/v1\/admin\/xtream-gateway\/link\/code-to-xtream/);
  assert.match(js,/window\.confirm/);
  // Do not auto-discard credentials mid-copy; only the owner can hide them, or they clear on navigation.
  assert.match(js,/one-legacy-hide'\)\.addEventListener\('click', hideCredentials\)/);
  assert.match(js,/visibilitychange/);
  assert.match(js,/pagehide/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/cache:'no-store'/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|console\.log|\/api\/v1\/stream\/redeem/);
  assert.match(css,/@media\(max-width:930px\)/);
  for(const path of ['/blofy-one-legacy.js','/blofy-one-legacy.css'])
    assert.ok(auth.includes("['"+path+"'"),path);
});
