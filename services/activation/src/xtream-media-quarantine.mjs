// Temporary, reversible source-media quarantine. A missing file on one
// upstream source must never block unrelated channels, sources or customers.
// Quarantine is allowed only after the SAME exact movie/episode produced
// upstream HTTP 404 both on Xtream and in the authenticated source M3U.
export const MEDIA_QUARANTINE_HOURS=6;
export const MEDIA_QUARANTINE_REASON='confirmed_source_media_404';
const ID=/^[a-z0-9._-]{1,128}$/i;

export function canQuarantineXtreamMedia({kind,sourceId,probe}={}){
  return (kind==='movie'||kind==='series')&&ID.test(String(sourceId??''))&&
    probe?.ok===false&&probe.httpStatus===404&&
    probe.m3uRecoveryStatus==='provider_404';
}

export function isQuarantineWarning(reason){
  return reason===MEDIA_QUARANTINE_REASON;
}

export function quarantineMediaWarning(kind,sourceId,{seriesId=null}={}){
  const warning={reason:MEDIA_QUARANTINE_REASON,kind};
  if(kind==='series'){
    warning.episodeSourceId=String(sourceId);
    if(seriesId!=null)warning.seriesSourceId=String(seriesId);
  }else warning.itemSourceId=String(sourceId);
  return warning;
}
