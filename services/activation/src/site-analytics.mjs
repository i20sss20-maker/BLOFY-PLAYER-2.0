// Consent-only, first-party storefront measurement. Nothing is sent before
// visitor approval. Never store IP addresses, raw URLs, cookies, device IDs,
// email, phone, full referrers, Xtream credentials or payment identifiers.
import crypto from 'node:crypto';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';

const PAGES=new Set(['/', '/shop','/products/stream','/products/xtream',
  '/store/offers','/store/about','/store/faq','/store/trial','/store/contact',
  '/store/terms','/guide','/support','/downloads','/releases','/en','/es','/fr']);
const EVENTS=new Set(['page_view','whatsapp_click','trial_click','offer_click',
  'product_click','checkout_click','checkout_started','coupon_check','download_click']);
const DEVICES=new Set(['mobile','tablet','desktop']);
const SAFE_PART=/^[a-z0-9_-]{1,48}$/;
const SESSION=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com']);
const DURATION=new Set([7,30,90]);
export function normalizeAnalyticsPage(input){
  if(typeof input!=='string'||input.length>80)return null;
  const path=input==='/'?'/':input.replace(/\/$/,'');
  return PAGES.has(path)?path:null;
}
export function cleanAnalyticsEvent(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const page=normalizeAnalyticsPage(input.page);
  if(!page||!EVENTS.has(input.event)||!SESSION.test(String(input.sessionId||'')))return null;
  const field=(x,def)=>{
    if(x==null||x==='')return def;
    return typeof x==='string'&&SAFE_PART.test(x)?x:def;
  };
  return {
    event:input.event,page,sessionId:input.sessionId.toLowerCase(),
    source:field(input.source,'direct'),medium:field(input.medium,'none'),
    campaign:field(input.campaign,'none'),
    device:DEVICES.has(input.device)?input.device:'desktop'
  };
}
const rate=createFixedWindowLimiter({limit:600,windowMs:5*60*1000});
const localDay=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
export function createSiteAnalyticsHandlers({pool,json,readJson,authorizeAdmin,keyHex}){
  if(!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))throw Error('site_analytics_key_required');
  let ready,cleanedAt=0,inFlight=0;
  async function schema(){
    if(!ready)ready=(async()=>{
      const db=await pool.connect();
      try{
        await db.query('BEGIN');
        await db.query('SELECT pg_advisory_xact_lock(718420733)');
        await db.query("CREATE TABLE IF NOT EXISTS blofy_site_analytics_sessions ("+
          "day DATE NOT NULL, session_hash CHAR(64) NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
          "PRIMARY KEY(day,session_hash))");
        await db.query("CREATE INDEX IF NOT EXISTS idx_blofy_site_sessions_recent ON blofy_site_analytics_sessions(last_seen_at DESC)");
        await db.query("CREATE TABLE IF NOT EXISTS blofy_site_analytics_daily ("+
          "day DATE NOT NULL,page TEXT NOT NULL,source TEXT NOT NULL,medium TEXT NOT NULL,"+
          "campaign TEXT NOT NULL,device TEXT NOT NULL,event TEXT NOT NULL,hits BIGINT NOT NULL DEFAULT 0,"+
          "PRIMARY KEY(day,page,source,medium,campaign,device,event))");
        await db.query('COMMIT');
      }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
      finally{db.release();}
    })().catch(e=>{ready=null;throw e;});
    return ready;
  }
  async function cleanup(){
    if(Date.now()-cleanedAt<24*3600000)return;
    cleanedAt=Date.now();
    try{
      await pool.query("DELETE FROM blofy_site_analytics_sessions WHERE day < (NOW() AT TIME ZONE 'Asia/Riyadh')::date - 90");
      await pool.query("DELETE FROM blofy_site_analytics_daily WHERE day < (NOW() AT TIME ZONE 'Asia/Riyadh')::date - 90");
    }catch{cleanedAt=0;}
  }
  async function increment(db,e,event){
    await db.query(
      'INSERT INTO blofy_site_analytics_daily(day,page,source,medium,campaign,device,event,hits) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,1) '+
      'ON CONFLICT(day,page,source,medium,campaign,device,event) DO UPDATE SET hits=blofy_site_analytics_daily.hits+1',
      [localDay(),e.page,e.source,e.medium,e.campaign,e.device,event]);
  }
  async function collect(req,res){
    if(!ORIGINS.has(String(req.headers?.origin||''))||
        req.headers?.['sec-fetch-site']==='cross-site')
      return json(res,403,{error:'invalid_origin'});
    if(!String(req.headers?.['content-type']||'').startsWith('application/json'))
      return json(res,415,{error:'json_required'});
    if(!rate.consume(requestClientKey(req)).allowed)
      return json(res,429,{error:'rate_limited'});
    const event=cleanAnalyticsEvent(await readJson(req));
    if(!event)return json(res,400,{error:'invalid_analytics_event'});
    // Nonessential analytics must never exhaust the activation/payment DB pool.
    if(inFlight>=4)return json(res,429,{error:'analytics_busy'});
    inFlight++;
    try {
    await schema();
    const day=localDay();
    const sessionHash=crypto.createHmac('sha256',Buffer.from(keyHex,'hex'))
      .update('blofy-visitor-session-v1:').update(day+':').update(event.sessionId).digest('hex');
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const fresh=await db.query('INSERT INTO blofy_site_analytics_sessions(day,session_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING session_hash',[day,sessionHash]);
      await increment(db,event,event.event);
      if(fresh.rowCount===1)await increment(db,event,'session_start');
      else if(event.event==='page_view')
        await db.query("UPDATE blofy_site_analytics_sessions SET last_seen_at=NOW() WHERE day=$1 AND session_hash=$2 AND last_seen_at<NOW()-INTERVAL '1 minute'",[day,sessionHash]);
      await db.query('COMMIT');
    }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
    finally{db.release();}
    void cleanup();
    return json(res,200,{ok:true});
    }finally{inFlight--;}
  }
  async function dashboard(req,res,url){
    if(!authorizeAdmin(req,res))return;
    const days=Number(url.searchParams.get('days')||7);
    if(!DURATION.has(days))return json(res,400,{error:'invalid_days'});
    await schema();
    const db=await pool.connect();
    try{
    const window="day >= (NOW() AT TIME ZONE 'Asia/Riyadh')::date - ($1::integer - 1)";
    const [overall,series,pages,sources,devices,events,campaigns,active,hasOrders]=await Promise.all([
      db.query('SELECT COALESCE(SUM(hits) FILTER (WHERE event=$2),0)::int AS views,COALESCE(SUM(hits) FILTER (WHERE event=$3),0)::int AS sessions FROM blofy_site_analytics_daily WHERE '+window,[days,'page_view','session_start']),
      db.query("SELECT to_char(day,'YYYY-MM-DD') AS day, COALESCE(SUM(hits) FILTER (WHERE event='page_view'),0)::int AS views,COALESCE(SUM(hits) FILTER (WHERE event='session_start'),0)::int AS sessions FROM blofy_site_analytics_daily WHERE "+window+" GROUP BY day ORDER BY day",[days]),
      db.query("SELECT page,COALESCE(SUM(hits),0)::int AS views FROM blofy_site_analytics_daily WHERE "+window+" AND event='page_view' GROUP BY page ORDER BY views DESC,page LIMIT 15",[days]),
      db.query("SELECT source,medium,COALESCE(SUM(hits),0)::int AS sessions FROM blofy_site_analytics_daily WHERE "+window+" AND event='session_start' GROUP BY source,medium ORDER BY sessions DESC LIMIT 15",[days]),
      db.query("SELECT device,COALESCE(SUM(hits),0)::int AS sessions FROM blofy_site_analytics_daily WHERE "+window+" AND event='session_start' GROUP BY device ORDER BY sessions DESC",[days]),
      db.query("SELECT event,COALESCE(SUM(hits),0)::int AS hits FROM blofy_site_analytics_daily WHERE "+window+" AND event NOT IN ('page_view','session_start') GROUP BY event ORDER BY hits DESC",[days]),
      db.query("SELECT source,campaign,COALESCE(SUM(hits),0)::int AS sessions FROM blofy_site_analytics_daily WHERE "+window+" AND event='session_start' AND campaign<>'none' GROUP BY source,campaign ORDER BY sessions DESC LIMIT 12",[days]),
      db.query("SELECT COUNT(*)::int AS n FROM blofy_site_analytics_sessions WHERE last_seen_at >= NOW()-INTERVAL '5 minutes'"),
      db.query("SELECT to_regclass('public.blofy_store_geidea_orders') IS NOT NULL AS n")
    ]);
    let store={paidOrders:0,revenueMinor:0,byDay:[]};
    if(hasOrders.rows[0]?.n){
      const o=await db.query("SELECT to_char((paid_at AT TIME ZONE 'Asia/Riyadh')::date,'YYYY-MM-DD') AS day,"+
        "COUNT(*)::int AS paid_orders,COALESCE(SUM(amount_minor),0)::bigint AS revenue_minor FROM blofy_store_geidea_orders "+
        "WHERE status='paid' AND paid_at >= ((NOW() AT TIME ZONE 'Asia/Riyadh')::date - ($1::integer - 1))::timestamp AT TIME ZONE 'Asia/Riyadh' "+
        "GROUP BY day ORDER BY day",[days]);
      store.byDay=o.rows;
      store.paidOrders=o.rows.reduce((n,x)=>n+Number(x.paid_orders),0);
      store.revenueMinor=o.rows.reduce((n,x)=>n+Number(x.revenue_minor),0);
    }
    return json(res,200,{
      ok:true,timezone:'Asia/Riyadh',days,source:'consented_first_party',
      disclaimer:'Sessions are consented browser-tab sessions, not unique people; automatic/bot traffic can affect counts.',
      totals:{views:Number(overall.rows[0]?.views||0),sessions:Number(overall.rows[0]?.sessions||0),activeLast5m:Number(active.rows[0]?.n||0),
        paidOrders:store.paidOrders,revenueMinor:store.revenueMinor},
      series:series.rows,pages:pages.rows,sources:sources.rows,devices:devices.rows,
      events:events.rows,campaigns:campaigns.rows,ordersByDay:store.byDay
    });
    }finally{db.release();}
  }
  return async function handler(req,res,url){
    if(req.method==='POST'&&url.pathname==='/api/v1/site-analytics/collect'){
      await collect(req,res);return true;
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/admin/site-analytics/summary'){
      await dashboard(req,res,url);return true;
    }
    return false;
  };
}
