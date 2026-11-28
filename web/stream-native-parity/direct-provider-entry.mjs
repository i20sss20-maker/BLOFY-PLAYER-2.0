// Direct provider entry phase 1: normalize only approved BLOFY Xtream origins.
// No arbitrary URL fetches, browser credentials storage or production routing.
const APPROVED_ORIGINS=new Set(['https://x.blofyplayer.com']);
const forbidden=/[\x00-\x1f\x7f]/;
const error=(code)=>Object.assign(new Error(code),{code});
function credential(value){
 if(typeof value!=='string'||!value.length||value.length>256||forbidden.test(value))throw error('invalid_credentials');
 return value;
}
function parsedUrl(raw){
 if(typeof raw!=='string'||raw.length>2048||forbidden.test(raw)||raw!==raw.trim())throw error('invalid_provider_url');
 let u;try{u=new URL(raw)}catch{throw error('invalid_provider_url')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||!APPROVED_ORIGINS.has(u.origin))throw error('provider_not_approved');
 return u;
}
export function normalizeDirectEntry(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw error('invalid_entry');
 if(input.mode==='xtream'){
  const u=parsedUrl(input.host);
  if(u.pathname!=='/'||u.search)throw error('invalid_provider_url');
  return {origin:u.origin,username:credential(input.username),password:credential(input.password)};
 }
 if(input.mode==='m3u'){
  const u=parsedUrl(input.url);
  // Only the standard Xtream export format can be mapped into an account.
  // Generic M3U needs an independent bounded, authorized playlist parser.
  if(u.pathname!=='/get.php')throw error('unsupported_playlist');
  const keys=new Set(['username','password','type','output']);
  const seen=new Set();
  for(const [key] of u.searchParams){if(!keys.has(key)||seen.has(key))throw error('invalid_playlist_parameters');seen.add(key)}
  const type=u.searchParams.get('type'),output=u.searchParams.get('output');
  if(type&&type!=='m3u_plus'&&type!=='m3u')throw error('unsupported_playlist');
  if(output&&output!=='ts'&&output!=='m3u8')throw error('unsupported_playlist');
  return {origin:u.origin,username:credential(u.searchParams.get('username')),password:credential(u.searchParams.get('password'))};
 }
 throw error('invalid_entry_mode');
}
export function directAccountProbeUrl(entry){
 // Re-validate normalized credentials and construct the path ourselves.
 const v=normalizeDirectEntry({mode:'xtream',host:entry.origin,username:entry.username,password:entry.password});
 const target=new URL('/player_api.php',v.origin);
 target.searchParams.set('username',v.username);target.searchParams.set('password',v.password);
 return target;
}
export function classifyDirectAccount(payload,now=Date.now()){
 const info=payload&&payload.user_info;
 if(!info||!(info.auth===1||info.auth==='1'||info.auth===true)||String(info.status||'').toLowerCase()!=='active')return {ok:false,error:'provider_account_inactive'};
 const raw=info.exp_date;
 const expires=raw===null||raw===''?null:Number(raw);
 if(expires!==null&&(!Number.isFinite(expires)||expires<=0||expires*1000<=now))return {ok:false,error:'provider_account_expired'};
 // Return only sanitized metadata, never username, password or server_info.
 return {ok:true,expiresAt:expires===null?null:expires*1000};
}
