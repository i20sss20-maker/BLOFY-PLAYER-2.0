// REAL PostgreSQL transactions on a GitHub Actions container only.
// Never connect to, mutate, or introspect production customer data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {createStreamDurationCodes,ensureStreamCodeTable}
 from '../src/xtream-duration-codes.mjs';
import {ensureStreamCommercialSchema}
 from '../src/xtream-code-commercial.mjs';
import {createStreamDistributors}
 from '../src/stream-distributors.mjs';
import {readOwnerAdminStoreReadiness}
 from '../src/stream-owner-admin-readiness.mjs';

const dbName='blofy_stream_owner_lifecycle_qa';
const raw=process.env.DATABASE_URL||'';
let db;
try{db=new URL(raw)}catch{throw Error('refusing_non_ephemeral_database')}
if(process.env.BLOFY_STREAM_EPHEMERAL_DB_QA!=='true'||
   process.env.CI!=='true'||
   db.protocol!=='postgresql:'||
   !['127.0.0.1','localhost'].includes(db.hostname)||
   db.port!=='5432'||db.pathname!=='/'+dbName||
   db.username!=='postgres'||db.password!=='postgres'||
   db.search||db.hash)
 throw Error('refusing_non_ephemeral_database');
const pool=new pg.Pool({connectionString:raw,ssl:false,max:4});
const keyHex='9'.repeat(64),sourceId=crypto.randomUUID();
const clock=()=>Date.now();
const DAY=86400000;
try{
 // Deliberately minimal synthetic source/account scaffolding in the CI-only
 // PostgreSQL instance. No source URL, Xtream credentials or real host.
 await pool.query(`CREATE TABLE blofy_xtream_servers(
  id UUID PRIMARY KEY,name TEXT NOT NULL,enabled BOOLEAN NOT NULL,
  publish_catalog BOOLEAN NOT NULL,deletion_requested_at TIMESTAMPTZ)`);
 await pool.query(`INSERT INTO blofy_xtream_servers
  (id,name,enabled,publish_catalog) VALUES ($1,'saleh',TRUE,TRUE)`,[sourceId]);
 await pool.query(`CREATE TABLE blofy_xtream_gateway_accounts(
  id UUID PRIMARY KEY,label TEXT NOT NULL,username TEXT NOT NULL UNIQUE,
  password_proof TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_connections INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
  source_id UUID,credential_vault TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await ensureStreamCodeTable(pool);
 await ensureStreamCommercialSchema(pool);

 const codes=createStreamDurationCodes({
  pool,keyHex,clock,salehOnlyNewCodes:true
 });
 const distributors=createStreamDistributors({
  pool,clock,trialKeyHex:'a'.repeat(64),listCatalog:async()=>[],
  issueCode:async data=>({status:201,body:await codes.issue(data)}),
  issueXtream:async()=>({status:503,body:{ok:false}}),
  revealCode:async id=>({status:200,body:await codes.reveal(id)}),
  revealXtream:async()=>({status:503,body:{ok:false}})
 });
 await distributors.ensureSchema();

 // The same read-only endpoint used by the production operator now proves
 // actual PostgreSQL table/query permissions without enumerating customers.
 const ready=await readOwnerAdminStoreReadiness({pool});
 assert.equal(ready.ok,true);
 assert.deepEqual(ready.stores.map(x=>x.state),['readable','readable']);
 assert.equal(ready.customerWrites,0);
 assert.equal(ready.codeIssuanceTested,false);

 // Owner creates one fictional distributor. Password remains in memory.
 const created=await distributors.createAdmin({
  name:'CI isolated distributor',username:'ci_owner_reseller',credits:3
 });
 assert.equal(created.item.credits,3);
 const login=await distributors.login({
  username:'ci_owner_reseller',password:created.password
 });
 assert.equal(login.ok,true);
 assert.equal(login.item.credits,3);

 // 30-day APP voucher: one credit, one issued row, never an account at issue.
 const requestId=crypto.randomUUID();
 const minted=await distributors.issue(login.token,{
  kind:'app',durationDays:30,label:'CI Synthetic BLOFY STREAM',
  requestId,customerName:'Synthetic only'
 });
 assert.equal(minted.ok,true);
 assert.match(minted.code,/^[0-9]{8,12}$/);
 const issueId=minted.issue.id;
 const beforeActivation=await pool.query(
  'SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_accounts');
 assert.equal(beforeActivation.rows[0].n,0);
 let reseller=(await distributors.listAdmin()).items[0];
 assert.equal(reseller.credits,2);
 assert.equal(reseller.used,1);

 // Repeated HTTP request-id returns the SAME voucher and no duplicate charge.
 const again=await distributors.issue(login.token,{
  kind:'app',durationDays:30,label:'CI Synthetic BLOFY STREAM',
  requestId,customerName:'Synthetic only'
 });
 assert.equal(again.ok,true);
 assert.equal(again.code,minted.code);
 reseller=(await distributors.listAdmin()).items[0];
 assert.equal(reseller.credits,2);
 assert.equal(reseller.used,1);

 const deviceKey='b'.repeat(64);
 const activated=await codes.redeem(minted.code,'https://blofyplayer.com',{
  appOnly:true,deviceKey
 });
 assert.equal(activated.ok,true);
 assert.equal(activated.recovered,false);
 const initialExpires=activated.account.expiresAt;
 assert.ok(initialExpires>clock()+29*DAY);
 const retry=await codes.redeem(minted.code,'https://blofyplayer.com',{
  appOnly:true,deviceKey
 });
 assert.equal(retry.recovered,true);
 assert.equal(retry.account.id,activated.account.id);
 assert.equal(retry.account.expiresAt,initialExpires);
 await assert.rejects(
  codes.redeem(minted.code,'https://blofyplayer.com',{
    appOnly:true,deviceKey:'c'.repeat(64)}),
  /stream_code_unavailable/
 );

 // Reseller 30-day renewal: a SECOND credit, extends the existing
 // subscription exactly once, and produces an idempotent audit receipt.
 const renewalId=crypto.randomUUID();
 const renewed=await distributors.renew(login.token,{
  issueId,days:30,requestId:renewalId
 });
 assert.equal(renewed.ok,true);
 assert.equal(renewed.chargedCredits,1);
 assert.ok(renewed.expiresAt>initialExpires+29*DAY);
 const renewedAgain=await distributors.renew(login.token,{
  issueId,days:30,requestId:renewalId
 });
 assert.equal(renewedAgain.expiresAt,renewed.expiresAt);
 const accountNow=await pool.query(
  'SELECT COUNT(*)::int AS n, MAX(expires_at) AS expiry FROM blofy_xtream_gateway_accounts');
 assert.equal(accountNow.rows[0].n,1);
 assert.equal(new Date(accountNow.rows[0].expiry).getTime(),renewed.expiresAt);
 reseller=(await distributors.listAdmin()).items[0];
 assert.equal(reseller.credits,1);
 assert.equal(reseller.used,1);
 const creditEvents=await pool.query(`SELECT type,delta,balance_after
  FROM blofy_stream_distributor_credit_events
  WHERE distributor_id=$1 ORDER BY created_at,id`,[created.item.id]);
 const byType=Object.fromEntries(creditEvents.rows.map(x=>[x.type,x]));
 assert.equal(byType.opening.delta,3);
 assert.equal(byType.issue.delta,-1);
 assert.equal(byType.renew.delta,-1);
 assert.equal(creditEvents.rows.length,3);
 const actions=await pool.query(`SELECT COUNT(*)::int AS n
  FROM blofy_stream_distributor_actions
  WHERE distributor_id=$1 AND action='renew'`,[created.item.id]);
 assert.equal(actions.rows[0].n,1);

 // Revoking an unused unrelated synthetic voucher refuses redemption, and
 // redemption/renewal never silently creates a second subscriber.
 const unused=await codes.issue({
  durationDays:7,quantity:1,channel:'app',sourceId,label:'CI Revoke'
 });
 await codes.revoke(unused.items[0].id);
 await assert.rejects(
  codes.redeem(unused.items[0].code,'https://blofyplayer.com',{
   appOnly:true,deviceKey}),
  /stream_code_unavailable/
 );
 assert.equal((await pool.query(
  'SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_accounts')).rows[0].n,1);

 // No bearer, password, M3U URL, phone or sensitive code is printed to logs.
 console.info('BLOFY_STREAM_EPHEMERAL_POSTGRES',{
  ok:true,kind:'isolated_synthetic_real_transactions',
  codeIssuance:true,codeRedemption:true,deviceIsolation:true,
  codeRevocation:true,resellerLogin:true,resellerIdempotence:true,
  resellerRenewal:true,creditLedger:true,codeSecretPrinted:false,
  productionCustomerWrites:0,productionDatabaseContacted:false,
  providerMediaRequests:0
 });
}finally{await pool.end()}
