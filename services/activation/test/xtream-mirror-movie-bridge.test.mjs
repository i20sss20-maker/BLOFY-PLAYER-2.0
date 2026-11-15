import test from 'node:test';
import assert from 'node:assert/strict';
import {findActiveMirrorMovie} from '../src/xtream-mirror-movie-bridge.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const row={source_id:ID,media_id:'film_18',gateway_id:18,
 extension:'mp4',expected_bytes:'16777216',
 copy_run_id:'mirror_'+'a'.repeat(40)};

test('a leased movie needs rights, current source, exact mapped gateway and size',async()=>{
 const calls=[];
 const pool={query:async(sql,params)=>{calls.push({sql,params});
  return {rows:[row]}}};
 const a=await findActiveMirrorMovie(pool,{gatewayId:18});
 assert.deepEqual(a,{sourceId:ID,mediaId:'film_18',gatewayId:18,
  extension:'mp4',expectedBytes:16777216,copyRunId:row.copy_run_id});
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,[18]);
 for(const term of ["q.state='copying'","q.copy_lease_until>NOW()",
 "q.mapping_conflict=FALSE","q.rights_ref_sha256",
 "q.size_probe_at>NOW()","m.source_id=q.media_id",
 "s.last_sync_at>NOW()","q.expected_bytes BETWEEN"]){
  assert.ok(calls[0].sql.includes(term),term);
 }
});

test('no leased active row or excessive size cannot open private media bridge',async()=>{
 assert.equal(await findActiveMirrorMovie({query:async()=>({rows:[]})},{
  gatewayId:18}),null);
 assert.equal(await findActiveMirrorMovie({query:async()=>({rows:[{
  ...row,expected_bytes:'99999999999'}]})},{gatewayId:18}),null);
 assert.equal(await findActiveMirrorMovie({query:async()=>{
  throw Error('should_not_query')
 }},{gatewayId:0}),null);
});
