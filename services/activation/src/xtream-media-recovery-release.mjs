// Production recovery eligibility for already authenticated BLOFY viewers.
// The gateway checks subscriber validity, catalog ownership/visibility and
// source server status before invoking this helper. This is NOT authentication.
// Recovery reconnects only to exactly the same upstream media URL and never
// increases the subscriber's content permissions.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function authorizedMediaRecoveryRelease({
 enabled=false,accountId,sourceId,serverEnabled=false,
 method='GET',kind
}={}){
 return enabled===true&&method==='GET'&&serverEnabled===true&&
  ['live','movie','series'].includes(kind)&&
  [accountId,sourceId].every(x=>typeof x==='string'&&UUID.test(x));
}
