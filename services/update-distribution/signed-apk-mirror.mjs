import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {approvedStreamUpload,STREAM_55836_APK,STREAM_56_APK} from './stream-upload-oidc.mjs';

const PINNED=[STREAM_55836_APK,STREAM_56_APK].map(filename=>{
  const pin=approvedStreamUpload(filename);
  if(!pin)throw new Error('apk_mirror_missing_approved_pin');
  return Object.freeze({filename,sha256:pin.sha256,size:pin.bytes});
});
const KNOWN=Object.freeze(PINNED);
const SHA=/^[0-9a-f]{64}$/;
const BUCKET_NAME=/^[a-z0-9][a-z0-9.-]{2,100}$/;

export async function hashLocalApk(filePath){
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(filePath))hash.update(chunk);
  return hash.digest('hex');
}
export function pinnedSignedApks(){return KNOWN.map(x=>({...x}));}

export function mirrorConfigFromEnv(env=process.env){
  const enabled=env.BLOFY_APK_MIRROR_ENABLED==='1';
  const endpoint=String(env.BLOFY_APK_MIRROR_ENDPOINT||'').trim();
  const bucket=String(env.BLOFY_APK_MIRROR_BUCKET||'').trim();
  const region=String(env.BLOFY_APK_MIRROR_REGION||'auto').trim();
  const accessKeyId=String(env.BLOFY_APK_MIRROR_ACCESS_KEY_ID||'').trim();
  const secretAccessKey=String(env.BLOFY_APK_MIRROR_SECRET_ACCESS_KEY||'').trim();
  let validEndpoint=false;
  try{const url=new URL(endpoint);validEndpoint=url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}
  const ready=enabled&&validEndpoint&&BUCKET_NAME.test(bucket)&&
    region.length>0&&region.length<60&&accessKeyId.length>0&&
    secretAccessKey.length>0;
  return {enabled,ready,endpoint,bucket,region,accessKeyId,secretAccessKey,
    forcePathStyle:env.BLOFY_APK_MIRROR_PATH_STYLE==='1'};
}

export async function makeS3MirrorStore(config){
  const [{S3Client,HeadObjectCommand}, {Upload}]=await Promise.all([
    import('@aws-sdk/client-s3'),import('@aws-sdk/lib-storage')
  ]);
  const client=new S3Client({
    region:config.region,endpoint:config.endpoint,
    forcePathStyle:config.forcePathStyle,
    credentials:{accessKeyId:config.accessKeyId,
      secretAccessKey:config.secretAccessKey},
    maxAttempts:2
  });
  const Bucket=config.bucket;
  return {
    async head(Key){
      try{return await client.send(new HeadObjectCommand({Bucket,Key}));}
      catch(error){
        if(error?.$metadata?.httpStatusCode===404||error?.name==='NotFound')
          return null;
        throw error;
      }
    },
    async put({key,filePath,size,sha256}){
      const upload=new Upload({client,
        params:{Bucket,Key:key,Body:createReadStream(filePath),
          ContentLength:size,ContentType:'application/vnd.android.package-archive',
          Metadata:{sha256}},
        queueSize:2,partSize:10*1024*1024,leavePartsOnError:false
      });
      return upload.done();
    },
    close(){client.destroy();}
  };
}

/**
 * Stores only pinned, SHA256-verified owner-signed APK bytes in private S3.
 * This phase is backup-only: NEVER redirects, changes subscriber updates,
 * publishes a release or removes /data/releases. A separate verified
 * cutover is required before S3 is used to deliver customer APKs.
 */
export function createSignedApkMirror({
  config=mirrorConfigFromEnv(),
  localDir='/data/releases',
  fileInfo=stat,
  digest=hashLocalApk,
  storeFactory=makeS3MirrorStore,
  logger=console
}={}){
  const state={enabled:config.enabled===true,ready:config.ready===true,
    mode:'backup_only',checkedAt:null,
    records:Object.fromEntries(KNOWN.map(x=>[x.filename,'not_checked']))};
  let running=null;
  function report(){
    const counts={mirrored:0,missing:0,failed:0,pending:0};
    for(const value of Object.values(state.records)){
      if(value==='mirrored')counts.mirrored++;
      else if(value==='missing')counts.missing++;
      else if(value==='failed'||value==='digest_mismatch')counts.failed++;
      else counts.pending++;
    }
    return {enabled:state.enabled,ready:state.ready,mode:state.mode,
      checkedAt:state.checkedAt,counts,
      // No bucket endpoint, credentials, object URLs or private metadata.
      signedVersions:Object.fromEntries(
        Object.entries(state.records).map(([filename,value])=>
          [filename.includes('56.0-')?'56.0':'55.8.36',value]))};
  }
  async function run(){
    if(!state.enabled||!state.ready)return report();
    if(running)return running;
    const pending=(async()=>{
      let store;
      try{
        store=await storeFactory(config);
        for(const pin of KNOWN){
          const filePath=path.join(localDir,pin.filename);
          try{
            const info=await fileInfo(filePath).catch(e=>{
              if(e?.code==='ENOENT')return null;
              throw e;
            });
            if(!info){state.records[pin.filename]='missing';continue;}
            if(info.size!==pin.size){state.records[pin.filename]='digest_mismatch';continue;}
            if(await digest(filePath)!==pin.sha256){
              state.records[pin.filename]='digest_mismatch';continue;
            }
            const key='signed-apk/sha256/'+pin.sha256+'.apk';
            const matches=head=>Boolean(head&&
              Number(head.ContentLength)===pin.size&&
              head.Metadata?.sha256===pin.sha256);
            let existing=await store.head(key);
            if(!matches(existing)){
              // Never overwrite an existing object that does not match our
              // owner-pinned size and SHA256 metadata. Operator must inspect.
              if(existing){
                state.records[pin.filename]='failed';
                logger.warn?.('BLOFY_APK_MIRROR',JSON.stringify({
                  version:pin.filename.includes('56.0-')?'56.0':'55.8.36',
                  code:'existing_object_conflict'}));
                continue;
              }
              await store.put({key,filePath,size:pin.size,sha256:pin.sha256});
              existing=await store.head(key);
              if(!matches(existing))throw Error('mirror_post_upload_head_mismatch');
            }
            state.records[pin.filename]='mirrored';
          }catch(error){
            state.records[pin.filename]='failed';
            // Never log signed URLs, S3 endpoints or raw SDK exceptions:
            // they may include sensitive bucket names or request headers.
            logger.warn?.('BLOFY_APK_MIRROR',JSON.stringify({
              version:pin.filename.includes('56.0-')?'56.0':'55.8.36',
              code:'replication_failed'}));
          }
        }
      }catch(error){
        logger.warn?.('BLOFY_APK_MIRROR',JSON.stringify({
          code:'storage_connection_unavailable'}));
        for(const pin of KNOWN){
          if(state.records[pin.filename]==='not_checked')
            state.records[pin.filename]='failed';
        }
      }finally{
        try{store?.close?.();}catch{}
        state.checkedAt=new Date().toISOString();
      }
      return report();
    })();
    running=pending;
    try{return await pending;}
    finally{if(running===pending)running=null;}
  }
  return {sync:run,status:report};
}
