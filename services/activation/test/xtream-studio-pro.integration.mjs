// Isolated CI integration: real Postgres, real admin API and safe rollback.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
const host=String(process.env.BLOFY_SMOKE_BASE_URL||'');
if(!/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+$/.test(host))
  throw new Error('Studio Pro integration refuses non-local server');
if(!String(process.env.DATABASE_URL||'').includes('blofy_activation'))
  throw new Error('Studio Pro integration requires isolated CI database');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const sourceId=crypto.randomUUID();
const prefix='/api/v1/admin/xtream/pro/';
const request=async(method,path,body)=>{
  const response=await fetch(host+prefix+path,{
    method,headers:{authorization:'Bearer '+process.env.BLOFY_ADMIN_TOKEN,
      ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  let data={};try{data=await response.json()}catch{}
  return{status:response.status,data};
};
try{
  await fetch(host+'/api/v1/admin/xtream/servers',{headers:{
    authorization:'Bearer '+process.env.BLOFY_ADMIN_TOKEN
  }});
  await db.query('INSERT INTO blofy_xtream_servers(id,name,base_url,username_secret,password_secret,enabled,publish_catalog) VALUES($1,$2,$3,$4,$5,TRUE,FALSE)',
    [sourceId,'Studio Pro CI Only','https://example.com','ci-not-real','ci-not-real']);
  for(const category of ['news','sports']){
    await db.query("INSERT INTO blofy_xtream_categories(server_id,media_type,source_category_id,name,enabled,sort_order) VALUES($1,'live',$2,$3,TRUE,100000)",
      [sourceId,category,category.toUpperCase()]);
  }
  for(const id of ['101','102']){
    await db.query("INSERT INTO blofy_xtream_items(server_id,media_type,source_id,category_id,name,enabled) VALUES($1,'live',$2,$3,$4,TRUE)",
      [sourceId,id,id==='101'?'news':'sports','CI Channel '+id]);
  }
  const overview=await request('GET','overview?serverId='+sourceId);
  assert.equal(overview.status,200,JSON.stringify(overview.data));
  assert.equal(overview.data.source.name,'Studio Pro CI Only');

  const wrong=await request('POST','bulk',{serverId,mediaType:'live',ids:['101','missing'],action:'hide'});
  assert.equal(wrong.status,409,'Atomic action rejects missing IDs');
  let items=await db.query("SELECT source_id,enabled,featured FROM blofy_xtream_items WHERE server_id=$1 ORDER BY source_id",[sourceId]);
  assert.equal(items.rows.every(x=>x.enabled),true,'Failed batch left catalog unchanged');

  const feature=await request('POST','bulk',{serverId,mediaType:'live',ids:['101','102'],action:'feature'});
  assert.equal(feature.status,200,JSON.stringify(feature.data));
  assert.equal(feature.data.updated,2);
  const number=await request('POST','bulk',{serverId,mediaType:'live',ids:['101','102'],action:'renumber',startNumber:501});
  assert.equal(number.status,200,JSON.stringify(number.data));
  const hide=await request('POST','bulk',{serverId,mediaType:'live',ids:['102'],action:'hide'});
  assert.equal(hide.status,200,JSON.stringify(hide.data));
  items=await db.query("SELECT source_id,enabled,featured,channel_number FROM blofy_xtream_items WHERE server_id=$1 ORDER BY source_id",[sourceId]);
  assert.deepEqual(items.rows.map(x=>x.channel_number),[501,502]);
  assert.equal(items.rows[0].featured,true);
  assert.equal(items.rows[1].enabled,false);

  const snapshot=await request('POST','snapshots',{serverId,label:'Before CI changes'});
  assert.equal(snapshot.status,201,JSON.stringify(snapshot.data));
  const read=await request('GET','snapshots?serverId='+sourceId);
  assert.equal(read.status,200);
  assert.ok(read.data.items.some(x=>x.id===snapshot.data.id));
  const reset=await request('POST','bulk',{serverId,mediaType:'live',ids:['101','102'],action:'unfeature'});
  assert.equal(reset.status,200);
  const show=await request('POST','bulk',{serverId,mediaType:'live',ids:['102'],action:'show'});
  assert.equal(show.status,200);
  const restore=await request('POST','snapshots/'+snapshot.data.id+'/restore',{serverId});
  assert.equal(restore.status,200,JSON.stringify(restore.data));
  items=await db.query("SELECT enabled,featured,channel_number FROM blofy_xtream_items WHERE server_id=$1 ORDER BY source_id",[sourceId]);
  assert.equal(items.rows[1].enabled,false,'Restore preserved hidden state');
  assert.equal(items.rows[0].featured,true,'Restore preserved featured state');
  assert.deepEqual(items.rows.map(x=>x.channel_number),[501,502]);

  const collection=await request('POST','collections',{serverId,name:'CI SPORTS',
    mediaType:'live',itemIds:['101','102']});
  assert.equal(collection.status,201,JSON.stringify(collection.data));
  const lists=await request('GET','collections?serverId='+sourceId);
  assert.equal(lists.status,200);
  assert.ok(lists.data.items.some(x=>x.id===collection.data.id));
  const deleted=await request('DELETE','collections/'+collection.data.id+'?serverId='+sourceId);
  assert.equal(deleted.status,200);

  const schedule=await request('PUT','schedule/'+sourceId,{enabled:true,intervalHours:24,
    types:['live']});
  assert.equal(schedule.status,200,JSON.stringify(schedule.data));
  assert.equal(schedule.data.enabled,true);
  assert.ok(Date.parse(schedule.data.nextRunAt)>Date.now(),'No immediate provider sync');
  const disabled=await request('PUT','schedule/'+sourceId,{enabled:false,
    intervalHours:24,types:['live']});
  assert.equal(disabled.status,200);
  assert.equal(disabled.data.enabled,false);
  const epgInvalid=await request('GET','epg?serverId='+sourceId+'&sourceId=INVALID%2FID');
  assert.equal(epgInvalid.status,400,'EPG refuses malformed source path');

  const source=await db.query('SELECT base_url,username_secret,password_secret,publish_catalog FROM blofy_xtream_servers WHERE id=$1',[sourceId]);
  assert.equal(source.rows[0].base_url,'https://example.com');
  assert.equal(source.rows[0].username_secret,'ci-not-real');
  assert.equal(source.rows[0].publish_catalog,false);
  console.log('BLOFY_STUDIO_PRO_INTEGRATION_OK');
}finally{
  for(const [table,key] of [
    ['blofy_xtream_studio_schedules','server_id'],
    ['blofy_xtream_studio_snapshots','server_id'],
    ['blofy_xtream_studio_events','server_id'],
    ['blofy_xtream_studio_collections','server_id']
  ])await db.query('DELETE FROM '+table+' WHERE '+key+'=$1',[sourceId]).catch(()=>{});
  await db.query('DELETE FROM blofy_xtream_servers WHERE id=$1',[sourceId]).catch(()=>{});
  await db.end();
}
