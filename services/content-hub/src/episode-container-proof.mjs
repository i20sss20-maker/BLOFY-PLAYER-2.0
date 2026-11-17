// Byte-level first-block check before persistently copying ONE licensed
// episode into private S3. A provider may claim HTTP 206 / video/* while
// returning a full-length HTML/JSON error. No source URLs/credentials exposed.
// Not a decoder, rights verification, nor proof that all video frames work.
const KNOWN=new Set(['mp4','mkv','avi','ts']);
function mp4FtypAtStart(bytes){
  // A leading 'free', 'skip' or 'wide' box before ftyp is legal.
  // Bound parsing to four boxes within the first 4 KiB and never scan
  // arbitrary payload looking for a fake "ftyp" substring.
  let at=0;
  for(let boxes=0;boxes<4&&at+8<=Math.min(bytes.length,4096);boxes++){
    const len=bytes.readUInt32BE(at);
    const name=bytes.toString('ascii',at+4,at+8);
    if(name==='ftyp')return len>=16&&at+len<=bytes.length;
    if(!['free','skip','wide'].includes(name)||
       len<8||len>1024||at+len>bytes.length)break;
    at+=len;
  }
  return false;
}
export function validEpisodeContainerHeader(data,extension){
  const ext=String(extension||'').trim().toLowerCase();
  if(!KNOWN.has(ext))return false;
  const bytes=Buffer.isBuffer(data)?data:
    data instanceof Uint8Array?Buffer.from(data):Buffer.alloc(0);
  if(bytes.length<512)return false;
  if(ext==='mkv')return bytes[0]===0x1a&&bytes[1]===0x45&&
    bytes[2]===0xdf&&bytes[3]===0xa3;
  if(ext==='mp4')return mp4FtypAtStart(bytes);
  if(ext==='avi')return bytes.toString('ascii',0,4)==='RIFF'&&
    bytes.toString('ascii',8,12)==='AVI ';
  // 188-byte MPEG-TS packets; enough consecutive syncs to avoid a random
  // textual error containing a stray 0x47 byte.
  for(const offset of [0,188,376])if(bytes[offset]!==0x47)return false;
  return true;
}
export function strongEpisodeSourceEtag(raw){
  const v=typeof raw==='string'?raw:'';
  if(v.length<3||v.length>140||v.startsWith('W/'))return null;
  // RFC ETag quoted opaque token. No weak etags, CR/LF or unbounded values.
  return /^"[\x21\x23-\x7e]{1,137}"$/.test(v)?v:null;
}
