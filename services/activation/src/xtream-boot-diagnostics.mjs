// Bounded, read-only, one-shot diagnosis from the same Railway runtime.
// Never log provider endpoints, tokens, account info or response contents.
export async function runXtreamBootDiagnostics({
  rows,probe,log,maxSources=4,wait=async()=>{},spacingMs=750
}={}){
  if(!Array.isArray(rows)||typeof probe!=='function'||typeof log!=='function'
     ||!Number.isInteger(maxSources)||maxSources<1||maxSources>4)
    throw new Error('xtream_boot_diag_invalid_options');
  const selected=rows.filter(x=>x&&x.enabled===true).slice(0,maxSources);
  const results=[];
  for(let i=0;i<selected.length;i++){
    if(i)await wait(spacingMs);
    const source=selected[i];
    const id=typeof source.id==='string'&&/^[0-9a-f-]{36}$/i.test(source.id)
      ?source.id:'not-available';
    try{
      const result=await probe(source);
      const report={
        sourceId:id,
        stage:'xtream_account_api',
        code:typeof result?.code==='string'&&/^xtream_[a-z0-9_]{3,70}$/.test(result.code)
          ?result.code:'xtream_connection_unknown',
        playbackVerified:false
      };
      log(report);
      results.push(report);
    }catch{
      const report={sourceId:id,stage:'xtream_account_api',
        code:'xtream_connection_unknown',playbackVerified:false};
      log(report);
      results.push(report);
    }
  }
  return results;
}
