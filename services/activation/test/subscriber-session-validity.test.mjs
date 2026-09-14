import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriberSessionValid} from '../src/subscriber-session-validity.mjs';
const now=2e12, token={d:'BLOFY-TEST-USER',exp:now+1000};
test('legacy tokens only work with the original version and current entitlement',async()=>{
  let row={status:'active',expires_at:null,session_version:0};
  const pool={query:async()=>({rows:row?[row]:[]})};
  assert.equal(await subscriberSessionValid(pool,token,now),true);
  row.status='blocked';assert.equal(await subscriberSessionValid(pool,token,now),false);
  row.status='active';row.session_version=1;assert.equal(await subscriberSessionValid(pool,token,now),false);
  assert.equal(await subscriberSessionValid(pool,{...token,sv:1},now),true);
  row.expires_at=new Date(now-1);assert.equal(await subscriberSessionValid(pool,{...token,sv:1},now),false);
  row=null;assert.equal(await subscriberSessionValid(pool,token,now),false);
});
test('malformed sessions are denied and database failures never grant access',async()=>{
  const pool={query:async()=>{throw Error('offline');}};
  assert.equal(await subscriberSessionValid(pool,{...token,sv:-1},now),false);
  assert.equal(await subscriberSessionValid(pool,{...token,exp:now},now),false);
  await assert.rejects(()=>subscriberSessionValid(pool,token,now),/offline/);
});
