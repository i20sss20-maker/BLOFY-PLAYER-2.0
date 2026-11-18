// Diagnostics for Resend login-email failures. Never logs OTP, mailbox or API token.
const ERROR_CODES=new Set([
 'invalid_api_key','validation_error','restricted_access','rate_limit_exceeded',
 'daily_quota_exceeded','domain_not_verified','invalid_from_address',
 'missing_required_parameter','application_error','not_found'
]);
export function classifyResendFailure(httpStatus,body){
 const code=ERROR_CODES.has(String(body?.name||body?.code||''))
  ?String(body.name||body.code):'provider_error';
 const message=String(body?.message||'').toLowerCase().slice(0,500);
 if(httpStatus===401||code==='invalid_api_key'||/invalid api key|api key is invalid/.test(message))
  return {clientCode:'customer_email_key_invalid',reason:'invalid_api_key'};
 if(/domain.*not verified|not verified.*domain|verify.*domain|domain is not verified/.test(message)||
   code==='domain_not_verified')
  return {clientCode:'customer_email_domain_unverified',reason:'domain_unverified'};
 if(/only send.*your own|only send.*testing|test.*only|resend\.dev.*verified|not allowed to send|sending access|permission|restricted/.test(message)||
    code==='restricted_access')
  return {clientCode:'customer_email_sender_restricted',reason:'sender_restricted'};
 if(httpStatus===429||code==='rate_limit_exceeded'||code==='daily_quota_exceeded')
  return {clientCode:'customer_email_provider_rate_limited',reason:'provider_rate_limit'};
 if(httpStatus===422||code==='validation_error'||code==='invalid_from_address')
  return {clientCode:'customer_email_sender_invalid',reason:'sender_configuration_invalid'};
 return {clientCode:'customer_email_unavailable',reason:httpStatus>=500?'provider_unavailable':'provider_rejected'};
}
export function resendSenderDomain(from){
 const match=String(from||'').match(/(?:<|^)[^<>\s@]+@([a-z0-9.-]+)(?:>|$)/i);
 return match?.[1]?.toLowerCase()||null;
}
export async function checkResendSender({mailKey,mailFrom,fetchImpl=globalThis.fetch}){
 const senderDomain=resendSenderDomain(mailFrom);
 if(!mailKey?.startsWith('re_')||!senderDomain)
  return {status:'invalid_config',domain:senderDomain};
 try{
  const response=await fetchImpl('https://api.resend.com/domains?limit=100',{
   method:'GET',headers:{authorization:'Bearer '+mailKey},
   signal:AbortSignal.timeout(7000)
  });
  if(response.status===403)return {status:'key_send_only_cannot_inspect',domain:senderDomain};
  // A send-only credential may also be denied access to the domains endpoint.
  // Read-only inspection cannot prove the send permission is invalid.
  // Classify a key as invalid only when the actual email POST rejects it.
  if(response.status===401)return {status:'key_inspection_unauthorized',domain:senderDomain};
  if(!response.ok)return {status:'provider_query_failed',httpStatus:response.status,domain:senderDomain};
  const data=await response.json().catch(()=>({}));
  const domains=Array.isArray(data.data)?data.data:[];
  // Support account-wide full-access keys; never query or return other domains.
  const match=domains.find(d=>String(d?.name||'').toLowerCase()===senderDomain);
  const domainStatus=String(match?.status||'').toLowerCase();
  return {status:!match?'sender_domain_absent':
    domainStatus==='verified'?'verified':'sender_domain_not_verified',
    domain:senderDomain,verificationStatus:match?domainStatus:undefined};
 }catch{return {status:'provider_probe_unavailable',domain:senderDomain};}
}
