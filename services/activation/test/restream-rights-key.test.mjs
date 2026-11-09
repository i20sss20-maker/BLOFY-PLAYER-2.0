import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveRightsScopedStreamKey} from '../src/restream-rights-key.mjs';
const secret='safe-purpose-specific-secret-32bytes';
const base={sourceId:'source-1',channelId:'channel-3',
 rightsScope:'rights-licensed-1',sourceCredentialVersion:'cred-4',authorized:true};
test('same permitted stream/profile/rights reuses same opaque key',()=>{
 const a=deriveRightsScopedStreamKey(base,secret);
 assert.match(a,/^[a-f0-9]{64}$/);
 assert.equal(a,deriveRightsScopedStreamKey(base,secret));
});
test('different rights, source credentials or profile never share publisher',()=>{
 const a=deriveRightsScopedStreamKey(base,secret);
 for(const changed of [
  {...base,rightsScope:'rights-licensed-2'},
  {...base,sourceCredentialVersion:'cred-5'},
  {...base,outputProfile:'mpegts'},
  {...base,sourceId:'source-2'},
  {...base,channelId:'channel-4'}
 ])assert.notEqual(deriveRightsScopedStreamKey(changed,secret),a);
});
test('missing authorization or unsafe identities fail closed',()=>{
 assert.throws(()=>deriveRightsScopedStreamKey({...base,authorized:false},secret),/not_authorized/);
 assert.throws(()=>deriveRightsScopedStreamKey({...base,channelId:'../../secret'},secret),/invalid_identity/);
 assert.throws(()=>deriveRightsScopedStreamKey(base,'short'),/not_authorized/);
});
