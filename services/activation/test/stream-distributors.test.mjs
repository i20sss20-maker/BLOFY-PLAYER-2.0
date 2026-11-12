import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStreamDistributors} from '../src/stream-distributors.mjs';

function fixture(){
 const distributors=[],sessions=[],issues=[],calls=[],statements=[];
 const now=new Date('2026-11-12T04:00:00Z');
 const accountId=crypto.randomUUID(),codeId=crypto.randomUUID();
 const issuedToken='59374629',credential={serverUrl:'https://blofyplayer.com',
   username:'reseller_generated',password:'protected-password',m3uUrl:'https://blofyplayer.com/get.php'};
 let failCode=false;
 async function query(sql,args=[]){
  statements.push(sql);
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||/^\s*(CREATE TABLE|CREATE INDEX)/.test(sql))
   return {rows:[]};
  if(sql.includes('INSERT INTO blofy_stream_distributors')){
   const row={id:args[0],display_name:args[1],username:args[2],
     password_hash:args[3],credits:args[4],issued_count:0,
     enabled:true,created_at:now};
   distributors.push(row);return {rows:[row]};
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
  if(sql.includes('FROM blofy_stream_distributors WHERE id=$1 FOR UPDATE'))
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
    subject_id:null,status:'pending',created_at:now};
   issues.push(row);return {rows:[row]};
  }
  if(sql.includes('SET credits=credits-1 WHERE id=$1')){
   const row=distributors.find(x=>x.id===args[0]);row.credits--;return {rows:[]};
  }
  if(sql.includes('SET credits=credits+1 WHERE id=$1')){
   const row=distributors.find(x=>x.id===args[0]);row.credits++;return {rows:[]};
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
 return {manager,distributors,issues,calls,sessions,statements,setFail:v=>{failCode=v}};
}
test('resellers have dedicated hashed passwords, isolated sessions and limited stock',async()=>{
 const f=fixture();
 const made=await f.manager.createAdmin({name:'موزع أول',username:'store-01',credits:2});
 assert.match(made.password,/^[A-Za-z0-9_-]{24}$/);
 assert.equal(made.item.credits,2);
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
 assert.equal(f.distributors[0].credits,1);
 assert.equal(f.distributors[0].issued_count,1);
 assert.equal(f.calls[0].data.quantity,1);
 assert.equal(f.calls[0].data.channel,'app');
 assert.equal(f.calls[0].data.sourceId,null);
 const repeat=await f.manager.issue(session.token,{kind:'app',durationDays:30,
   maxConnections:2,label:'عميل 1',requestId:firstId});
 assert.equal(repeat.code,one.code,'same request is idempotent');
 assert.equal(f.calls.length,1,'no second issuance on retry');
 const two=await f.manager.issue(session.token,{kind:'xtream',durationDays:90,
   maxConnections:1,label:'عميل 2',requestId:crypto.randomUUID()});
 assert.equal(two.credentials.username,'reseller_generated');
 assert.equal(f.calls[1].data.sourceId,null);
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
   maxConnections:10,requestId:crypto.randomUUID()}),/distributor_connections_invalid/);
 await assert.rejects(f.manager.issue(login.token,{kind:'app',durationDays:0,
   maxConnections:1,requestId:crypto.randomUUID()}),/distributor_days_invalid/);
});
