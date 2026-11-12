// Read-only summary of the SOURCE Xtream subscription, not the
// advertised BLOFY code maxConnections (which is a different contract).
// Each code bound to one source currently resolves back to this one
// upstream account. Do NOT silently clone credentials or bypass limits.
const safeCount=n=>{
 if(n===null||n===undefined||n===''||typeof n==='boolean')return null;
 if(typeof n!=='number'&&typeof n!=='string')return null;
 const v=Number(n);
 return Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
};
export function sourceLiveCapacity(accountInfo){
 const account=accountInfo&&typeof accountInfo==='object'?accountInfo:{};
 const maxConnections=safeCount(account.maxConnections);
 const activeConnections=safeCount(account.activeConnections);
 const restreamer=typeof account.isRestreamer==='boolean'?account.isRestreamer:null;
 const outputFormats=Array.isArray(account.allowedOutputFormats)
  ?[...new Set(account.allowedOutputFormats.filter(x=>['ts','m3u8'].includes(x)))]:[];
 const warnings=[];
 if(maxConnections===1)warnings.push('source_single_upstream_connection');
 if(maxConnections===0)warnings.push('source_no_upstream_connections');
 if(maxConnections===null)warnings.push('source_upstream_limit_unknown');
 if(restreamer===false)warnings.push('source_restream_not_authorized');
 if(restreamer===null)warnings.push('source_restream_permission_unverified');
 if(maxConnections!==null&&activeConnections!==null&&activeConnections>=maxConnections)
  warnings.push('source_upstream_at_reported_limit');
 return {maxConnections,activeConnections,restreamer,
  allowedOutputFormats:outputFormats,
  sourceAccountSharedByCodes:true,
  upstreamCapacityIsNotPerCode:true,
  activeConnectionsAreProviderSnapshotOnly:true,
  automaticConnectionSharingEnabled:false,
  warningCodes:warnings};
}
