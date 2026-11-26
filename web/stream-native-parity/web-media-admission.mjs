// Preserve only bounded, enumerated gateway admission signals.
export function classifyWebMediaAdmission(status,retryAfter){
 const n=typeof retryAfter==='string'&&/^\d{1,2}$/.test(retryAfter)?Number(retryAfter):0;
 const wait=n>=1&&n<=30?n:5;
 if(status===401||status===403)return {status,error:'invalid_session'};
 if(status===404)return {status:404,error:'media_missing'};
 if(status===429)return {status:429,error:'media_upstream_busy',retryAfterSeconds:wait};
 if(status===503)return {status:503,error:'hls_origin_backoff',retryAfterSeconds:wait};
 if(status>=300&&status<400)return {status:502,error:'media_redirect_unsupported'};
 return {status:502,error:'media_upstream_error'};
}
