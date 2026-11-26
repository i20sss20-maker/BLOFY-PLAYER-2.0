// Preserve only bounded, enumerated gateway admission signals.
export function classifyWebMediaAdmission(kind,status,retryAfter){
 const n=typeof retryAfter==='string'&&/^\d{1,2}$/.test(retryAfter)?Number(retryAfter):0;
 const wait=n>=1&&n<=30?n:5;
 if(status===401||(kind==='live'&&status===403))return {status,error:'invalid_session'};
 if(status===404)return {status:kind==='live'?404:502,error:'media_missing'};
 if(kind==='live'&&(status===429||status===503))return {status,error:'live_source_unavailable',retryAfterSeconds:wait};
 if(status>=300&&status<400)return {status:502,error:'media_redirect_unsupported'};
 return {status:502,error:'media_upstream_error'};
}
