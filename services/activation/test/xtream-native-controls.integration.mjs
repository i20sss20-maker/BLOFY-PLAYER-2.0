// End-to-end integration with the real service and isolated CI PostgreSQL.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const origin=String(process.env.BLOFY_SMOKE_BASE_URL||'http://127.0.0.1:8080').replace(/\/$/,'');
if(!/^(http:\/\/127\.0\.0\.1|http:\/\/localhost)(:\d+)?$/.test(origin))
  throw new Error('Native control integration test refuses non-local server');
if(!process.env.DATABASE_URL?.includes('blofy_activation'))
  throw new Error('Native control integration test requires isolated CI database');

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const id=crypto.randomUUID();
const adminToken=process.env.BLOFY_ADMIN_TOKEN;
const root='/api/v1/admin/xtream/controls';
const request=async(method,path,form=null)=>{
  const res=await fetch(origin+path,{
    method,redirect:'manual',
    headers:{authorization:'Bearer '+adminToken,'x-forwarded-proto':'http',
      ...(method==='POST'?{'origin':origin,'content-type':'application/x-www-form-urlencoded'}:{})},
    ...(form==null?{}:{body:new URLSearchParams(form).toString()})
  });
  return res;
};
try{
  // The Xtream catalog schema is created lazily on first authenticated use.
  // The activation /health endpoint does not initialize this separate module.
  const initialized=await request('GET',root);
  assert.equal(initialized.status,200,'Xtream admin schema should initialize on first GET');
  await pool.query('INSERT INTO blofy_xtream_servers(id,name,base_url,username_secret,password_secret,enabled,publish_catalog,priority,status,counts) VALUES ($1,$2,$3,$4,$5,TRUE,FALSE,100,\'unknown\',\'{}\'::jsonb)',
    [id,'Native Form CI Source','https://example.com','test-only-user','test-only-pass']);

  const page=await request('GET',root);
  assert.equal(page.status,200);
  const html=await page.text();
  assert.ok(html.includes('Native Form CI Source'));
  assert.ok(html.includes(root+'/'+id+'/toggle-enabled'));
  assert.ok(!html.includes('<script src='),'Control page must work with JavaScript disabled');

  const pause=await request('POST',root+'/'+id+'/toggle-enabled');
  assert.equal(pause.status,303,'Pause must persist in PostgreSQL before redirect');
  let state=await pool.query('SELECT enabled,publish_catalog FROM blofy_xtream_servers WHERE id=$1',[id]);
  assert.equal(state.rows[0].enabled,false);
  let refresh=await request('GET',root);
  assert.match(await refresh.text(),/Native Form CI Source/);
  assert.ok((await (await request('GET',root)).text()).includes('تفعيل المصدر'));

  const resume=await request('POST',root+'/'+id+'/toggle-enabled');
  assert.equal(resume.status,303);
  state=await pool.query('SELECT enabled FROM blofy_xtream_servers WHERE id=$1',[id]);
  assert.equal(state.rows[0].enabled,true);

  const publish=await request('POST',root+'/'+id+'/toggle-publish');
  assert.equal(publish.status,303);
  state=await pool.query('SELECT publish_catalog FROM blofy_xtream_servers WHERE id=$1',[id]);
  assert.equal(state.rows[0].publish_catalog,true);

  const save=await request('POST',root+'/'+id+'/save',
    {name:'Renamed CI source',baseUrl:'https://example.com',priority:'42'});
  assert.equal(save.status,303);
  state=await pool.query('SELECT name,priority FROM blofy_xtream_servers WHERE id=$1',[id]);
  assert.equal(state.rows[0].name,'Renamed CI source');
  assert.equal(state.rows[0].priority,42);

  const confirm=await request('GET',root+'/'+id+'/confirm-delete');
  assert.equal(confirm.status,200);
  assert.match(await confirm.text(),/تأكيد الحذف النهائي/);
  state=await pool.query('SELECT id FROM blofy_xtream_servers WHERE id=$1',[id]);
  assert.equal(state.rowCount,1,'GET confirmation must not delete the source');

  const refused=await request('POST',root+'/'+id+'/delete',{confirmId:crypto.randomUUID(),ack:'yes'});
  assert.equal(refused.status,303);
  assert.match(refused.headers.get('location')||'',/error=/);
  state=await pool.query('SELECT id FROM blofy_xtream_servers WHERE id=$1',[id]);
  assert.equal(state.rowCount,1,'Invalid confirmation must be harmless');

  const deleted=await request('POST',root+'/'+id+'/delete',{confirmId:id,ack:'yes'});
  assert.equal(deleted.status,303);
  assert.match(deleted.headers.get('location')||'',/ok=deleted/);
  const list=await request('GET','/api/v1/admin/xtream/servers');
  assert.equal(list.status,200);
  const payload=await list.json();
  assert.ok(!payload.items.some(source=>source.id===id),'Deleted source must not reappear after fresh GET');
  refresh=await request('GET',root);
  assert.ok(!(await refresh.text()).includes('Renamed CI source'),'Deleted source must not reappear');
  console.log('BLOFY_NATIVE_CONTROLS_INTEGRATION_OK');
}finally{
  // Isolated CI-only fake source; cleanup worker may have already removed it.
  await pool.query('DELETE FROM blofy_xtream_servers WHERE id=$1',[id]).catch(()=>{});
  await pool.end();
}
