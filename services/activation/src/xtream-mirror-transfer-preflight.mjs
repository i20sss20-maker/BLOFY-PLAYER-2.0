// Fail-closed, owner-only preflight for staged Xtream movie/episode copies.
// No worker, source mass-scan, S3 upload, public URL or customer cutover.
// A source-sized 4KiB Range proof is stored separately from the intake ledger.
import {createHash} from 'node:crypto';
import {probePrivateEpisodeRange} from './xtream-content-hub-episode-probe.mjs';
import {validateMirrorIntakeSelection} from './xtream-mirror-transfer-intake.mjs';
import {mirrorSourceValidatorHash} from './xtream-mirror-source-validator.mjs';

const MIN_BYTES=8*1024*1024,MAX_BYTES=4*1024**3;
const EXTS=new Set(['mp4','mkv','avi','ts']);
const EVIDENCE=/^[A-Za-z0-9_.:\/-]{8,160}$/;
const SNAPSHOT_MAX_AGE_MS=5*60*1000;
const schemaPromises=new WeakMap();
const NO_COPY={copyWorkerEnabled:false,mediaCopyStarted:false,
 mediaBytesTransferred:0,automaticDownload:false,customerCutover:false,
 privateOnly:true};

const safeBytes=x=>Number.isSafeInteger(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER;

// Only a trusted, server-side caller supplies approved source, item and
// decrypted credentials. An arbitrary browser URL is NEVER accepted.
export async function probeStagedMirrorSource({source,item,kind,credentials,
 fetchImpl=fetch,validateOrigin,signal}={}){
 const base={ok:false,probeBytes:0,providerMediaRequests:0,...NO_COPY};
 if(source?.name?.trim().toLowerCase()!=='saleh'||
    source.enabled!==true||source.publish_catalog!==true||
    source.deletion_requested_at||
    !['movie','episode'].includes(kind)||
    !EXTS.has(String(item?.extension||'').toLowerCase())||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(String(item?.mediaId||''))||
    !credentials?.username||!credentials?.password||
    typeof validateOrigin!=='function')
  return {...base,code:'mirror_preflight_source_unapproved'};
 let sourceUrl;
 try{
  const origin=new URL(String(source.base_url||''));
  if(!['https:','http:'].includes(origin.protocol)||
     origin.username||origin.password||origin.search||origin.hash)
   return {...base,code:'mirror_preflight_origin_invalid'};
  await validateOrigin(origin.origin);
  const segments=[kind==='movie'?'movie':'series',
    credentials.username,credentials.password,item.mediaId];
  const last=encodeURIComponent(String(segments[3]))+'.'+item.extension;
  const path=segments.slice(0,3).map(v=>encodeURIComponent(String(v)))
    .concat(last).join('/');
  sourceUrl=new URL(path,String(source.base_url).replace(/\/?$/,'/'));
  if(sourceUrl.origin!==origin.origin)
   return {...base,code:'mirror_preflight_origin_mismatch'};
 }catch{return {...base,code:'mirror_preflight_origin_invalid'}}
 try{
  // Hash the SAME 206 version evidence used by the copy worker.
  // Store only a digest. A weak ETag without Last-Modified is blocked.
  let validatorSha256=null;
  const upstream=await probePrivateEpisodeRange({
   url:sourceUrl.href,signal,
   fetchImpl:async(url,opts)=>{
    const response=await fetchImpl(url,{
     ...opts,redirect:'manual',method:'GET',
     signal:AbortSignal.any([opts.signal,AbortSignal.timeout(10000)])
    });
    if(response?.status===206)
     validatorSha256=mirrorSourceValidatorHash(response.headers);
    return response;
   }
  });
  if(upstream.ok!==true||upstream.probeBytes!==4096||
     !safeBytes(upstream.expectedBytes)||
     upstream.expectedBytes<MIN_BYTES||upstream.expectedBytes>MAX_BYTES)
   return {...base,code:'mirror_preflight_range_unverified',
    providerMediaRequests:upstream.providerMediaRequests||1};
  return {...base,ok:true,code:'mirror_preflight_size_verified',
   expectedBytes:upstream.expectedBytes,extension:item.extension,
   probeBytes:4096,providerMediaRequests:1,
   validatorPresent:upstream.validatorPresent===true&&
    /^[a-f0-9]{64}$/.test(String(validatorSha256||'')),
   validatorSha256,
   storageRightsVerified:false,capacityVerified:false};
 }catch{return {...base,code:'mirror_preflight_provider_unavailable',
  providerMediaRequests:1}}
}

// The "capacity" value is NOT an S3 free-space guess: it must come from an
// independent, fresh private bucket usage/budget check. If absent, no ready job.
export function assessMirrorPreflight({sourceId,kind,id,probe,
 licenseReference='',capacity=null,now=Date.now()}={}){
 const blockedBy=[];
 if(!validateMirrorIntakeSelection({sourceId,kind,id}))
  blockedBy.push('invalid_catalog_scope');
 if(probe?.ok!==true||probe.probeBytes!==4096||
    !Number.isSafeInteger(probe.expectedBytes)||
    probe.expectedBytes<MIN_BYTES||probe.expectedBytes>MAX_BYTES)
  blockedBy.push('exact_size_unverified');
 if(probe?.validatorPresent!==true||
    !/^[a-f0-9]{64}$/.test(String(probe?.validatorSha256||'')))
  blockedBy.push('source_version_validator_missing');
 if(!EVIDENCE.test(licenseReference))
  blockedBy.push('item_storage_license_evidence_missing');
 let availableBytes=null,neededBytes=null;
 if(probe&&Number.isSafeInteger(probe.expectedBytes)){
  neededBytes=probe.expectedBytes+
    Math.max(64*1024*1024,Math.ceil(probe.expectedBytes*0.05));
 }
 const fresh=capacity?.verifiedPrivateBucket===true&&
   capacity?.usageExact===true&&
   Number.isSafeInteger(capacity.observedAt)&&
   now>=capacity.observedAt&&now-capacity.observedAt<=SNAPSHOT_MAX_AGE_MS;
 if(!fresh||!safeBytes(capacity?.budgetBytes)||
    !safeBytes(capacity?.usedBytes)||!safeBytes(capacity?.reservedBytes)||
    capacity.budgetBytes===0)
  blockedBy.push('private_storage_capacity_unverified');
 else{
  availableBytes=capacity.budgetBytes-
    capacity.usedBytes-capacity.reservedBytes;
  if(!Number.isSafeInteger(availableBytes)||availableBytes<0||
     neededBytes===null||neededBytes>availableBytes)
   blockedBy.push('private_storage_budget_exceeded');
 }
 return {ok:blockedBy.length===0,code:blockedBy.length===0?
   'mirror_preflight_eligible_for_worker_review':
   'mirror_preflight_gates_incomplete',
  blockedBy,expectedBytes:Number.isSafeInteger(probe?.expectedBytes)?
   probe.expectedBytes:null,neededBytes,availableBytes,
  transferReady:false,workerReviewed:false,
  ...NO_COPY};
}

async function ensure(db){
 let promise=schemaPromises.get(db);
 if(!promise){
  promise=db.query([
   'CREATE TABLE IF NOT EXISTS blofy_stream_mirror_preflights (',
   'source_id UUID NOT NULL,',
   "media_kind TEXT NOT NULL CHECK(media_kind IN ('movie','episode')),",
   'catalog_id TEXT NOT NULL,expected_bytes BIGINT NOT NULL,',
   'validator_present BOOLEAN NOT NULL,validator_sha256 TEXT,',
   'rights_evidence_hash TEXT,',
   "state TEXT NOT NULL CHECK(state IN ('measured','eligible')),",
   'measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
   'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
   'PRIMARY KEY(source_id,media_kind,catalog_id),',
   'CHECK(expected_bytes BETWEEN 8388608 AND 4294967296)',
   ')'
  ].join(' ')).catch(error=>{schemaPromises.delete(db);throw error});
  schemaPromises.set(db,promise);
 }
 await promise;
 await db.query('ALTER TABLE blofy_stream_mirror_preflights ADD COLUMN IF NOT EXISTS validator_sha256 TEXT');
}

export async function recordMirrorPreflight(db,{sourceId,kind,id,probe,
 licenseReference='',capacity=null,ownerConfirmed=false,now=Date.now()}={}){
 if(ownerConfirmed!==true||!db?.query||!db?.connect||
    !validateMirrorIntakeSelection({sourceId,kind,id})||
    probe?.ok!==true||probe?.probeBytes!==4096||
    !Number.isSafeInteger(probe.expectedBytes)||
    probe.expectedBytes<MIN_BYTES||probe.expectedBytes>MAX_BYTES)
  return {ok:false,code:'mirror_preflight_input_invalid',...NO_COPY};
 await ensure(db);
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='1200ms'");
  await client.query("SET LOCAL statement_timeout='5000ms'");
  await client.query(
   "SELECT pg_advisory_xact_lock(hashtext('blofy_mirror_preflight'),hashtext($1))",
   [sourceId]);
  const stage=await client.query([
   'SELECT extension FROM blofy_stream_mirror_intents',
   'WHERE source_id=$1 AND media_kind=$2 AND catalog_id=$3',
   "AND state='awaiting_size_and_license' FOR UPDATE"
  ].join(' '),[sourceId,kind,id]);
  if(stage.rowCount!==1||
     stage.rows[0].extension!==probe.extension){
   await client.query('ROLLBACK');
   return {ok:false,code:'mirror_preflight_intake_changed',...NO_COPY};
  }
  const reserved=await client.query([
   'SELECT COALESCE(SUM(expected_bytes),0)::text AS total',
   'FROM blofy_stream_mirror_preflights',
   "WHERE state='eligible' AND NOT",
   '(source_id=$1 AND media_kind=$2 AND catalog_id=$3)'
  ].join(' '),[sourceId,kind,id]);
  const alreadyReserved=Number(reserved.rows?.[0]?.total||0);
  const checkedCapacity=capacity&&safeBytes(alreadyReserved)&&
   safeBytes(capacity.reservedBytes)?
   {...capacity,reservedBytes:capacity.reservedBytes+alreadyReserved}:null;
  const verdict=assessMirrorPreflight({sourceId,kind,id,probe,
   licenseReference,capacity:checkedCapacity,now});
  const state=verdict.ok?'eligible':'measured';
  const digest=EVIDENCE.test(licenseReference)?
   createHash('sha256').update(licenseReference,'utf8').digest('hex'):null;
  await client.query([
   'INSERT INTO blofy_stream_mirror_preflights',
   '(source_id,media_kind,catalog_id,expected_bytes,validator_present,',
   'validator_sha256,rights_evidence_hash,state)',
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   'ON CONFLICT(source_id,media_kind,catalog_id) DO UPDATE SET',
   'expected_bytes=EXCLUDED.expected_bytes,',
   'validator_present=EXCLUDED.validator_present,',
   'validator_sha256=EXCLUDED.validator_sha256,',
   'rights_evidence_hash=EXCLUDED.rights_evidence_hash,',
   'state=EXCLUDED.state,measured_at=NOW(),updated_at=NOW()'
  ].join(' '),[sourceId,kind,id,probe.expectedBytes,
    probe.validatorPresent===true,
    /^[a-f0-9]{64}$/.test(String(probe.validatorSha256||''))?
     probe.validatorSha256:null,digest,state]);
  await client.query('COMMIT');
  return {...verdict,ok:true,kind,id,state,
   eligibleForWorkerReview:verdict.ok,
   code:verdict.ok?'mirror_preflight_recorded_eligible':
     'mirror_preflight_size_recorded_blocked',
   sizeProbePerformed:true,providerMediaRequests:1,
   rightsEvidenceRecorded:Boolean(digest)};
 }catch{
  await client.query('ROLLBACK').catch(()=>{});
  return {ok:false,code:'mirror_preflight_database_unavailable',...NO_COPY};
 }finally{client.release()}
}
