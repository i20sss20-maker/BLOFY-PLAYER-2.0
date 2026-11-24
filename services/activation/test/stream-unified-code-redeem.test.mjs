import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnifiedCodeRedeemer,normalizeUnifiedCode} from '../src/stream-unified-code-redeem.mjs';

const deviceKey='a'.repeat(64),origin='https://blofyplayer.com';
function fixture({paid=false,external=false,lookupError=false,paidError=false,connectError=false}={}){
 const calls=[];
 const redeem=createUnifiedCodeRedeemer({
  paidExists:async code=>{calls.push(['paid lookup',code]);return paid;},
  connectExists:async code=>{calls.push(['external lookup',code]);if(lookupError)throw Error('lookup failed');return external;},
  redeemPaid:async (code,host,key)=>{calls.push(['paid redeem',code,host,key]);if(paidError)throw Error('paid failed');return {ok:true,accessToken:'fixture'};},
  redeemConnect:async code=>{calls.push(['external redeem',code]);if(connectError)throw Error('external failed');return {ok:true,type:'external_xtream'};}
 });
 return {calls,redeem:(code='01234567',key=deviceKey)=>redeem({code,deviceKey:key,origin})};
}
test('normalizes Arabic numbers and preserves leading zeros and case-sensitive BC code',()=>{
 assert.equal(normalizeUnifiedCode('٠١٢٣ ٤٥٦٧'),'01234567');
 assert.equal(normalizeUnifiedCode('BC-AbCdEf0123456789_-AbCdEf'),'BC-AbCdEf0123456789_-AbCdEf');
 assert.equal(normalizeUnifiedCode('bad'),null);
});
test('paid and external codes each consume exactly one correct path',async()=>{
 const a=fixture({paid:true});assert.equal((await a.redeem()).type,'blofy_stream');
 assert.deepEqual(a.calls.map(x=>x[0]),['paid lookup','external lookup','paid redeem']);
 const b=fixture({external:true});assert.equal((await b.redeem()).type,'external_xtream');
 assert.deepEqual(b.calls.map(x=>x[0]),['paid lookup','external lookup','external redeem']);
});
test('ambiguous and unknown codes do not consume either code',async()=>{
 for(const options of [{paid:true,external:true},{}]){
  const a=fixture(options);await assert.rejects(a.redeem(),{status:409});
  assert.deepEqual(a.calls.map(x=>x[0]),['paid lookup','external lookup']);
 }
});
test('failed lookup or failed redemption never falls back',async()=>{
 for(const options of [{paid:true,lookupError:true},{paid:true,paidError:true},{external:true,connectError:true}]){
  const a=fixture(options);await assert.rejects(a.redeem());
  assert.ok(a.calls.filter(x=>x[0].endsWith('redeem')).length<=1);
 }
});
test('invalid device keys never trigger lookup; legacy code formats avoid unnecessary lookups',async()=>{
 const a=fixture({paid:true});await assert.rejects(a.redeem('01234567','bad'),{status:400});
 assert.deepEqual(a.calls,[]);
 await a.redeem('012345678');assert.deepEqual(a.calls.map(x=>x[0]),['paid lookup','paid redeem']);
 const b=fixture({external:true});await b.redeem('BC-AbCdEf0123456789_-AbCdEf');
 assert.deepEqual(b.calls.map(x=>x[0]),['external lookup','external redeem']);
});
