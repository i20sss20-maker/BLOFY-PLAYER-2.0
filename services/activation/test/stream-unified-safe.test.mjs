import test from 'node:test';
import assert from 'node:assert/strict';
import {streamBridgeAuthorized,streamSafeSource,streamSafeCatalog,streamSafeAccount} from '../src/stream-unified-safe.mjs';

const token='one-authenticated-railway-stream-bridge-key-with-60-bytes-or-more';
test('bridge requires long exact bearer token',()=>{
  assert.equal(streamBridgeAuthorized('Bearer '+token,token),true);
  assert.equal(streamBridgeAuthorized('Bearer '+token+'a',token),false);
  assert.equal(streamBridgeAuthorized('Bearer '+'x'.repeat(50),token),false);
  assert.equal(streamBridgeAuthorized('Bearer '+token,'short'),false);
  assert.equal(streamBridgeAuthorized('Basic '+token,token),false);
});
test('source serialization cannot disclose password or token',()=>{
  const item=streamSafeSource({
    id:'11111111-1111-4111-8111-111111111111',name:'Source',
    enabled:true,publishCatalog:false,status:'online',
    baseUrl:'https://provider.example/secret',username:'private_user',
    password:'secret-password',passwordSecret:'encoded-secret',
    lastError:'upstream GET https://secret.example/path?password=hidden',
    counts:{live:120,movie:34,series:5}
  });
  const serialized=JSON.stringify(item);
  assert.equal(item.counts.live,120);
  for(const forbidden of ['provider.example','private_user','secret-password',
    'encoded-secret','secret.example','password=hidden'])assert.equal(serialized.includes(forbidden),false);
});
test('catalog serialization has no media URLs or sensitive metadata',()=>{
  const item=streamSafeCatalog({serverId:'a',id:'12',name:'Channel',
    type:'live',categoryName:'News',enabled:true,
    metadata:{url:'https://private.example/',password:'secret'},
    iconUrl:'http://secret.example/?p=secret'
  });
  assert.equal(item.name,'Channel');
  assert.equal(JSON.stringify(item).includes('secret'),false);
});
test('gateway account serialization omits credential proof',()=>{
  const item=streamSafeAccount({id:'a',label:'client',username:'user',
    password_proof:'secret',enabled:true,max_connections:2});
  assert.equal(item.maxConnections,2);
  assert.equal(JSON.stringify(item).includes('secret'),false);
});
