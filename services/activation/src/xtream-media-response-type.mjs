// Prefer the actual, verified media container over the generic MIME type
// some Xtream servers return. Keep explicit provider MIME types unchanged.
// This only affects the response header; original bytes and Range semantics
// are preserved, with no transcoding or source/account changes.
const VERIFIED_TYPES=Object.freeze({
  mp4:'video/mp4',
  mkv:'video/x-matroska',
  avi:'video/x-msvideo',
  ts:'video/mp2t',
  hls:'application/vnd.apple.mpegurl'
});
const GENERIC_TYPES=new Set(['','application/octet-stream','binary/octet-stream',
  'application/binary','application/x-binary']);

export function verifiedXtreamMediaContentType(advertised,inspection){
  const existing=String(advertised||'').trim();
  if(inspection?.valid!==true)return existing;
  const mime=existing.split(';',1)[0].trim().toLowerCase();
  if(!GENERIC_TYPES.has(mime))return existing;
  return VERIFIED_TYPES[inspection.format]||existing;
}
