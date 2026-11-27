// Operator-controlled maintenance barrier for new requests entering this
// gateway. Does not close already-open streams, other services' tickets or
// provider sockets. Never use this setting alone as proof of free capacity.
export function linodeMaintenanceActive(env=process.env){
 return env.BLOFY_LINODE_MEDIA_MAINTENANCE==='1';
}
export function blocksDuringLinodeMaintenance(path,env=process.env){
 if(!linodeMaintenanceActive(env)||typeof path!=='string')return false;
 return /^\/(live|movie|series|hls)(\/|$)/i.test(path)||
  /^\/api\/v1\/stream\/media\//i.test(path)||
  /^\/api\/v1\/subscribers\/xtream\/(live|movie|series|url|raw)(\/|$)/i.test(path)||
  /^\/internal\/blofy-content-hub\//i.test(path)||
  /^\/api\/v1\/admin\/xtream-gateway\/(playback-probe|episode-delivery-audit|unavailable-media\/recheck(?:-now)?)(\/|$)/i.test(path);
}

// New diagnostic media requests must obey the same maintenance barrier as
// customer ingress. Account/catalog reads intentionally remain available.
export function assertMediaProbeAllowed(env=process.env){
 if(linodeMaintenanceActive(env))throw Object.assign(new Error('xtream_media_maintenance'),{status:503});
}
