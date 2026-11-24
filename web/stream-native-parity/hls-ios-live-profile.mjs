/* Native Apple HLS uses the platform decoder, not Android ExoPlayer.
 * An iPhone-specific start hint leaves a little live-window margin during
 * Wi-Fi jitter without changing the shared FFmpeg producer or TV sessions.
 * This is a preference from RFC 8216, NOT a guaranteed latency setting. */
export function preferAppleLiveStart(manifest,userAgent){
 if(typeof manifest!=='string'||manifest.length>65536||
    !/\b(?:iPhone|iPad|iPod)\b/i.test(String(userAgent||''))||
    !/^#EXTM3U(?:\r?\n)/.test(manifest)||
    !/^#EXT-X-MEDIA-SEQUENCE:\d+\s*$/m.test(manifest)||
    /^#EXT-X-(?:ENDLIST|PLAYLIST-TYPE|START):/m.test(manifest))return manifest;
 const target=manifest.match(/^#EXT-X-TARGETDURATION:(\d+)\s*$/m);
 const td=target?Number(target[1]):0;
 if(!(td>=1&&td<=10))return manifest;
 let duration=0,segments=0;
 const regex=/^#EXTINF:(\d+(?:\.\d+)?)(?:,|\s*$)/gm;
 let match;
 while((match=regex.exec(manifest))!==null){
  const d=Number(match[1]);
  if(!Number.isFinite(d)||d<=0||d>30)return manifest;
  duration+=d;segments++;
 }
 if(segments<5||duration<Math.max(7,4*td))return manifest;
 // Stay at least three target durations behind the edge (RFC 8216).
 const setback=Math.min(6,Math.floor((duration-td)*10)/10);
 if(setback<Math.max(4,3*td))return manifest;
 return manifest.replace(/^#EXTM3U\r?\n/,
  '$&#EXT-X-START:TIME-OFFSET=-'+setback.toFixed(1)+',PRECISE=NO\n')
}
