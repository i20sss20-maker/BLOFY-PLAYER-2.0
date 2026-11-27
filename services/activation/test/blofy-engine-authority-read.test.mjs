import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signAuthorityRead,verifyAuthorityRead,createAuthorityReadEndpoint} from '../src/blofy-engine-authority-read.mjs';
test('read-only authority request requires pinned fresh exact signature',()=>{
 const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519'),now=Date.now();
 const e=signAuthorityRead(a.privateKey,now);
 assert.equal(verifyAuthorityRead(e,a.publicKey,now),true);
 assert.equal(verifyAuthorityRead(e,b.publicKey,now),false);
 assert.equal(verifyAuthorityRead(e,a.publicKey,now+10001),false);
 assert.equal(verifyAuthorityRead({...e,ts:now+1},a.publicKey,now),false);
 assert.equal(verifyAuthorityRead({...e,operation:'start'},a.publicKey,now),false);
});
test('disabled route never accesses production state',async()=>{
 const a=generateKeyPairSync('ed25519');
 const handler=createAuthorityReadEndpoint({connect(){throw Error('unexpected access')}},{env:{},key:a.publicKey});
 let code,body;
 await handler({method:'POST'},{writeHead(c){code=c},end(s){body=JSON.parse(s)}});
 assert.equal(code,503);assert.deepEqual(body,{ok:false});
});
