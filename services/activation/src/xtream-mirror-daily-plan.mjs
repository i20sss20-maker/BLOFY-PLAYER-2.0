// Daily owner-only licensed-VOD readiness plan, NOT a media downloader.
// Reads the existing 04:00 Riyadh Xtream catalog receipt and staged items;
// never infers permanent-copy rights from an Xtream account or copies files.
import {riyadhCatalogDay} from './xtream-daily-approved-catalog.mjs';
import {validateMirrorIntakeSelection} from './xtream-mirror-transfer-intake.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEMS=24,MAX_BYTES=4*1024**3,MIN_BYTES=8*1024**2;
const STALE_MS=30*60*1000;
const base={privateOnly:true,readOnly:true,automaticDownload:false,
 mediaCopyStarted:false,mediaBytesTransferred:0,providerRequests:0,
 customerCutover:false,copyWorkerEnabled:false};

function publicItem(row,{now,catalogReady}){
 const kind=String(row.media_kind||''),id=String(row.catalog_id||'');
 const measured=Number(new Date(row.measured_at||0).getTime());
 const bytes=Number(row.expected_bytes);
 const codes=[];
 if(row.state!=='awaiting_size_and_license')
  codes.push('mirror_intake_not_active');
 if(row.preflight_state!=='eligible')
  codes.push(row.preflight_state==='measured'?
   'preflight_budget_or_rights_blocked':'preflight_missing');
 if(!Number.isFinite(measured)||measured<=0||measured>now||
    now-measured>STALE_MS)
  codes.push('preflight_expired');
 if(row.validator_present!==true)
  codes.push('source_validator_not_proven');
 if(!/^[a-f0-9]{64}$/.test(String(row.rights_evidence_hash||'')))
  codes.push('owner_rights_evidence_not_recorded');
 if(!Number.isSafeInteger(bytes)||bytes<MIN_BYTES||bytes>MAX_BYTES)
  codes.push('source_size_not_verified');
 if(!catalogReady)codes.push('daily_catalog_not_confirmed');
 return {kind,id,title:String(row.title||'').slice(0,190),
  extension:String(row.extension||'').slice(0,12),
  state:codes.length===0?'eligible_for_owner_review':'blocked',
  blockedBy:codes,
  expectedBytes:Number.isSafeInteger(bytes)&&bytes>=MIN_BYTES?
   bytes:null,
  ownerRightsEvidenceRecorded:/^[a-f0-9]{64}$/.test(
   String(row.rights_evidence_hash||'')),
  independentRightsVerification:false,
  autoTransferAuthorized:false,
  transferReady:false,sourceContacted:false};
}

export async function inspectDailyMirrorPlan(db,{
 env={},now=new Date(),sourceId,limit=MAX_ITEMS
}={}){
 if(env.BLOFY_STREAM_MIRROR_DAILY_PLAN_ENABLED!=='1')
  return {ok:false,code:'daily_mirror_plan_disabled',...base};
 if(!UUID.test(String(sourceId||''))||typeof db?.query!=='function'||
    !Number.isSafeInteger(limit)||limit<1||limit>MAX_ITEMS)
  return {ok:false,code:'daily_mirror_plan_input_invalid',...base};
 const day=riyadhCatalogDay(now),millis=new Date(now).getTime();
 if(!day||!Number.isFinite(millis))
  return {ok:false,code:'daily_mirror_plan_clock_invalid',...base};
 try{
  const source=await db.query([
   'SELECT id FROM blofy_xtream_servers',
   "WHERE id=$1 AND lower(btrim(name))='saleh'",
   'AND enabled=TRUE AND publish_catalog=TRUE',
   'AND deletion_requested_at IS NULL LIMIT 2'
  ].join(' '),[sourceId]);
  if(source.rows?.length!==1)
   return {ok:false,code:'daily_mirror_plan_source_not_approved',...base};
  // A partial/failed catalog sync CANNOT authorize unattended media copies.
  const receipt=await db.query([
   'SELECT state,finished_at FROM blofy_xtream_daily_catalog_requests',
   'WHERE source_id=$1 AND local_day=$2::date LIMIT 1'
  ].join(' '),[sourceId,day.day]).catch(e=>{
   if(e?.code==='42P01')return {rows:[]};
   throw e;
  });
  const latest=receipt.rows?.[0];
  const catalogReady=latest?.state==='completed'&&Boolean(latest.finished_at);
  const result=await db.query([
   'SELECT i.media_kind,i.catalog_id,i.title,i.extension,i.state,',
   'p.state AS preflight_state,p.expected_bytes,p.measured_at,',
   'p.validator_present,p.rights_evidence_hash',
   'FROM blofy_stream_mirror_intents i',
   'LEFT JOIN blofy_stream_mirror_preflights p',
   'ON p.source_id=i.source_id AND p.media_kind=i.media_kind',
   'AND p.catalog_id=i.catalog_id',
   "WHERE i.source_id=$1 AND i.state='awaiting_size_and_license'",
   'ORDER BY i.updated_at DESC LIMIT $2'
  ].join(' '),[sourceId,limit]).catch(e=>{
   if(e?.code==='42P01')return {rows:[]};
   throw e;
  });
  const items=(result.rows||[]).filter(r=>
   validateMirrorIntakeSelection({sourceId,
    kind:r.media_kind,id:r.catalog_id})).map(r=>publicItem(r,{
      now:millis,catalogReady}));
  const eligible=items.filter(x=>x.state==='eligible_for_owner_review').length;
  const blocked=items.length-eligible;
  const totalBytes=items.filter(x=>x.state==='eligible_for_owner_review')
   .reduce((s,x)=>s+x.expectedBytes,0);
  return {ok:true,code:'daily_mirror_plan_read_only',
   ...base,day:day.day,sourceName:'saleh',
   catalogSync:catalogReady?'completed':
    String(latest?.state||'not_completed'),
   catalogConfirmed:catalogReady,
   items,pending:items.length,eligibleForOwnerReview:eligible,blocked,
   eligibleBytes:Number.isSafeInteger(totalBytes)?totalBytes:null,
   sourceStorageRightsNotInferred:true,
   sessionStartsAutomatically:false,automaticBytesScheduled:0,
   nextStep:'owner_confirm_per_item_and_start_bounded_private_worker'};
 }catch{return {ok:false,code:'daily_mirror_plan_database_unavailable',...base}}
}
