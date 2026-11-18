import http from 'node:http';
import {pipeline} from 'node:stream/promises';
import {S3Client,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {SIGNED_APKS,resolveSignedApk,resolveRange,keyOf} from './signed-release-policy.mjs';

const HEADERS={
  'x-content-type-options':'nosniff','x-frame-options':'DENY',
  'x-robots-tag':'noindex','referrer-policy':'no-referrer',
  'strict-transport-security':'max-age=31536000'
};
const noopLog={info(){},warn(){},error(){}};
const errorResponse=(res,code,message,more={})=>{
  if(res.headersSent)return res.destroy();
  const body=JSON.stringify({ok:false,error:message});
  res.writeHead(code,{...HEADERS,'content-type':'application/json',
    'content-length':Buffer.byteLength(body),'cache-control':'no-store',...more});
  res.end(body);
};

export function makePrivateS3(config){
  const client=new S3Client({
    region:config.region,endpoint:config.endpoint,
    forcePathStyle:config.pathStyle,
    credentials:{accessKeyId:config.accessKeyId,
      secretAccessKey:config.secretAccessKey},maxAttempts:2
  });
  const Bucket=config.bucket;
  return {
    head:Key=>client.send(new HeadObjectCommand({Bucket,Key})),
    get:(Key,Range)=>client.send(new GetObjectCommand({
      Bucket,Key,...(Range?{Range}:{})
    })),
    close:()=>client.destroy()
  };
}
export function gatewayConfig(env=process.env){
  const required=['BLOFY_APK_EDGE_ENDPOINT','BLOFY_APK_EDGE_BUCKET',
    'BLOFY_APK_EDGE_ACCESS_KEY_ID','BLOFY_APK_EDGE_SECRET_ACCESS_KEY'];
  if(required.some(name=>!String(env[name]||'').trim()))throw Error('apk_edge_storage_not_configured');
  const endpoint=new URL(env.BLOFY_APK_EDGE_ENDPOINT);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||
    endpoint.hash)throw Error('apk_edge_invalid_storage_endpoint');
  return {
    endpoint:endpoint.toString(),bucket:String(env.BLOFY_APK_EDGE_BUCKET),
    region:String(env.BLOFY_APK_EDGE_REGION||'auto'),
    accessKeyId:String(env.BLOFY_APK_EDGE_ACCESS_KEY_ID),
    secretAccessKey:String(env.BLOFY_APK_EDGE_SECRET_ACCESS_KEY),
    pathStyle:env.BLOFY_APK_EDGE_PATH_STYLE==='1'
  };
}
export function createSignedApkGateway({
  storage,pins=SIGNED_APKS,logger=noopLog,maxActive=48
}={}){
  if(!storage||typeof storage.head!=='function'||typeof storage.get!=='function'||
    !Number.isSafeInteger(maxActive)||maxActive<1||maxActive>256)
    throw Error('apk_edge_invalid_dependencies');
  let ready=false,active=0,checkedAt=null,draining=false;
  const verify=async()=>{
    ready=false;
    for(const pin of pins){
      const head=await storage.head(keyOf(pin));
      if(Number(head?.ContentLength)!==pin.size||
        head?.Metadata?.sha256!==pin.sha256)
        throw Error('apk_edge_verified_object_missing');
    }
    checkedAt=new Date().toISOString();
    ready=true;
    return true;
  };
  const server=http.createServer(async(req,res)=>{
    if(req.url===undefined)return errorResponse(res,400,'invalid_request');
    let url;
    try{url=new URL(req.url,'http://localhost')}catch{
      return errorResponse(res,400,'invalid_request');
    }
    if(url.pathname==='/health'){
      if(req.method!=='GET'&&req.method!=='HEAD')
        return errorResponse(res,405,'method_not_allowed',{allow:'GET, HEAD'});
      const body=JSON.stringify({
        ok:ready&&!draining,service:'blofy-signed-apk-edge',
        mode:'canary_not_customer_cutover',ready,checkedAt,
        capacity:{active,maxActive},files:pins.length
      });
      const status=ready&&!draining?200:503;
      res.writeHead(status,{...HEADERS,'content-type':'application/json',
        'content-length':Buffer.byteLength(body),'cache-control':'no-store'});
      return res.end(req.method==='HEAD'?undefined:body);
    }
    if(!['GET','HEAD'].includes(req.method))
      return errorResponse(res,405,'method_not_allowed',{allow:'GET, HEAD'});
    const pin=resolveSignedApk(url.pathname,pins);
    if(!pin||url.search)return errorResponse(res,404,'not_found');
    if(!ready||draining)return errorResponse(res,503,'storage_not_ready',{'retry-after':'5'});
    if(active>=maxActive)return errorResponse(res,503,'capacity_limited',{'retry-after':'2'});
    const policy=resolveRange(req.headers.range,pin.size);
    if(policy.status===416)
      return errorResponse(res,416,'range_not_satisfiable',{
        'content-range':policy.contentRange,'accept-ranges':'bytes'});
    const etag='"sha256-'+pin.sha256+'"';
    const headers={...HEADERS,
      'content-type':'application/vnd.android.package-archive',
      'content-disposition':'attachment; filename="'+pin.name+'"',
      'accept-ranges':'bytes','content-length':String(policy.length),
      etag,'cache-control':policy.status===206?
        'private, no-store, max-age=0, s-maxage=0':
        'public, max-age=31536000, immutable'
    };
    if(policy.status===206)headers['content-range']=policy.contentRange;
    if(req.method==='HEAD'){
      res.writeHead(policy.status,headers);
      return res.end();
    }
    active++;
    try{
      const range=policy.status===206?'bytes='+policy.start+'-'+policy.end:undefined;
      const stream=await storage.get(keyOf(pin),range);
      const responseStatus=Number(stream.$metadata?.httpStatusCode);
      if(responseStatus!==policy.status||
        Number(stream.ContentLength)!==policy.length||
        (policy.status===206&&stream.ContentRange!==policy.contentRange)||
        !stream.Body||typeof stream.Body.pipe!=='function')
        throw Error('apk_edge_upstream_mismatch');
      res.writeHead(policy.status,headers);
      await pipeline(stream.Body,res);
    }catch(error){
      // Never log credentials, object keys, provider headers or URLs.
      logger.warn?.('BLOFY_APK_EDGE',JSON.stringify({
        code:res.headersSent?'client_or_stream_interrupted':'read_failed'
      }));
      if(!res.headersSent)errorResponse(res,503,'apk_temporarily_unavailable',{'retry-after':'5'});
      else if(!res.destroyed)res.destroy();
    }finally{active=Math.max(0,active-1);}
  });
  server.requestTimeout=0; // Active immutable APK transfers may legitimately take minutes.
  server.headersTimeout=15_000;
  server.keepAliveTimeout=5000;
  server.on('clientError',(_err,socket)=>{
    if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return {server,verify,state:()=>({ready,active,maxActive,checkedAt}),
    drain:()=>{draining=true;server.close();server.closeIdleConnections?.();}};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const config=gatewayConfig();
  const storage=makePrivateS3(config);
  const gateway=createSignedApkGateway({storage,logger:console});
  const port=Number(process.env.PORT||3000);
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw Error('apk_edge_port_invalid');
  gateway.server.listen(port,'0.0.0.0',async()=>{
    try{
      await gateway.verify();
      console.info('BLOFY_APK_EDGE',JSON.stringify({
        ok:true,mode:'canary_not_customer_cutover',pinned:SIGNED_APKS.length
      }));
    }catch{
      console.error('BLOFY_APK_EDGE',JSON.stringify({ok:false,code:'restore_readiness_failed'}));
    }
  });
  const stop=()=>{gateway.drain();setTimeout(()=>process.exit(0),110000).unref?.();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
