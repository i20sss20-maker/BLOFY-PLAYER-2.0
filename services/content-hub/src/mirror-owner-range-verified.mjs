// Owner-only, pre-response SHA guard for already VERIFIED mirror manifests.
// Unlike a HEAD size check, this reads and hashes the EXACT private-S3
// part bytes before sending ANY part of a requested playback range.
// Never contacts Xtream or exposes an S3 URL, token or stored object key.
import {createHash} from 'node:crypto';

const CHUNK=8*1024*1024;
const MAX_FETCH=2*CHUNK;
const VALID_KEY=/^saleh\/(movie|episode)\/[a-f0-9-]{36}\/batch_[a-f0-9]{24}_part_[0-9]{6}\.(?:mkv|mp4|ts|avi)$/;
const HEX=/^[a-f0-9]{64}$/;

export async function readIntegrityCheckedMirrorRange({
 storage,saved,mediaKind,from,to,signal
}={}){
 if(!['movie','episode'].includes(mediaKind)||
    saved?.kind!=='chunked'||!Array.isArray(saved.parts)||
    !Number.isSafeInteger(saved.bytes)||saved.bytes<=0||
    !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
    from<0||to<from||to>=saved.bytes||to-from+1>CHUNK)
  throw Error('mirror_private_manifest_or_range_invalid');
 if(signal?.aborted)throw Error('mirror_private_read_cancelled');
 const result=[];
 let covered=0,position=0,partsRead=0;
 for(const part of saved.parts){
  if(!part||!Number.isSafeInteger(part.bytes)||part.bytes<1||
     part.bytes>CHUNK||typeof part.key!=='string'||
     !VALID_KEY.test(part.key)||!HEX.test(String(part.sha256||''))||
     !part.key.startsWith('saleh/'+mediaKind+'/'))
   throw Error('mirror_private_manifest_invalid');
  const begin=position,end=position+part.bytes-1;
  if(end>=from&&begin<=to){
   const stream=await storage.readVerifiedRange({
    key:part.key,from:0,to:part.bytes-1,
    expectedBytes:part.bytes,signal
   });
   const pieces=[];
   let length=0;
   const hash=createHash('sha256');
   try{
    for await(const value of stream){
     if(signal?.aborted)throw Error('mirror_private_read_cancelled');
     if(!value||value.byteLength<1||length+value.byteLength>part.bytes)
      throw Error('mirror_private_read_short_or_overlong');
     length+=value.byteLength;
     const bytes=Buffer.from(value);
     pieces.push(bytes);hash.update(bytes);
    }
    if(length!==part.bytes)
     throw Error('mirror_private_read_short_or_overlong');
    if(hash.digest('hex')!==part.sha256)
     throw Error('mirror_private_sha256_mismatch');
    const bytes=Buffer.concat(pieces,part.bytes);
    const left=Math.max(0,from-begin);
    const right=Math.min(part.bytes-1,to-begin);
    result.push(bytes.subarray(left,right+1));
    covered+=right-left+1;
    partsRead++;
   }finally{
    stream?.destroy?.();
   }
  }
  position+=part.bytes;
  if(position>saved.bytes||partsRead>2)
   throw Error('mirror_private_manifest_invalid');
 }
 if(position!==saved.bytes||covered!==to-from+1||partsRead<1||
    partsRead>2||covered>MAX_FETCH)
  throw Error('mirror_private_manifest_incomplete');
 return {bytes:Buffer.concat(result,covered),partsVerified:partsRead,
  sourceRequests:0,customerCutover:false};
}
