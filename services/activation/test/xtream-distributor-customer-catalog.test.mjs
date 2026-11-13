import test from 'node:test';
import assert from 'node:assert/strict';
import {createDistributorCustomerCatalog}
 from '../src/xtream-distributor-customer-catalog.mjs';

const merchant='4eae65ac-399d-41fd-bab3-ebdc1c8aaf10';
const other='f39dc98d-6e73-434d-a9d9-3b6a0f329a78';
const account='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const saleh='9adc6472-5d4e-4359-83e4-0298cc038ae3';
function pool({matches=[merchant],hidden=['42'],error=false}={}){
 const calls=[];
 return {calls,async query(sql,args){
   calls.push({sql,args});
   if(error)throw Error('database_unavailable');
   if(sql.includes('SELECT DISTINCT i.distributor_id'))
     return {rows:matches.map(distributor_id=>({distributor_id}))};
   if(sql.includes('SELECT o.source_item_id'))
     return {rows:hidden.map(source_item_id=>({source_item_id}))};
   if(sql.includes('SELECT 1 FROM blofy_stream_distributor_library'))
     return {rows:hidden.includes(args[2])?[{exists:1}]:[]};
   throw Error('unexpected_query');
 }};
}
test('canary is disabled by default: no queries and zero changes to any account',async()=>{
 const p=pool();
 const catalog=createDistributorCustomerCatalog({pool:p});
 assert.equal(catalog.enabled,false);
 assert.equal(await catalog.forAccount({id:account,source_id:saleh}),null);
 assert.equal(await catalog.hiddenIds(null,'movie'),null);
 assert.equal(await catalog.isHidden(null,'movie','42'),false);
 assert.equal(p.calls.length,0);
});
test('canary requires both explicit opt-in and one account-owning merchant allowlist',async()=>{
 const db=pool();
 const disabled=createDistributorCustomerCatalog({pool:db,enabled:true});
 assert.equal(disabled.enabled,false);
 assert.equal((await disabled.forAccount({id:account,source_id:saleh})),null);
 const catalog=createDistributorCustomerCatalog({pool:db,enabled:true,
   distributorAllowlist:merchant,accountAllowlist:account});
 const scope=await catalog.forAccount({id:account,source_id:saleh});
 assert.equal(scope.distributorId,merchant);
 assert.equal(scope.sourceId,saleh);
 assert.ok(Object.isFrozen(scope));
 const ids=await catalog.hiddenIds(scope,'movie');
 assert.deepEqual([...ids],['42']);
 assert.equal(await catalog.isHidden(scope,'movie','42'),true);
 assert.equal(await catalog.isHidden(scope,'movie','44'),false);
 assert.equal(await catalog.isHidden(scope,'movie','https://provider.example'),false);
 assert.equal(db.calls[0].args[0],account);
 assert.equal(db.calls[0].args[1],saleh);
 assert.ok(db.calls.every(x=>!x.sql.includes('password')));
});
test('unknown, ambiguous and other merchants never acquire a cross-merchant visibility scope',async()=>{
 for(const matches of [[],[merchant,other],[other]]){
   const db=pool({matches});
   const catalog=createDistributorCustomerCatalog({pool:db,enabled:true,
     distributorAllowlist:merchant,accountAllowlist:account});
   assert.equal(await catalog.forAccount({id:account,source_id:saleh}),null);
 }
 const db=pool();
 const catalog=createDistributorCustomerCatalog({pool:db,enabled:true,
   distributorAllowlist:merchant,accountAllowlist:account});
 assert.equal(await catalog.forAccount({id:'not-a-uuid',source_id:saleh}),null);
 assert.equal(await catalog.forAccount({id:account}),null);
 assert.equal(db.calls.length,0);
});
test('bounded catalog reads forbid unbounded hidden-item allocations and invalid media types',async()=>{
 const many=Array.from({length:10001},(_,i)=>String(i+1000));
 const db=pool({hidden:many});
 const catalog=createDistributorCustomerCatalog({pool:db,enabled:true,
   distributorAllowlist:merchant,accountAllowlist:account});
 const scope=await catalog.forAccount({id:account,source_id:saleh});
 await assert.rejects(catalog.hiddenIds(scope,'movie'),/distributor_catalog_hidden_over_cap/);
 await assert.rejects(catalog.hiddenIds(scope,'invalid'),/distributor_catalog_kind_invalid/);
 await assert.rejects(catalog.isHidden(scope,'invalid','42'),/distributor_catalog_kind_invalid/);
 assert.equal(db.calls[1].args[3],10001);
});
test('network/DB failure does not disrupt ordinary subscribers or reveal account details',async()=>{
 const errors=[];
 const db=pool({error:true}),catalog=createDistributorCustomerCatalog({
   pool:db,enabled:true,distributorAllowlist:merchant,accountAllowlist:account,
   onError:code=>errors.push(code)
 });
 await assert.rejects(catalog.forAccount({id:account,source_id:saleh}),
   /distributor_catalog_scope_unavailable/);
 assert.equal(await catalog.forAccount({id:other,source_id:saleh}),null);
 assert.deepEqual(errors,['distributor_catalog_scope_lookup_unavailable']);
 assert.equal(db.calls.length,1);
});
