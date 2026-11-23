// Direct customer Xtream media-stream watchdog. Once validated live TS
// packets begin, an upstream stall must not hold a client connection open
// for 45 seconds while a player displays a black screen. Preserve longer
// waits for VOD and partial-range transfers. Never creates another provider
// session or changes account permissions.
export function xtreamMediaReadIdleMs(kind){
 if(kind==='live')return 30000;
 if(kind==='movie'||kind==='series')return 45000;
 throw new Error('xtream_media_read_kind_invalid');
}
