// Pure validation for a bounded Xtream account batch. Issuing credentials
// here never increases the number of upstream provider connections.
export function validateBulkAccountRequest(body={},now=Date.now()) {
  const count=Number(body.count??1);
  if(!Number.isInteger(count)||count<1||count>10)
    throw Object.assign(new Error('xtream_gateway_bulk_count_invalid'),{status:400});
  const maxConnections=Number(body.maxConnections??1);
  if(!Number.isInteger(maxConnections)||maxConnections<1||maxConnections>20)
    throw Object.assign(new Error('xtream_gateway_max_connections_invalid'),{status:400});
  if(!body.expiresAt)
    throw Object.assign(new Error('xtream_gateway_expiry_required'),{status:400});
  const expiresAt=new Date(body.expiresAt);
  if(!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=now)
    throw Object.assign(new Error('xtream_gateway_expiry_invalid'),{status:400});
  return {count,maxConnections,expiresAt};
}
