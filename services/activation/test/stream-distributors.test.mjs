import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStreamDistributors,distributorPlanCost} from '../src/stream-distributors.mjs';

function fixture(){
 const distributors=[],sessions=[],issues=[],calls=[],statements=[],actions=[],creditEvents=[];
 const accounts=[],codes=[],events=[];
 const now=new Date('2026-11-12T04:00:00Z');
 const accountId=crypto.randomUUID(),codeId=crypto.randomUUID();
 const salehId='9adc6472-5d4e-4359-83e4-0298cc038ae3';
 let sourceReady=true;
 const catalogRecords=[{id:'42',type:'movie',name:'Original Film',categoryName:'Movies',enabled:true}];
 const libraryRows=[];
 const issuedToken='59374629',credential={serverUrl:'https://blofyplayer.com',
   username:'reseller_generated',password:'protected-password',m3uUrl:'https://blofyplayer.com/get.php'};
 let failCode=false;
 accounts.push({id:accountId,source_id:salehId,enabled:true,
   expires_at:new Date(now.getTime()+30*86400000)});
 codes.push({id:codeId,code_channel:'app',account_id:accountId,
   redeemed_at:new Date(now),expires_at:new Date(now.getTime()+30*86400000),
   redeemed_device_hash:'a'.repeat(64),revoked_at:null,
   code_hint:'59••••29',admin_relogin_count:0});
 async function query(sql,args=[]){
  statements.push(sql);
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||/^\s*(CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ALTER TABLE)/.test(sql))
   return {rows:[]};
  if(sql.includes('INSERT INTO blofy_stream_distributors')){
   const row={id:args[0],display_name:args[1],username:args[2],
     password_hash:args[3],credits:args[4],issued_count:0,
     enabled:true,daily_issue_limit:100,created_at:now};
   distributors.push(row);return {rows:[row]};
  }

  if(sql.includes('INSERT INTO blofy_stream_distributor_credit_events')){
   const type=(sql.match(/'(opening|adjustment|issue|refund|renew)'/)||[])[1];
   if(!type)throw Error('Credit event missing type: '+sql);
   const issueId=['opening','adjustment'].includes(type)?null:args[2];
   const delta=type==='opening'?args[2]:type==='adjustment'?args[2]:args[3];
   const balance=type==='opening'?args[2]:type==='adjustment'?args[3]:args[4];
   creditEvents.push({id:args[0],distributor_id:args[1],issue_id:issueId,
    type,delta,balance_after:balance,details:{},created_at:now});
   return {rows:[]};
  }
  if(sql.includes('FROM blofy_stream_distributor_credit_events')&&sql.includes('ORDER BY')){
   const credits=creditEvents.filter(x=>x.distributor_id===args[0]);
   const relogins=actions.filter(x=>x.distributor_id===args[0]&&x.action==='relogin')
    .map(x=>({...x,type:'relogin',delta:0,balance_after:null,
      issue_id:x.issue_id,details:x.result||{},created_at:now}));
   return {rows:credits.concat(relogins).reverse()};
  }
  if(sql.includes('SET daily_issue_limit=$2')){
   const row=distributors.find(x=>x.id===args[0]);
   if(!row)return {rows:[]};row.daily_issue_limit=args[1];return {rows:[row]};
  }
  if(sql.includes('FROM blofy_stream_distributor_issues')&&
    sql.includes("INTERVAL '24 hours'")&&
    sql.includes("status IN ('pending','done','review')")){
   return {rows:[{count:issues.filter(x=>x.distributor_id===args[0]&&
     ['pending','done','review'].includes(x.status)).length}]};
  }
  if(sql.includes('AS sold_count')&&sql.includes('FROM blofy_stream_distributor_issues')){
   const rows=issues.filter(x=>x.distributor_id===args[0]&&x.status==='done');
   const first=rows[0];
   return {rows:first?[{duration_days:first.duration_days,sold_count:rows.length}]:[]};
  }
  if(sql.includes('AS trials_today')&&sql.includes('FROM blofy_stream_distributor_issues')){
   const items=issues.filter(x=>x.distributor_id===args[0]);
   return {rows:[{today:items.filter(x=>x.status==='done').length,
     month:items.filter(x=>x.status==='done').length,
     trials_today:items.filter(x=>x.duration_days===1&&x.status==='done').length,
     trials_total:items.filter(x=>x.duration_days===1&&x.status==='done').length,
     paid_total:items.filter(x=>x.duration_days>1&&x.status==='done').length,
     spent_month:items.filter(x=>x.status==='done').reduce((sum,x)=>sum+x.credit_cost,0),
     under_review:items.filter(x=>['pending','review'].includes(x.status)).length}]};
  }
  if(sql.includes("action='renew'")&&sql.includes('SUM(credit_cost)')){
   const items=actions.filter(x=>x.distributor_id===args[0]&&x.action==='renew');
   return {rows:[{renewals:items.length,credits:items.reduce((n,x)=>n+(x.credit_cost||0),0)}]};
  }
  if(sql.includes('COUNT(DISTINCT i.id)')&&sql.includes('JOIN blofy_stream_distributor_actions')){
   const ids=new Set(actions.filter(x=>x.distributor_id===args[0]&&x.action==='renew')
      .map(x=>x.issue_id));
   return {rows:[{converted:issues.filter(x=>x.distributor_id===args[0]&&
      x.duration_days===1&&ids.has(x.id)).length}]};
  }
  if(sql.includes('LEFT JOIN blofy_xtream_gateway_duration_codes')&&sql.includes('LIMIT 101 OFFSET $2')){
   const rows=issues.filter(x=>x.distributor_id===args[0]).map(x=>({
     ...x,code_hint:x.kind==='app'?'59••••29':null,
     code_activated_at:x.kind==='app'?codes[0].redeemed_at:null,
     code_revoked_at:null,code_bound:x.kind==='app',
     admin_relogin_count:0,account_enabled:true,
     subscription_expires_at:accounts[0].expires_at
   }));
   return {rows};
  }
  if(sql.includes("FROM blofy_xtream_servers")&&sql.includes("lower(btrim(name))='saleh'"))
   return {rows:sourceReady?[{id:salehId,name:'saleh'}]:[]};
  if(sql.includes('FROM blofy_stream_distributor_issues')&&sql.includes('trial_customer_hash=$1')){
   return {rows:issues.filter(x=>x.trial_customer_hash===args[0]&&
    ['pending','done','review'].includes(x.status))};
  }
  if(sql.includes('SELECT COUNT(*)::int AS count')&&sql.includes('duration_days=1')){
   return {rows:[{count:issues.filter(x=>x.distributor_id===args[0]&&
      x.duration_days===1&&['pending','done','review'].includes(x.status)).length}]};
  }
  if(sql.includes('SELECT source_category_id,name FROM blofy_xtream_categories'))
   return {rows:[{source_category_id:'10',name:'Movies'}]};
  if(sql.includes('COUNT(*)::int AS total FROM blofy_xtream_items'))
   return {rows:[{total:catalogRecords.length}]};
  if(sql.includes('AS would_hide')&&sql.includes('FROM blofy_stream_distributor_library o')){
   const rows=libraryRows.filter(x=>x.distributor_id===args[0]&&x.media_type===args[1]);
   return {rows:[{would_hide:rows.filter(x=>x.hidden===true).length,
     explicitly_shown:rows.filter(x=>x.hidden===false).length,
     renamed:rows.filter(x=>x.custom_title).length,
     grouped:rows.filter(x=>x.custom_group).length}]};
  }
  if(sql.includes('SELECT COUNT(*)::int AS total')&&
     sql.includes('FROM blofy_stream_distributor_issues')&&sql.includes("status='done'")){
   return {rows:[{total:issues.filter(x=>x.distributor_id===args[0]&&x.status==='done').length}]};
  }
  if(sql.includes('WITH eligible AS')&&sql.includes('INSERT INTO blofy_stream_distributor_library')){
   const eligible=catalogRecords.filter(x=>x.type===args[1]&&args[3].includes(x.id));
   for(const item of eligible){
     let row=libraryRows.find(x=>x.distributor_id===args[2]&&
       x.media_type===args[1]&&x.source_item_id===item.id);
     if(!row){row={distributor_id:args[2],media_type:args[1],
       source_item_id:item.id,custom_group:'',custom_title:'',sort_order:0,hidden:false};
       libraryRows.push(row);}
     if(args[4])row.custom_group=args[5];
     if(args[6])row.hidden=args[7];
   }
   return {rows:eligible.map(x=>({source_item_id:x.id}))};
  }
  if(sql.includes('FROM blofy_stream_distributor_library')&&sql.includes('ANY('))
   return {rows:libraryRows.filter(x=>x.distributor_id===args[0]&&
     x.media_type===args[1]&&args[2].includes(x.source_item_id))};
  if(sql.includes('FROM blofy_xtream_items')&&sql.includes('source_id=$3'))
   return {rows:args[0]===salehId&&args[2]==='42'?[{source_id:'42'}]:[]};
  if(sql.includes('INSERT INTO blofy_stream_distributor_library')){
   const found=libraryRows.find(x=>x.distributor_id===args[0]&&
     x.media_type===args[1]&&x.source_item_id===args[2]);
   const fields={distributor_id:args[0],media_type:args[1],
     source_item_id:args[2],custom_group:args[3],custom_title:args[4],
     sort_order:args[5],hidden:args[6]};
   if(found)Object.assign(found,fields);else libraryRows.push(fields);
   return {rows:[]};
  }

  if(sql.includes('FROM blofy_stream_distributor_actions')&&sql.includes('request_id=$2'))
   return {rows:actions.filter(x=>x.distributor_id===args[0]&&x.request_id===args[1])};
  if(sql.includes('INSERT INTO blofy_stream_distributor_actions')){
   actions.push({id:args[0],distributor_id:args[1],issue_id:args[2],
    request_id:args[3],action:sql.includes("'renew'")?'renew':'relogin',
    result:JSON.parse(sql.includes("'renew'")?args[5]:args[4]),
     credit_cost:sql.includes("'renew'")?args[4]:0});
   return {rows:[]};
  }
  if(sql.includes('FROM blofy_xtream_gateway_duration_codes')&&sql.includes('WHERE id=$1 FOR UPDATE'))
   return {rows:codes.filter(x=>x.id===args[0])};
  if(sql.includes('FROM blofy_xtream_gateway_accounts')&&sql.includes('WHERE id=$1 FOR UPDATE'))
   return {rows:accounts.filter(x=>x.id===args[0])};
  if(sql.includes('UPDATE blofy_xtream_gateway_accounts')&&sql.includes('SET expires_at=$2')){
   const a=accounts.find(x=>x.id===args[0]);a.expires_at=args[1];return {rows:[]};
  }
  if(sql.includes('UPDATE blofy_xtream_gateway_duration_codes')&&sql.includes('SET expires_at=$2')){
   const c=codes.find(x=>x.id===args[0]);c.expires_at=args[1];return {rows:[]};
  }
  if(sql.includes('UPDATE blofy_xtream_gateway_duration_codes')&&sql.includes('SET admin_relogin_until=$2')){
   const c=codes.find(x=>x.id===args[0]);c.admin_relogin_until=args[1];return {rows:[]};
  }
  if(sql.includes('INSERT INTO blofy_xtream_gateway_code_events')){
   events.push({codeId:args[1],event:args[2],details:args[3]});return {rows:[]};
  }
  if(sql.includes('UPDATE blofy_stream_distributor_issues')&&sql.includes('SET customer_name=$3')){
   const item=issues.find(x=>x.id===args[0]&&x.distributor_id===args[1]);
   item.customer_name=args[2];item.customer_phone=args[3];return {rows:[item]};
  }
  if(sql.includes('COUNT(*) FILTER')&&sql.includes('FROM blofy_stream_distributor_issues')){
   return {rows:[{total:issues.filter(x=>x.distributor_id===args[0]&&x.status==='done').length,
     active:issues.filter(x=>x.distributor_id===args[0]&&x.status==='done').length,
     expiring:0,expired:0,customers:new Set(issues.filter(x=>x.distributor_id===args[0])
      .map(x=>x.customer_phone).filter(Boolean)).size}]};
  }
  if(sql.includes('LEFT JOIN blofy_xtream_gateway_duration_codes')&&sql.includes('LIMIT 101')){
   const rows=issues.filter(x=>x.distributor_id===args[0]).map(x=>({
     ...x,code_hint:x.kind==='app'?'59••••29':null,
     code_activated_at:x.kind==='app'?codes[0].redeemed_at:null,
     code_revoked_at:null,code_bound:x.kind==='app',
     admin_relogin_count:0,account_enabled:true,
     subscription_expires_at:accounts[0].expires_at
   }));
   return {rows};
  }
  if(sql.includes('ARRAY_AGG(customer_name')&&sql.includes('FROM blofy_stream_distributor_issues')){
   return {rows:issues.filter(x=>x.distributor_id===args[0]&&x.customer_phone)
     .map(x=>({customer_phone:x.customer_phone,customer_name:x.customer_name,
       subscriptions:1,latest:x.created_at}))};
  }
  if(sql.includes('FROM blofy_stream_distributors')&&sql.includes('WHERE username='))
   return {rows:distributors.filter(x=>x.username===args[0])};
  if(sql.includes('FROM blofy_stream_distributors')&&sql.includes('ORDER BY created_at'))
   return {rows:distributors.slice()};
  if(sql.includes('INSERT INTO blofy_stream_distributor_sessions')){
   sessions.push({hash:args[0],id:args[1],expires_at:args[2]});return {rows:[]};
  }
  if(sql.includes('FROM blofy_stream_distributor_sessions s')){
   const session=sessions.find(x=>x.hash===args[0]);
   const user=distributors.find(x=>x.id===session?.id&&x.enabled);
   return {rows:user?[user]:[]};
  }
  if(sql.includes('FROM blofy_stream_distributors')&&sql.includes('WHERE id=$1 FOR UPDATE'))
   return {rows:distributors.filter(x=>x.id===args[0])};
  if(sql.includes('FROM blofy_stream_distributor_issues')&&
     sql.includes('request_id=$2'))
   return {rows:issues.filter(x=>x.distributor_id===args[0]&&x.request_id===args[1])};
  if(sql.includes('FROM blofy_stream_distributor_issues')&&sql.includes('id=$1 AND distributor_id=$2'))
   return {rows:issues.filter(x=>x.id===args[0]&&x.distributor_id===args[1])};
  if(sql.includes('FROM blofy_stream_distributor_issues')&&sql.includes('ORDER BY created_at DESC'))
   return {rows:issues.filter(x=>x.distributor_id===args[0])};
  if(sql.includes('INSERT INTO blofy_stream_distributor_issues')){
   const row={id:args[0],distributor_id:args[1],request_id:args[2],kind:args[3],
    label:args[4],duration_days:args[5],max_connections:args[6],
    subject_id:null,status:'pending',created_at:now,
    credit_cost:args[7],trial_customer_hash:args[8],
     customer_name:args[9]||'',customer_phone:args[10]||''};
   issues.push(row);return {rows:[row]};
  }
  if(sql.includes('SET credits=credits-$2 WHERE id=$1')){
   const row=distributors.find(x=>x.id===args[0]);row.credits-=args[1];return {rows:[]};
  }
  if(sql.includes('SET credits=credits+$2 WHERE id=$1')&&sql.startsWith('UPDATE blofy_stream_distributors SET credits=credits+$2 WHERE id=$1')){
   const row=distributors.find(x=>x.id===args[0]);row.credits+=args[1];return {rows:[]};
  }
  if(sql.includes('SET issued_count=issued_count+1 WHERE id=$1')){
   const row=distributors.find(x=>x.id===args[0]);row.issued_count++;return {rows:[]};
  }
  if(sql.includes("SET status='done',subject_id=$2")){
   const row=issues.find(x=>x.id===args[0]);row.status='done';row.subject_id=args[1];return {rows:[]};
  }
  if(sql.includes('SET status=$2 WHERE id=$1')){
   const row=issues.find(x=>x.id===args[0]);row.status=args[1];return {rows:[]};
  }
  if(sql.includes('SET credits=credits+$2')){
   const row=distributors.find(x=>x.id===args[0]);
   if(!row||row.credits+args[1]<0)return {rows:[]};
   row.credits+=args[1];return {rows:[row]};
  }
  if(sql.includes('SET enabled=$2')){
   const row=distributors.find(x=>x.id===args[0]);if(!row)return {rows:[]};
   row.enabled=args[1];return {rows:[row]};
  }
  if(sql.includes('SET password_hash=$2')){
   const row=distributors.find(x=>x.id===args[0]);row.password_hash=args[1];return {rows:[row]};
  }
  if(sql.includes('SET last_credential_rotation_at=NOW()')){
   const row=issues.find(x=>x.id===args[0]&&x.distributor_id===args[1]);
   row.last_credential_rotation_at=now;
   row.credential_rotation_request_id=args[2];return {rows:[]};
  }
  if(sql.includes('DELETE FROM blofy_stream_distributor_sessions WHERE distributor_id=$1 AND session_hash<>$2')){
   for(let i=sessions.length-1;i>=0;i--)
     if(sessions[i].id===args[0]&&sessions[i].hash!==args[1])sessions.splice(i,1);
   return {rows:[]};
  }
  if(sql.includes('DELETE FROM blofy_stream_distributor_sessions WHERE distributor_id=$1')){
   for(let i=sessions.length-1;i>=0;i--)if(sessions[i].id===args[0])sessions.splice(i,1);
   return {rows:[]};
  }
  if(sql.includes('DELETE FROM blofy_stream_distributor_sessions WHERE session_hash=$1')){
   for(let i=sessions.length-1;i>=0;i--)if(sessions[i].hash===args[0])sessions.splice(i,1);
   return {rows:[]};
  }
  throw Error('Unexpected SQL: '+sql);
 }
 const pool={query,async connect(){return {query,release(){}}}};
 const manager=createStreamDistributors({pool,clock:()=>now.getTime(),
   trialKeyHex:'9'.repeat(64),
   rotateXtream:async id=>{
      calls.push({type:'rotation',id});
      if(id!==accountId)return {status:404,body:{ok:false}};
      credential.username='newUser12';credential.password='NewPassSecure1';
      return {status:200,body:{ok:true,credentials:{...credential}}};
    },
    listCatalog:async args=>{
     calls.push({type:'catalog',data:args});
     return catalogRecords.filter(x=>x.type===args.type);
   },
   issueCode:async data=>{
     calls.push({type:'app',data});
     return failCode?{status:409,body:{ok:false}}:
      {status:201,body:{items:[{id:codeId,code:issuedToken}]}};
   },
   issueXtream:async data=>{
     calls.push({type:'xtream',data});
     return {status:201,body:{item:{id:accountId},credentials:credential}};
   },
   revealCode:async id=>({status:id===codeId?200:404,body:{ok:true,code:issuedToken}}),
   revealXtream:async id=>({status:id===accountId?200:404,body:{ok:true,credentials:credential}})
 });
 return {manager,distributors,issues,accounts,codes,actions,events,creditEvents,calls,sessions,statements,libraryRows,salehId,
  setFail:v=>{failCode=v},setSource:v=>{sourceReady=v}};
}
test('resellers have dedicated hashed passwords, isolated sessions and limited stock',async()=>{
 const f=fixture();
 const made=await f.manager.createAdmin({name:'موزع أول',username:'store-01',credits:4});
 assert.match(made.password,/^[A-Za-z0-9_-]{24}$/);
 assert.equal(made.item.credits,4);
 assert.equal(f.distributors[0].password_hash.includes(made.password),false);
 assert.equal(JSON.stringify(await f.manager.listAdmin()).includes(made.password),false);
 await assert.rejects(f.manager.login({username:'store-01',password:'wrong-password-12'}),
   /distributor_login_failed/);
 const session=await f.manager.login({username:'store-01',password:made.password});
 assert.equal(typeof session.token,'string');
 assert.equal(JSON.stringify(await f.manager.me(session.token)).includes(session.token),false);
 const firstId=crypto.randomUUID();
 const one=await f.manager.issue(session.token,{kind:'app',durationDays:30,
   maxConnections:2,label:'عميل 1',requestId:firstId});
 assert.equal(one.code,'59374629');
 assert.equal(f.distributors[0].credits,3);
 assert.equal(f.distributors[0].issued_count,1);
 assert.equal(f.calls[0].data.quantity,1);
 assert.equal(f.calls[0].data.maxConnections,1,'distributor always issues a single connection');
 assert.equal(f.issues[0].max_connections,1,'ledger records actual connection count');
 assert.equal(f.calls[0].data.channel,'app');
 assert.equal(f.calls[0].data.sourceId,f.salehId);
 const repeat=await f.manager.issue(session.token,{kind:'app',durationDays:30,
   maxConnections:2,label:'عميل 1',requestId:firstId});
 assert.equal(repeat.code,one.code,'same request is idempotent');
 assert.equal(f.calls.length,1,'no second issuance on retry');
 const two=await f.manager.issue(session.token,{kind:'xtream',durationDays:90,
   maxConnections:1,label:'عميل 2',requestId:crypto.randomUUID()});
 assert.equal(two.credentials.username,'reseller_generated');
 assert.equal(f.calls[1].data.sourceId,f.salehId);
 assert.match(f.calls[1].data.expiresAt,/2027-/);
 assert.equal(f.distributors[0].credits,0);
 assert.equal((await f.manager.issued(session.token)).items.length,2);
 await assert.rejects(f.manager.issue(session.token,{kind:'app',durationDays:30,
   maxConnections:1,requestId:crypto.randomUUID()}),/distributor_no_credits/);
 await assert.rejects(f.manager.reveal(session.token,crypto.randomUUID()),
   /distributor_issue_missing/);
 await f.manager.setAdmin(made.item.id,{enabled:false});
 await assert.rejects(f.manager.me(session.token),/distributor_session_expired/);
 assert.equal(f.sessions.length,0,'disable revokes all sessions');
 assert.equal(f.statements.some(x=>/DROP TABLE|TRUNCATE/.test(x)),false);
});
test('definitive issuance rejection refunds stock; credentials cannot change sources',async()=>{
 const f=fixture(),made=await f.manager.createAdmin({
  name:'Second',username:'second-store',credits:1});
 const login=await f.manager.login({username:'second-store',password:made.password});
 f.setFail(true);
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:30,
   maxConnections:1,requestId:crypto.randomUUID()}),/distributor_issuance_rejected/);
 assert.equal(f.distributors[0].credits,1);
 assert.equal(f.issues[0].status,'failed');
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:30,
   maxConnections:10,requestId:crypto.randomUUID()}),/distributor_issuance_rejected/);
 assert.equal(f.calls.at(-1).data.maxConnections,1,
   'even a forged ten-connection request is restricted to one');
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:0,
   maxConnections:1,requestId:crypto.randomUUID()}),/distributor_days_invalid/);
});


test('month-unit credits are charged for the chosen term; a free day costs zero',()=>{
 const cases=[[1,0],[30,1],[90,3],[180,6],[365,12]];
 for(const [days,credits] of cases)assert.equal(distributorPlanCost(days),credits);
 for(const duration of [0,2,7,60,366,730,731,Infinity,-1,null])
  assert.throws(()=>distributorPlanCost(duration),/distributor_plan_invalid/);
});
test('annual code deducts exactly twelve month credits and is locked to saleh',async()=>{
 const f=fixture();const created=await f.manager.createAdmin({
  name:'Distributor',username:'annual-store',credits:15});
 const login=await f.manager.login({username:'annual-store',password:created.password});
 const issued=await f.manager.issue(login.token,{kind:'app',
  durationDays:365,maxConnections:1,requestId:crypto.randomUUID()});
 assert.equal(issued.issue.chargedCredits,12);
 assert.equal(f.distributors[0].credits,3);
 assert.equal(f.calls[0].data.sourceId,f.salehId);
 f.setSource(false);
 await assert.rejects(f.manager.issue(login.token,{kind:'app',
  durationDays:30,maxConnections:1,requestId:crypto.randomUUID()}),
  /distributor_saleh_source_unavailable/);
 assert.equal(f.calls.length,1,'never issue on a second source');
 assert.equal(f.distributors[0].credits,3,'no charge when saleh is unavailable');
});
test('one-day trials are free, phone-fingerprinted, limited, and repeat denied',async()=>{
 const f=fixture();const created=await f.manager.createAdmin({
  name:'trial store',username:'trial-store',credits:0});
 const login=await f.manager.login({username:'trial-store',password:created.password});
 await assert.rejects(f.manager.issue(login.token,{kind:'xtream',durationDays:1,
  maxConnections:1,requestId:crypto.randomUUID()}),/distributor_trial_phone_required/);
 const first=await f.manager.issue(login.token,{kind:'xtream',durationDays:1,
  maxConnections:1,requestId:crypto.randomUUID(),trialPhone:'0555555555'});
 assert.equal(first.issue.chargedCredits,0);
 assert.equal(f.distributors[0].credits,0);
 assert.match(f.issues[0].trial_customer_hash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(f.issues).includes('0555555555'),false);
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:1,
  maxConnections:1,requestId:crypto.randomUUID(),trialPhone:'0555555555'}),
  /distributor_trial_already_used/);
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:1,
  maxConnections:1,requestId:crypto.randomUUID(),trialPhone:'+966555555555'}),
  /distributor_trial_already_used/);
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:1,
  maxConnections:1,requestId:crypto.randomUUID(),trialPhone:'00966555555555'}),
  /distributor_trial_already_used/);
 for(let n=0;n<4;n++)
  await f.manager.issue(login.token,{kind:'app',durationDays:1,
   maxConnections:1,requestId:crypto.randomUUID(),trialPhone:'055555555'+n});
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:1,
  maxConnections:1,requestId:crypto.randomUUID(),trialPhone:'0555555560'}),
  /distributor_trial_daily_limit/);
 assert.equal(f.distributors[0].credits,0);
});
test('organization is private to distributor; only actual saleh titles are editable',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Distributor A',username:'store-one',credits:0});
 const b=await f.manager.createAdmin({name:'Distributor B',username:'store-two',credits:0});
 const loginA=await f.manager.login({username:'store-one',password:a.password});
 const loginB=await f.manager.login({username:'store-two',password:b.password});
 const before=await f.manager.library(loginA.token,{type:'movie'});
 assert.equal(before.items[0].id,'42');
 assert.equal(before.sourceName,'saleh');
 assert.equal(f.calls.find(x=>x.type==='catalog').data.sourceId,f.salehId);
 await assert.rejects(f.manager.organize(loginA.token,{type:'movie',
  itemId:'other-source',group:'Not allowed'}),/distributor_library_item_not_in_saleh/);
 const saved=await f.manager.organize(loginA.token,{type:'movie',itemId:'42',
  group:'Favorites',title:'Top movie',sortOrder:12,hidden:false});
 assert.equal(saved.scope,'distributor_only_not_global');
 const after=await f.manager.library(loginA.token,{type:'movie'});
 assert.equal(after.items[0].group,'Favorites');
 assert.equal(after.items[0].title,'Top movie');
 const other=await f.manager.library(loginB.token,{type:'movie'});
 assert.equal(other.items[0].group,undefined,'second distributor has no access to customization');
 assert.equal(f.statements.some(sql=>/UPDATE blofy_xtream_items|DELETE FROM blofy_xtream_items/.test(sql)),false);
});

test('distributor can manage only own contacts, searchable ledger and customer directory',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Store A',username:'store-customer-a',credits:12});
 const b=await f.manager.createAdmin({name:'Store B',username:'store-customer-b',credits:12});
 const t1=(await f.manager.login({username:'store-customer-a',password:a.password})).token;
 const t2=(await f.manager.login({username:'store-customer-b',password:b.password})).token;
 const one=await f.manager.issue(t1,{kind:'app',durationDays:30,maxConnections:1,
  requestId:crypto.randomUUID(),customerName:'Customer',customerPhone:'0559999999'});
 assert.equal(f.issues[0].customer_phone,'966559999999');
 const listed=await f.manager.issued(t1,{q:'559999',status:'all'});
 assert.equal(listed.items.length,1);
 assert.equal(listed.items[0].customerName,'Customer');
 assert.equal(listed.stats.active,1);
 assert.equal((await f.manager.clients(t2)).items.length,0);
 assert.equal((await f.manager.clients(t1)).items[0].phone,'966559999999');
 await assert.rejects(f.manager.customer(t2,{issueId:one.issue.id,name:'Other',
  phone:'0550000000'}),/distributor_issue_missing/);
 await f.manager.customer(t1,{issueId:one.issue.id,name:'Updated',
  phone:'0558888888'});
 assert.equal(f.issues[0].customer_name,'Updated');
 assert.equal(f.issues[0].customer_phone,'966558888888');
});
test('renewal costs twelve credits, extends expiration atomically and does not double-charge retries',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Store A',username:'renew-a',credits:15});
 const t=(await f.manager.login({username:'renew-a',password:a.password})).token;
 const one=await f.manager.issue(t,{kind:'app',durationDays:30,maxConnections:1,
  requestId:crypto.randomUUID()});
 const start=f.accounts[0].expires_at.getTime(),rid=crypto.randomUUID();
 const result=await f.manager.renew(t,{issueId:one.issue.id,days:365,requestId:rid});
 assert.equal(result.chargedCredits,12);
 assert.equal(f.distributors[0].credits,2);
 assert.equal(f.accounts[0].expires_at.getTime(),start+365*86400000);
 assert.equal(f.codes[0].expires_at.getTime(),start+365*86400000);
 const again=await f.manager.renew(t,{issueId:one.issue.id,days:365,requestId:rid});
 assert.equal(again.repeated,true);
 assert.equal(f.distributors[0].credits,2);
 assert.equal(f.actions.length,1);
 assert.equal(f.events.length,1);
 await assert.rejects(f.manager.renew(t,{issueId:one.issue.id,days:1,
  requestId:crypto.randomUUID()}),/distributor_renew_trial_denied/);
});
test('re-entry is free, one-use and repeatable by owner only, tied to saleh',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Store A',username:'relogin-a',credits:1});
 const b=await f.manager.createAdmin({name:'Store B',username:'relogin-b',credits:1});
 const t=(await f.manager.login({username:'relogin-a',password:a.password})).token;
 const other=(await f.manager.login({username:'relogin-b',password:b.password})).token;
 const one=await f.manager.issue(t,{kind:'app',durationDays:30,maxConnections:1,
  requestId:crypto.randomUUID()});
 await assert.rejects(f.manager.relogin(other,{issueId:one.issue.id,
  requestId:crypto.randomUUID()}),/distributor_issue_missing/);
 const result=await f.manager.relogin(t,{issueId:one.issue.id,requestId:crypto.randomUUID()});
 assert.equal(result.sameCode,true);
 assert.equal(result.oneTime,true);
 assert.equal(result.allowedUntil,f.codes[0].admin_relogin_until.getTime());
 assert.equal(f.distributors[0].credits,0);
 assert.equal(f.events[0].event,'same_code_admin_relogin_granted');
 const again=await f.manager.relogin(t,{issueId:one.issue.id,requestId:crypto.randomUUID()});
 assert.equal(again.sameCode,true);
 assert.equal(f.actions.length,2);
 f.setSource(false);
 await assert.rejects(f.manager.relogin(t,{issueId:one.issue.id,
  requestId:crypto.randomUUID()}),/distributor_saleh_source_unavailable/);
});

test('distributor never issues or renews for two years', async()=>{
 const f=fixture();
 const admin=await f.manager.createAdmin({name:'Year Limit Store',username:'year-limit-store',credits:100});
 const session=await f.manager.login({username:'year-limit-store',password:admin.password});
 await assert.rejects(f.manager.issue(session.token,{kind:'xtream',durationDays:730,
  requestId:crypto.randomUUID()}),/(distributor_days_invalid|distributor_plan_invalid)/);
 const existing=await f.manager.issue(session.token,{kind:'app',durationDays:30,
  requestId:crypto.randomUUID(),maxConnections:8});
 assert.equal(f.calls[0].data.maxConnections,1);
 assert.equal(f.distributors[0].credits,99);
 await assert.rejects(f.manager.renew(session.token,{issueId:existing.issue.id,
  days:730,requestId:crypto.randomUUID()}),/distributor_plan_invalid/);
 assert.equal(f.distributors[0].credits,99);
});

test('owner sets a daily issuance limit, with server-side block and no accidental charge',async()=>{
 const f=fixture(),a=await f.manager.createAdmin({name:'Daily Store',username:'limit-test',credits:20});
 const token=(await f.manager.login({username:'limit-test',password:a.password})).token;
 assert.equal((await f.manager.setAdmin(a.item.id,{dailyLimit:2})).item.dailyLimit,2);
 await f.manager.issue(token,{kind:'app',durationDays:30,requestId:crypto.randomUUID()});
 await f.manager.issue(token,{kind:'xtream',durationDays:30,requestId:crypto.randomUUID()});
 const after=f.distributors[0].credits;
 await assert.rejects(f.manager.issue(token,{kind:'app',durationDays:30,
  requestId:crypto.randomUUID()}),/distributor_issue_daily_limit/);
 assert.equal(f.distributors[0].credits,after);
 assert.equal(f.calls.length,2);
 await assert.rejects(f.manager.setAdmin(a.item.id,{dailyLimit:0}),/distributor_limit_invalid/);
});
test('audited month credits include opening, issue, refund, renewal and owner top-up',async()=>{
 const f=fixture(),created=await f.manager.createAdmin({
  name:'Audit Store',username:'audit-test',credits:15});
 const token=(await f.manager.login({username:'audit-test',password:created.password})).token;
 assert.equal(f.creditEvents[0].type,'opening');
 assert.equal(f.creditEvents[0].balance_after,15);
 await f.manager.issue(token,{kind:'app',durationDays:30,requestId:crypto.randomUUID()});
 assert.equal(f.creditEvents.at(-1).type,'issue');
 assert.equal(f.creditEvents.at(-1).delta,-1);
 const issue=f.issues.at(-1);
 await f.manager.renew(token,{issueId:issue.id,days:365,requestId:crypto.randomUUID()});
 assert.equal(f.creditEvents.at(-1).type,'renew');
 assert.equal(f.creditEvents.at(-1).delta,-12);
 assert.equal(f.distributors[0].credits,2);
 await f.manager.setAdmin(created.item.id,{credits:5});
 assert.equal(f.creditEvents.at(-1).type,'adjustment');
 assert.equal(f.creditEvents.at(-1).balance_after,7);
 assert.equal((await f.manager.activity(token)).items.length,4);
 const report=(await f.manager.analytics(token)).stats;
 assert.equal(report.today,1);
 assert.equal(report.month,1);
 assert.equal(report.renewalsMonth,1);
 assert.equal(report.renewedCreditsMonth,12);
 assert.equal(report.issued24h,1);
 assert.equal(report.dailyLimit,100);
 assert.equal(report.topPlanDays,30);
 assert.equal((await f.manager.exportIssues(token)).items.length,1);
 f.setFail(true);
 await assert.rejects(f.manager.issue(token,{kind:'app',durationDays:30,
  requestId:crypto.randomUUID()}),/distributor_issuance_rejected/);
 assert.equal(f.creditEvents.at(-1).type,'refund');
 assert.equal(f.distributors[0].credits,7);
 const last=(await f.manager.activity(token)).items[0];
 assert.equal(last.type,'refund');
});
test('owner-private audit and CSV output never include other distributor customers',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Shop One',username:'own-audit-one',credits:3});
 const b=await f.manager.createAdmin({name:'Shop Two',username:'own-audit-two',credits:3});
 const tokenA=(await f.manager.login({username:'own-audit-one',password:a.password})).token;
 const tokenB=(await f.manager.login({username:'own-audit-two',password:b.password})).token;
 await f.manager.issue(tokenA,{kind:'xtream',durationDays:30,
  requestId:crypto.randomUUID(),customerName:'Private A',customerPhone:'0557777777'});
 const own=await f.manager.exportIssues(tokenA);
 const other=await f.manager.exportIssues(tokenB);
 assert.equal(own.items.length,1);
 assert.equal(other.items.length,0);
 assert.equal((await f.manager.activity(tokenB)).items.filter(x=>x.type==='issue').length,0);
});

test('a merchant changes own hashed dashboard password and keeps only this session',async()=>{
 const f=fixture();
 const admin=await f.manager.createAdmin({name:'Secure Store',username:'secure-store',credits:4});
 const one=(await f.manager.login({username:'secure-store',password:admin.password})).token;
 const other=(await f.manager.login({username:'secure-store',password:admin.password})).token;
 await assert.rejects(f.manager.changePassword(one,{currentPassword:'wrong',
   newPassword:'NewPasswordStrong2026!'}),/distributor_password_current_invalid/);
 await assert.rejects(f.manager.changePassword(one,{currentPassword:admin.password,
   newPassword:'weak123'}),/distributor_password_strength_invalid/);
 assert.equal(f.sessions.length,2);
 const changed=await f.manager.changePassword(one,{currentPassword:admin.password,
   newPassword:'NewPasswordStrong2026!'});
 assert.equal(changed.otherSessionsRevoked,true);
 assert.equal(f.sessions.length,1);
 assert.equal((await f.manager.me(one)).ok,true);
 await assert.rejects(f.manager.me(other),/distributor_session_expired/);
 await assert.rejects(f.manager.login({username:'secure-store',password:admin.password}),
   /distributor_login_failed/);
 assert.equal((await f.manager.login({username:'secure-store',
   password:'NewPasswordStrong2026!'})).ok,true);
 assert.doesNotMatch(f.distributors[0].password_hash,/NewPasswordStrong2026/);
});

test('Xtream rotation is only for own issued account, explicit, rate-limited, and idempotent',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Store A',username:'rotate-store-a',credits:4});
 const b=await f.manager.createAdmin({name:'Store B',username:'rotate-store-b',credits:4});
 const ta=(await f.manager.login({username:'rotate-store-a',password:a.password})).token;
 const tb=(await f.manager.login({username:'rotate-store-b',password:b.password})).token;
 const issued=await f.manager.issue(ta,{kind:'xtream',durationDays:30,
   requestId:crypto.randomUUID()});
 const issueId=issued.issue.id,requestId=crypto.randomUUID();
 await assert.rejects(f.manager.rotateOwnedXtream(tb,{issueId,requestId,
   acknowledgeDisconnect:true}),/distributor_issue_missing/);
 await assert.rejects(f.manager.rotateOwnedXtream(ta,{issueId,requestId}),
   /distributor_rotation_requires_confirmation/);
 const result=await f.manager.rotateOwnedXtream(ta,{issueId,requestId,
   acknowledgeDisconnect:true});
 assert.equal(result.ok,true);
 assert.equal(result.credentials.username,'newUser12');
 assert.equal(result.subscriptionUnchanged,true);
 assert.equal(f.calls.filter(x=>x.type==='rotation').length,1);
 const repeated=await f.manager.rotateOwnedXtream(ta,{issueId,requestId,
   acknowledgeDisconnect:true});
 assert.equal(repeated.repeated,true);
 assert.equal(f.calls.filter(x=>x.type==='rotation').length,1);
 await assert.rejects(f.manager.rotateOwnedXtream(ta,{issueId,
   requestId:crypto.randomUUID(),acknowledgeDisconnect:true}),
   /distributor_rotation_cooldown/);
 const code=await f.manager.issue(ta,{kind:'app',durationDays:30,
   requestId:crypto.randomUUID()});
 await assert.rejects(f.manager.rotateOwnedXtream(ta,{issueId:code.issue.id,
   requestId:crypto.randomUUID(),acknowledgeDisconnect:true}),
   /distributor_rotation_not_eligible/);
});

test('merchant can browse full saleh categories and apply safe selected-only overlays',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Store A',username:'bulk-library-a',credits:1});
 const b=await f.manager.createAdmin({name:'Store B',username:'bulk-library-b',credits:1});
 const ta=(await f.manager.login({username:'bulk-library-a',password:a.password})).token;
 const tb=(await f.manager.login({username:'bulk-library-b',password:b.password})).token;
 const cats=await f.manager.libraryCategories(ta,{type:'movie'});
 assert.equal(cats.total,1);
 assert.equal(cats.categories[0].name,'Movies');
 const page=await f.manager.library(ta,{type:'movie',categoryId:'10'});
 assert.equal(page.items[0].id,'42');
 const result=await f.manager.organizeBulk(ta,{type:'movie',itemIds:['42','99'],
   group:'مختارات',hidden:true});
 assert.equal(result.updated,1);
 assert.equal(result.skipped,1);
 assert.equal((await f.manager.library(ta,{type:'movie'})).items[0].hidden,true);
 assert.equal((await f.manager.library(tb,{type:'movie'})).items[0].hidden,undefined);
 await assert.rejects(f.manager.organizeBulk(tb,{type:'movie',itemIds:[],
   hidden:true}),/distributor_bulk_selection_invalid/);
 await assert.rejects(f.manager.organizeBulk(tb,{type:'movie',itemIds:['42'],
   hidden:'yes'}),/distributor_library_hidden_invalid/);
 assert.equal(f.statements.some(sql=>/UPDATE blofy_xtream_items|DELETE FROM blofy_xtream_items/.test(sql)),false);
});

test('merchant delivery preview is source-scoped, exact and read-only',async()=>{
 const f=fixture();
 const a=await f.manager.createAdmin({name:'Merchant A',username:'preview-merchant-a',credits:1});
 const b=await f.manager.createAdmin({name:'Merchant B',username:'preview-merchant-b',credits:1});
 const ta=(await f.manager.login({username:'preview-merchant-a',password:a.password})).token;
 const tb=(await f.manager.login({username:'preview-merchant-b',password:b.password})).token;
 const before=await f.manager.libraryDeliveryPreview(ta,{type:'movie'});
 assert.equal(before.total,1);
 assert.equal(before.wouldShow,1);
 assert.equal(before.wouldHide,0);
 assert.equal(before.customerTrafficChanged,false);
 assert.equal(before.customerCatalogFilteringEnabled,false);
 await f.manager.organizeBulk(ta,{type:'movie',itemIds:['42'],hidden:true,group:'معروض لاحقًا'});
 const after=await f.manager.libraryDeliveryPreview(ta,{type:'movie'});
 assert.equal(after.wouldHide,1);
 assert.equal(after.wouldShow,0);
 assert.equal(after.grouped,1);
 const unrelated=await f.manager.libraryDeliveryPreview(tb,{type:'movie'});
 assert.equal(unrelated.wouldShow,1);
 assert.equal(unrelated.wouldHide,0);
 await assert.rejects(f.manager.libraryDeliveryPreview(ta,{type:'invalid'}),
   /distributor_library_type_invalid/);
 assert.equal(f.statements.some(sql=>/UPDATE blofy_xtream_items|DELETE FROM blofy_xtream_items/.test(sql)),false);
});
