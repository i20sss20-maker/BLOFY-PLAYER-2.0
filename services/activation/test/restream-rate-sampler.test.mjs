import test from 'node:test';
import assert from 'node:assert/strict';
import {createRestreamRateSampler} from '../src/restream-rate-sampler.mjs';
test('calculates HLS egress Mbps only with two separated readings',()=>{
 let now=10000;
 const sample=createRestreamRateSampler({clock:()=>now});
 let r=sample({ok:true,totals:{hlsBytes:100000}});
 assert.equal(r.measured,false);
 now=11000;
 r=sample({ok:true,totals:{hlsBytes:225000}});
 assert.equal(r.measured,true);
 assert.equal(r.hlsEgressMbps,1);
 assert.equal(r.bytesSentInInterval,125000);
});
test('skips polling too soon and handles counter reset without negative rate',()=>{
 let now=10000;const sample=createRestreamRateSampler({clock:()=>now});
 sample({ok:true,totals:{hlsBytes:10000}});
 now=10100;assert.equal(sample({ok:true,totals:{hlsBytes:10001}}).measured,false);
 now=12000;assert.equal(sample({ok:true,totals:{hlsBytes:10}}).reason,'counter_reset_or_expired');
 now=14000;assert.equal(sample({ok:true,totals:{hlsBytes:1010}}).measured,true);
});
test('rejects invalid readings and long stale intervals',()=>{
 let now=1000;const sample=createRestreamRateSampler({clock:()=>now});
 assert.equal(sample({ok:false}).ok,false);
 sample({ok:true,totals:{hlsBytes:10}});
 now+=400000;
 assert.equal(sample({ok:true,totals:{hlsBytes:100}}).measured,false);
});
