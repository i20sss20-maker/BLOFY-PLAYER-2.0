import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLinodeGatewayMapping as inspect} from '../src/linode-gateway-mapping-qa.mjs';
const a='00000000-0000-4000-8000-000000000001',s='00000000-0000-4000-8000-000000000002';
const now=Date.parse('2026-11-26T00:00:00Z');
const env={BLOFY_LINODE_MAPPING_QA:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:a,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:s};
const account={id:a,source_id:s,enabled:true,expires_at:new Date(now+60000)};
const opts={env,now,isHidden:async()=>false};
test('disabled and disallowed accounts never reach the database',async()=>{
 const db={query:()=>{throw Error('unexpected query')}};
 for(const [row,flags] of [[account,{}],[{...account,id:s},env],[{...account,source_id:null},env],[{...account,enabled:false},env],[{...account,expires_at:null},env]]){
   assert.equal((await inspect(db,row,{kind:'live',gatewayId:'123'},{...opts,env:flags})).status,404);
 }
});
test('live, movie, series and episode mapping all use the scoped existing IDs',async()=>{
 for(const kind of ['live','movie','series','episode']){
   const expected=kind==='episode'?'series':kind;
   const db={query:async(sql,params)=>{
     assert.deepEqual(params,['123',expected,s]);
     assert.match(sql,/deletion_requested_at IS NULL/);
     assert.match(sql,/c.enabled IS NULL OR c.enabled=TRUE/);
     assert.ok(!/password_secret|username_secret|base_url/.test(sql));
     assert.equal(sql.includes('episode_map'),kind==='episode');
     return {rows:[{item_id:'provider-identifier',server_id:s}]};
   }};
   const result=await inspect(db,account,{kind,gatewayId:'123'},{...opts,isHidden:async(k,v)=>{assert.equal(k,expected);assert.equal(v,'provider-identifier');return false}});
   assert.equal(result.status,200);assert.equal(result.body.mediaVerified,false);assert.equal(result.body.customerCutover,false);
   assert.ok(!JSON.stringify(result).includes('provider-identifier'));
 }
});
test('missing items, hidden content and uncertain visibility fail closed',async()=>{
 const input={kind:'movie',gatewayId:'123'};
 for(const [rows,hidden] of [[[],false],[[{item_id:'p',server_id:a}],false],[[{item_id:'p',server_id:s}],true],[[{item_id:'p',server_id:s}],undefined]]){
 const result=await inspect({query:async()=>({rows})},account,input,{...opts,isHidden:async()=>hidden});
 assert.equal(result.status,404);
 }
 assert.equal((await inspect({query:async()=>{throw Error('db down')}},account,input,opts)).status,503);
 assert.equal((await inspect({},account,{kind:'movie',gatewayId:'123 OR 1=1'},opts)).status,400);
});
