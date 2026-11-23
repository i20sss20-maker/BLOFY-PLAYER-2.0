// MPEG-TS is 188-byte packetized, but HTTP ReadableStream chunks are not.
// A valid source may split its first two TS packets across multiple reads.
// Safely gather only the small initial validation sample without rewriting,
// skipping, replaying or buffering ongoing playback data.
export async function collectXtreamTsFirstPackets(
  first, readMore, {now=Date.now, maxDelayMs=3000, maxReads=8}={}
){
  if(!(first instanceof Uint8Array) || first.byteLength>=376 || first[0]!==0x47)
    return first;
  if(typeof readMore!=='function')throw Error('xtream_ts_probe_invalid_reader');
  const deadline=Number(now())+maxDelayMs;
  const chunks=[first];let size=first.byteLength;
  for(let reads=0;size<376 && reads<maxReads;reads++){
    const remaining=Math.ceil(deadline-Number(now()));
    if(!Number.isFinite(remaining) || remaining<=0)break;
    const next=await readMore(remaining);
    if(next?.done)break;
    if(!(next?.value instanceof Uint8Array))
      throw Error('upstream_empty_media');
    if(next.value.byteLength===0)continue;
    chunks.push(next.value);size+=next.value.byteLength;
  }
  if(size<376)throw Error('upstream_empty_media');
  return Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)),size);
}
