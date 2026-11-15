// Optional BLOFY STREAM Arabic live-audio sidecars. No changes to the
// Xtream sources, existing subscriber media routes, or device/code binding.
import crypto from 'node:crypto';

const LABEL_LIMIT=80;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL=/^[1-9][0-9]{0,14}$/;
const URL_MAX=1600;
const MAX_DELAY=30;

function invalid(code='arabic_audio_invalid_request'){
  return Object.assign(new Error(code),{status:400});
}
function sourceHosts(value){
  return new Set(String(value||'').split(',').map(s=>s.trim().toLowerCase())
    .filter(s=>/^[a-z0-9.-]{4,200}$/.test(s)&&s.includes('.')&&!s.endsWith('.')));
}
export function permittedArabicAudioUrl(sourceUrl,allowedHosts){
  if(typeof sourceUrl!=='string'||sourceUrl.length>URL_MAX)return false;
  let url;
  try{url=new URL(sourceUrl)}catch{return false}
  return url.protocol==='https:'&&url.port===''&&
    !url.username&&!url.password&&!url.hash&&url.pathname!=='/'&&
    allowedHosts.has(url.hostname.toLowerCase())&&
    !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(url.hostname);
}
function secret(keyHex){
  if(!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))throw Error('arabic_audio_seal_key_missing');
  return crypto.hkdfSync('sha256',Buffer.from(keyHex,'hex'),Buffer.alloc(0),
    Buffer.from('BLOFY-STREAM-ARABIC-AUDIO-V1'),32);
}
export function sealArabicAudioUrl(sourceUrl,keyHex){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',secret(keyHex),iv);
  const encrypted=Buffer.concat([cipher.update(sourceUrl,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function openArabicAudioUrl(sealed,keyHex){
  const payload=Buffer.from(String(sealed||''),'base64url');
  if(payload.length<29)throw Error('arabic_audio_seal_invalid');
  const decipher=crypto.createDecipheriv('aes-256-gcm',secret(keyHex),payload.subarray(0,12));
  decipher.setAuthTag(payload.subarray(12,28));
  return Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]).toString('utf8');
}
function cleanChannel(value){
  const v=String(value??'');
  if(!CHANNEL.test(v))throw invalid('arabic_audio_channel_invalid');
  return v;
}
function safeLabel(value){
  const v=String(value??'').trim();
  if(v.length<2||v.length>LABEL_LIMIT||/[\x00-\x1f]/.test(v))
    throw invalid('arabic_audio_label_invalid');
  return v;
}
function safeDelay(value){
  const n=Number(value??0);
  if(!Number.isInteger(n)||n<0||n>MAX_DELAY)throw invalid('arabic_audio_delay_invalid');
  return n;
}

export function createStreamArabicAudioRegistry({
  pool,keyHex,allowedSourceHosts='',enabled=false
}={}){
  const hosts=sourceHosts(allowedSourceHosts);
  let ready=null;
  async function ensureReady(){
    if(!enabled)throw Object.assign(new Error('arabic_audio_not_enabled'),{status:503});
    if(!ready){
      ready=pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_arabic_audio (
          id UUID PRIMARY KEY,
          channel_id BIGINT NOT NULL,
          label TEXT NOT NULL,
          sealed_source_url TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'progressive'
            CHECK(format IN ('progressive')),
          delay_seconds INTEGER NOT NULL DEFAULT 0
            CHECK(delay_seconds BETWEEN 0 AND 30),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`).catch(error=>{ready=null;throw error});
    }
    await ready;
  }
  async function register(body={}){
    await ensureReady();
    const channelId=cleanChannel(body.channelId);
    const label=safeLabel(body.label);
    const delaySeconds=safeDelay(body.delaySeconds);
    if(body.confirmAuthorizedAudio!==true)
      throw invalid('arabic_audio_rights_confirmation_required');
    if(!permittedArabicAudioUrl(body.sourceUrl,hosts))
      throw invalid('arabic_audio_source_not_approved');
    const id=crypto.randomUUID();
    const sealed=sealArabicAudioUrl(body.sourceUrl,keyHex);
    await pool.query(`INSERT INTO blofy_stream_arabic_audio
      (id,channel_id,label,sealed_source_url,delay_seconds)
      VALUES($1,$2,$3,$4,$5)`,[id,channelId,label,sealed,delaySeconds]);
    // Return no storage URL, tokens, source query strings or account identities.
    return {id,channelId,label,delaySeconds,format:'progressive',enabled:true};
  }
  async function list(channelId){
    await ensureReady();
    const channel=cleanChannel(channelId);
    const result=await pool.query(`SELECT id,channel_id,label,delay_seconds,format,enabled
      FROM blofy_stream_arabic_audio WHERE channel_id=$1
      ORDER BY created_at ASC LIMIT 20`,[channel]);
    return result.rows.map(r=>({
      id:r.id,channelId:String(r.channel_id),label:r.label,
      delaySeconds:Number(r.delay_seconds),format:r.format,enabled:r.enabled
    }));
  }
  async function catalog(channelId){
    return (await list(channelId)).filter(r=>r.enabled).slice(0,8).map(r=>({
      id:r.id,label:r.label,delaySeconds:r.delaySeconds,format:r.format,
      playbackUrl:'https://blofyplayer.com/api/v1/stream/media/audio/'+r.id
    }));
  }
  async function lookup(id){
    await ensureReady();
    if(!ID.test(String(id)))return null;
    const row=(await pool.query(`SELECT id,channel_id,sealed_source_url,enabled,format
      FROM blofy_stream_arabic_audio WHERE id=$1 LIMIT 1`,[id])).rows[0];
    if(!row||!row.enabled)return null;
    const url=openArabicAudioUrl(row.sealed_source_url,keyHex);
    if(!permittedArabicAudioUrl(url,hosts))return null;
    return {id:row.id,channelId:String(row.channel_id),sourceUrl:url,format:row.format};
  }
  async function remove(id){
    await ensureReady();
    if(!ID.test(String(id)))throw invalid('arabic_audio_id_invalid');
    const result=await pool.query('DELETE FROM blofy_stream_arabic_audio WHERE id=$1',[id]);
    return result.rowCount>0;
  }
  return {register,list,catalog,lookup,remove,configured:()=>enabled&&hosts.size>0};
}
