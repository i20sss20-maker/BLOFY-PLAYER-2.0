import {signedLinodePlayback} from './linode-signed-hls.mjs';
// Pure contract: caller must reauthenticate the viewer, read session and
// reservation from trusted persistent storage and obtain fresh worker state.
// Does not extend a reservation, open a feed, or wire a public endpoint.
export function renewLinodeSession({session, ...input}={},env=process.env,now=Date.now()){
  const deny=reason=>({ok:false,reason});
  if(env.BLOFY_LINODE_SESSION_RENEWAL!=='1')return deny('disabled');
  const sessionExpiry=Date.parse(session?.expiresAt);
  const reservationExpiry=Date.parse(input.attempt?.expiresAt);
  if(session?.state!=='active'||!Number.isFinite(now)||
     !Number.isFinite(sessionExpiry)||sessionExpiry<=now||
     !Number.isFinite(reservationExpiry)||reservationExpiry<=now)
    return deny('session_not_active');
  const accountId=input.context?.account?.id;
  const sourceId=input.context?.row?.server_id;
  const channelId=input.context?.row?.source_id;
  if((session?.engineId??'linode')!==(input.context?.engineId??'linode')||!accountId||!sourceId||!channelId||
     session.accountId!==accountId||session.sourceId!==sourceId||
     session.channelId!==channelId||!session.requestId||
     session.requestId!==input.requestId||
     !session.reservationId||session.reservationId!==input.attempt?.reservationId||
     !session.generation||session.generation!==input.worker?.generation)
    return deny('session_mismatch');
  const attempt={...input.attempt,expiresAt:new Date(Math.min(sessionExpiry,reservationExpiry)).toISOString()};
  return signedLinodePlayback({...input,attempt},env,now);
}
