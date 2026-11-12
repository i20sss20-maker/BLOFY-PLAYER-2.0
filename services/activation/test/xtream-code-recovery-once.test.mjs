import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStreamDurationCodes,streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {createStreamCommercial} from '../src/xtream-code-commercial.mjs';
import {encryptGatewayAccountPassword} from '../src/xtream-account-vault.mjs';

const keyHex='c'.repeat(64);
const voucher='24681357';
const id='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const accountId='d2bb0397-1c56-4751-adc9-1a17758022f6';
const now=Date.parse('2026-11-12T02:00:00Z');
const DAY=86400000;
function mock(){
  const code={id,code_hash:streamCodeProof(voucher,keyHex),code_hint:'24••••57',
    code_channel:'xtream',redeemed_at:new Date(now-7*DAY),
    account_id:accountId,expires_at:new Date(now+23*DAY),
    source_id:null,label:'BLOFY STREAM',duration_days:30,max_connections:1,
    revoked_at:null,transfer_count:0,extended_days:0,xtream_recovery_until:null};
  const account={id:accountId,enabled:true,username:'subscriber01',
    credential_vault:encryptGatewayAccountPassword(accountId,'password01',keyHex),
    expires_at:new Date(now+23*DAY)};
  const queries=[],events=[],state={created:0,time:now};
  async function query(sql,args=[]){
    queries.push({sql,args});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
    if(sql.includes('COUNT(*)::int AS count FROM blofy_xtream_gateway_duration_codes'))
      return {rows:[{count:1}]};
    if(sql.includes('FROM blofy_xtream_gateway_duration_codes')&&sql.includes('FOR UPDATE')){
      const candidate=sql.includes('WHERE id=$1')?code.id:code.code_hash;
      return {rows:args[0]===candidate?[code]:[]};
    }
    if(sql.includes('FROM blofy_xtream_gateway_accounts')&&sql.includes('FOR UPDATE'))
      return {rows:args[0]===account.id?[account]:[]};
    if(sql.includes('SELECT 1 FROM blofy_xtream_gateway_duration_codes'))
      return {rows:args[0]===code.code_hash?[{}]:[]};
    if(sql.includes('SET code_hash=$2,code_hint=$3,code_vault=$4')){
      code.code_hash=args[1];code.code_hint=args[2];
      code.code_vault=args[3];code.xtream_recovery_until=args[4];
      code.transfer_count++;return {rows:[code],rowCount:1};
    }
    if(sql.includes('SET xtream_recovery_until=NULL')){
      if(!code.xtream_recovery_until||new Date(code.xtream_recovery_until).getTime()<=state.time)
        return {rows:[],rowCount:0};
      code.xtream_recovery_until=null;return {rows:[{id:code.id}],rowCount:1};
    }
    if(sql.includes('INSERT INTO blofy_xtream_gateway_code_events')){
      events.push(args);return {rows:[],rowCount:1};
    }
    if(sql.includes('INSERT INTO blofy_xtream_gateway_accounts')){
      state.created++;return {rows:[]};
    }
    throw Error('unexpected test SQL: '+sql.slice(0,110));
  }
  const pool={query,async connect(){return {query,release(){}}}};
  const commercial=createStreamCommercial({pool,keyHex,clock:()=>state.time,
    randomBytes:n=>Buffer.alloc(n,41)});
  const duration=createStreamDurationCodes({pool,keyHex,clock:()=>state.time});
  return {code,account,commercial,duration,queries,events,state};
}
test('operator can reissue an unguessable one-time code for existing active Xtream subscription',async()=>{
 const db=mock(),initialExpiry=db.code.expires_at.getTime();
 const initialActivation=db.code.redeemed_at.getTime();
 const recovered=await db.commercial.reissueXtreamForRecovery(id);
 assert.equal(recovered.ok,true);
 assert.match(recovered.code,/^[0-9]{8}$/);
 assert.notEqual(recovered.code,voucher);
 assert.equal(recovered.subscriptionUnchanged,true);
 assert.equal(recovered.expiresAt,initialExpiry);
 assert.equal(db.code.expires_at.getTime(),initialExpiry);
 assert.equal(db.code.redeemed_at.getTime(),initialActivation);
 assert.equal(db.code.transfer_count,1);
 assert.equal(db.events[0][2],'xtream_single_use_recovery_issued');
 assert.ok(recovered.recoverBefore>now);
 await assert.rejects(db.duration.redeem(voucher,'https://blofyplayer.com'),/stream_code_unavailable/);
 const login=await db.duration.redeem(recovered.code,'https://blofyplayer.com');
 assert.equal(login.ok,true);
 assert.equal(login.recovered,true);
 assert.equal(login.credentials.username,'subscriber01');
 assert.equal(login.credentials.password,'password01');
 assert.equal(login.account.expiresAt,initialExpiry);
 assert.equal(login.account.activatedAt,initialActivation);
 assert.equal(db.state.created,0,'does not create or bill a second subscription');
 assert.equal(db.code.xtream_recovery_until,null,'one-time recovery consumed');
 await assert.rejects(db.duration.redeem(recovered.code,'https://blofyplayer.com'),/stream_code_unavailable/);
});
test('revoked, expired, disabled, app-channel and missing-vault accounts are never reissued',async()=>{
 const bad=[
  f=>{f.code.revoked_at=new Date(now);},
  f=>{f.code.expires_at=new Date(now-1);},
  f=>{f.account.enabled=false;},
  f=>{f.account.credential_vault=null;},
  f=>{f.code.code_channel='app';},
  f=>{f.account.expires_at=new Date(now-1);}
 ];
 for(const mutate of bad){
  const db=mock();mutate(db);
  await assert.rejects(db.commercial.reissueXtreamForRecovery(id),/stream_xtream_recovery_unavailable/);
  assert.equal(db.events.length,0);
 }
});
test('operator recovery expiration blocks replay but leaves subscription unchanged',async()=>{
 const db=mock(),initialExpiry=db.code.expires_at.getTime();
 const recovery=await db.commercial.reissueXtreamForRecovery(id);
 db.state.time=now+25*60*60*1000;
 await assert.rejects(db.duration.redeem(recovery.code,'https://blofyplayer.com'),/stream_code_unavailable/);
 assert.equal(db.code.expires_at.getTime(),initialExpiry);
 assert.ok(db.code.xtream_recovery_until,'expiration is retained for audit');
});
test('admin route is guarded and is not available to public redeem calls',async()=>{
 const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(src,/recover-xtream/);
 assert.match(src,/streamCommercial\.reissueXtreamForRecovery\(id\)/);
 const guard=src.indexOf('if (!requireAdmin(req, res)) return;');
 const action=src.indexOf("if(kind==='recover-xtream')");
 assert.ok(guard>0&&action>guard);
 const ui=await readFile(new URL('../web/xtream-gateway-admin.js',import.meta.url),'utf8');
 assert.match(ui,/recover-xtream/);
 assert.match(ui,/مرة واحدة خلال 24 ساعة/);
});
