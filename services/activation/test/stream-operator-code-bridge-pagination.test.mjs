import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStreamDurationCodes,safeCodeRecord} from '../src/xtream-duration-codes.mjs';

test('operator code bridge accepts bounded 20-code pages and a 96KiB safe response',async()=>{
  const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  assert.match(code,/codes\?limit=20&offset=/);
  assert.match(code,/const MAX_BRIDGE_JSON_BYTES=96\*1024/);
  assert.match(code,/Buffer\.byteLength\(raw,'utf8'\)>MAX_BRIDGE_JSON_BYTES/);
  assert.match(code,/stream_authoritative_service_unavailable/);
  assert.match(code,/BLOFY_STREAM_OPERATOR_BRIDGE_FAILURE/);
  assert.doesNotMatch(code,/console\.warn\('BLOFY_STREAM_OPERATOR_BRIDGE_FAILURE',\s*error\)/);
  // A full code list may exceed the historic 16 KiB bridge limit.
  const rows=Array.from({length:30},(_,i)=>safeCodeRecord({
    id:'d9b0fcf1-0b7e-4209-b281-'+String(i).padStart(12,'0'),
    code_hint:'12••••78',code_channel:'app',label:'STREAM '.repeat(12),
    source_id:'d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a',
    duration_days:365,max_connections:10,redeemed_at:new Date(),
    created_at:new Date(),expires_at:new Date(Date.now()+86400000),
    account_id:'d2bb0397-1c56-4751-adc9-1a17758022f6',
    buyer_name:'عميل '.repeat(15),buyer_phone:'+966599999999',
    sale_price_halalas:7000,sold_at:new Date(),sales_channel:'manual',
    transfer_count:1,extended_days:30,code_vault:'SENSITIVE',
    password:'SENSITIVE'
  }));
  const json=JSON.stringify({ok:true,items:rows,totals:{total:30},nextOffset:20});
  assert.ok(Buffer.byteLength(json)>16384,
    'an ordinary 30-item commercial code listing exceeds historic 16 KiB limit');
  assert.ok(Buffer.byteLength(json)<96*1024,'sanitized 30-item list remains safely bounded');
  assert.doesNotMatch(json,/SENSITIVE|password|code_vault/);
});

test('operator lists 20 records per page without losing subsequent vouchers',async()=>{
 const rows=Array.from({length:45},(_,i)=>({
  id:'d9b0fcf1-0b7e-4209-b281-'+String(i).padStart(12,'0'),
  code_hint:'10••••'+String(i).padStart(2,'0'),label:'BLOFY STREAM',
  code_channel:'app',duration_days:30,max_connections:1,
  created_at:new Date(),expires_at:null,redeemed_at:null,revoked_at:null
 }));
 const pool={async query(sql,args=[]){
   if(sql.includes('ORDER BY created_at DESC LIMIT $1 OFFSET $2'))
      return {rows:rows.slice(args[1],args[1]+args[0])};
   if(sql.includes('COUNT(*) FILTER'))
      return {rows:[{total:45,unused:45,redeemed:0,revoked:0}]};
   throw Error('unexpected SQL');
 }};
 const svc=createStreamDurationCodes({pool,keyHex:'a'.repeat(64)});
 const a=await svc.list({limit:20,offset:0});
 assert.equal(a.items.length,20);
 assert.equal(a.nextOffset,20);
 const b=await svc.list({limit:20,offset:a.nextOffset});
 assert.equal(b.items.length,20);
 assert.equal(b.nextOffset,40);
 const c=await svc.list({limit:20,offset:b.nextOffset});
 assert.equal(c.items.length,5);
 assert.equal(c.nextOffset,null);
 assert.equal(new Set([...a.items,...b.items,...c.items].map(x=>x.id)).size,45);
});
