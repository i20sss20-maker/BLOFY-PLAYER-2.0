// PostgreSQL integration smoke for explicit admin STREAM voucher recovery.
// This script runs ONLY in CI's ephemeral database, never on a live source.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  createStreamDurationCodes,ensureStreamCodeTable,streamCodeProof
} from '../src/xtream-duration-codes.mjs';
import {createStreamCommercial,ensureStreamCommercialSchema} from '../src/xtream-code-commercial.mjs';
import {encryptGatewayAccountPassword} from '../src/xtream-account-vault.mjs';
import {encryptStreamCode} from '../src/xtream-code-vault.mjs';

if(!process.env.BLOFY_STREAM_EPHEMERAL_DB_QA||!process.env.DATABASE_URL||
  !/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL))
  throw Error('refusing_non_ephemeral_database');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const keyHex='8'.repeat(64);
const days=86400000;
const original='12344321';
const codeId=crypto.randomUUID(),accountId=crypto.randomUUID();
const now=Date.now(),began=new Date(now-4*days),expires=new Date(now+26*days);
try{
  await pool.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_accounts(
    id UUID PRIMARY KEY,username TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ NOT NULL,credential_vault TEXT,updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await ensureStreamCodeTable(pool);
  await ensureStreamCommercialSchema(pool);
  await pool.query(`INSERT INTO blofy_xtream_gateway_accounts
    (id,username,enabled,expires_at,credential_vault) VALUES($1,$2,TRUE,$3,$4)`,[
    accountId,'ci_xtream_2026',expires,encryptGatewayAccountPassword(accountId,'ciPassword_2026',keyHex)
  ]);
  await pool.query(`INSERT INTO blofy_xtream_gateway_duration_codes
    (id,code_hash,code_hint,code_channel,label,duration_days,max_connections,
      account_id,redeemed_at,expires_at,code_vault)
    VALUES($1,$2,$3,'xtream','BLOFY STREAM',30,1,$4,$5,$6,$7)`,[
    codeId,streamCodeProof(original,keyHex),'12••••21',accountId,began,expires,
    encryptStreamCode(codeId,original,keyHex)
  ]);
  const codes=createStreamDurationCodes({pool,keyHex});
  const commercial=createStreamCommercial({pool,keyHex});
  const lookup=await codes.lookup(original);
  assert.equal(lookup.subscription.active,true);
  assert.equal(lookup.item.status,'redeemed');
  const extended=await commercial.extend(codeId,{days:30});
  assert.equal(extended.item.extendedDays,30);
  const afterExtend=await codes.lookup(original);
  assert.equal(afterExtend.subscription.active,true);
  assert.ok(afterExtend.subscription.expiresAt>expires.getTime()+29*days);
  const replacement=await commercial.reissueXtreamForRecovery(codeId);
  assert.equal(replacement.ok,true);
  assert.equal(replacement.subscriptionUnchanged,true);
  assert.notEqual(replacement.code,original);
  await assert.rejects(codes.redeem(original,'https://blofyplayer.com'),/stream_code_unavailable/);
  const response=await codes.redeem(replacement.code,'https://blofyplayer.com');
  assert.equal(response.ok,true);
  assert.equal(response.recovered,true);
  assert.equal(response.credentials.username,'ci_xtream_2026');
  assert.equal(response.credentials.password,'ciPassword_2026');
  assert.equal(response.account.activatedAt,began.getTime());
  assert.equal(response.account.expiresAt,afterExtend.subscription.expiresAt);
  await assert.rejects(codes.redeem(replacement.code,'https://blofyplayer.com'),/stream_code_unavailable/);
  const accounts=await pool.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_accounts');
  assert.equal(accounts.rows[0].n,1,'recovery cannot create a second account');
  const events=await pool.query(`SELECT event_type FROM blofy_xtream_gateway_code_events
    WHERE code_id=$1 ORDER BY occurred_at`,[codeId]);
  assert.ok(events.rows.some(row=>row.event_type==='extended'));
  assert.ok(events.rows.some(row=>row.event_type==='xtream_single_use_recovery_issued'));
  console.log('BLOFY STREAM PostgreSQL QA PASSED: lookup, renew, one-time recovery and old-code invalidation');
}finally{
  await pool.end();
}
