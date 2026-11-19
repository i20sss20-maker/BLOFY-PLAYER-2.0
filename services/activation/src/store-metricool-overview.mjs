// Read-only Metricool API overview for the authenticated BLOFY STORE PRO owner.
// Metricool MCP in ChatGPT and the paid API are separate connections. This
// server module never auto-publishes, updates, deletes or schedules a post.
const PATH='/api/v1/admin/store/metricool';
const NETWORKS=new Set(['tiktok','instagram','twitter','facebook','linkedin','youtube']);
const BODY_LIMIT=450_000;
const NO_CACHE={
 'cache-control':'no-store, private',
 'pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'
};
const id=v=>/^\d{3,15}$/.test(String(v||''))?String(v):null;
export function storeMetricoolConfig(env=process.env){
 const token=String(env.BLOFY_METRICOOL_API_TOKEN||'').trim();
 const userId=id(env.BLOFY_METRICOOL_USER_ID);
 const blogId=id(env.BLOFY_METRICOOL_BLOG_ID);
 const enabled=env.BLOFY_METRICOOL_API_ENABLED==='true';
 return {enabled,configured:enabled&&token.length>=24&&!!userId&&!!blogId,
   userId,blogId,token};
}
function riyadhLocal(date){
 const ms=date instanceof Date?date.getTime():Number(date);
 if(!Number.isFinite(ms))throw Error('invalid_timestamp');
 return new Date(ms+3*60*60*1000).toISOString().slice(0,19);
}
export function metricoolScheduledPosts(raw,limit=70){
 // Explicit projection prevents provider secrets or private metadata from
 // reaching the owner UI; provider network statuses are not conflated with sales.
 const rows=Array.isArray(raw?.data)?raw.data:
   Array.isArray(raw?.data?.items)?raw.data.items:
   Array.isArray(raw?.items)?raw.items:Array.isArray(raw)?raw:[];
 const sanitized=[];
 for(const row of rows){
  if(!row||typeof row!=='object'||row.draft===true)continue;
  const networks=Array.isArray(row.providers)?row.providers
   .filter(p=>NETWORKS.has(String(p?.network||'').toLowerCase()))
   .map(p=>({
    network:String(p.network).toLowerCase(),
    status:String(p.status||'UNKNOWN').toUpperCase().slice(0,24)
   })):[];
  if(!networks.length)continue;
  const text=String(row.text||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,180);
  const date=String(row.publicationDate?.dateTime||'').slice(0,19);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(date))continue;
  sanitized.push({
   date,networks,mediaAttached:Array.isArray(row.media)&&row.media.length>0,
   preview:text,
   reviewFlags:/\biptv\b/i.test(text)?['avoid_iptv_keyword']:[],
   draft:false
  });
  if(sanitized.length>=limit)break;
 }
 const platformCount={tiktok:0,instagram:0,twitter:0,facebook:0,linkedin:0,youtube:0};
 for(const post of sanitized){
  for(const network of new Set(post.networks.map(x=>x.network)))platformCount[network]++;
 }
 return {items:sanitized,platformCount,totalReturned:rows.length,
  truncated:rows.length>sanitized.length};
}
export function createStoreMetricoolOverview({
 json,authorizeAdmin,fetchImpl=globalThis.fetch,env=process.env,clock=Date.now
}={}){
 if(typeof json!=='function'||typeof authorizeAdmin!=='function'||
    typeof fetchImpl!=='function')throw Error('metricool_dependencies_invalid');
 const config=storeMetricoolConfig(env);
 return async function handler(req,res,url){
  if(url.pathname!==PATH)return false;
  // Owner auth is mandatory even when the API integration is disabled.
  if(!authorizeAdmin(req,res))return true;
  if(req.method!=='GET'){
   json(res,405,{ok:false,error:'method_not_allowed'},{...NO_CACHE,allow:'GET'});
   return true;
  }
  if(!config.configured){
   json(res,200,{ok:true,provider:'metricool',mode:'manual',
    apiConfigured:false,readOnly:true,scheduled:null,
    note:'لم يُفعّل API الرسمي في الخادم. ربط Metricool عبر ChatGPT منفصل عن الموقع.'},NO_CACHE);
   return true;
  }
  const start=riyadhLocal(clock()),end=riyadhLocal(clock()+30*24*60*60*1000);
  const target=new URL('https://app.metricool.com/api/v2/scheduler/posts');
  target.searchParams.set('userId',config.userId);
  target.searchParams.set('blogId',config.blogId);
  target.searchParams.set('start',start);
  target.searchParams.set('end',end);
  target.searchParams.set('timezone','Asia/Riyadh');
  try{
   const response=await fetchImpl(target.toString(),{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{'x-mc-auth':config.token,accept:'application/json'}
   });
   if(!response.ok)throw Error('metricool_non_2xx');
   if(Number(response.headers?.get?.('content-length')||0)>BODY_LIMIT)
    throw Error('metricool_response_too_large');
   const raw=await response.text();
   if(Buffer.byteLength(raw,'utf8')>BODY_LIMIT)throw Error('metricool_response_too_large');
   const parsed=JSON.parse(raw);
   if(!Array.isArray(parsed)&&!Array.isArray(parsed?.data)&&
      !Array.isArray(parsed?.data?.items)&&!Array.isArray(parsed?.items))
    throw Error('metricool_invalid_response');
   json(res,200,{
    ok:true,provider:'metricool',mode:'official_api_read_only',
    apiConfigured:true,readOnly:true,windowDays:30,
    scheduled:metricoolScheduledPosts(parsed),
    note:'منشورات مجدولة عبر Metricool فقط. لا تعني نشرًا ناجحًا أو مبيعات منسوبة.'
   },NO_CACHE);
  }catch{
   // Never expose token, provider URL, returned raw data, or provider errors.
   json(res,503,{ok:false,error:'metricool_temporarily_unavailable',
    provider:'metricool',mode:'official_api_read_only',readOnly:true},NO_CACHE);
  }
  return true;
 };
}
