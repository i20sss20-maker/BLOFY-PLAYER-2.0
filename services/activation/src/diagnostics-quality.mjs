// Shared validation for opt-in device QoE samples. Never accept a URL, account,
// stream identifier or client-supplied free text as a performance metric.
export function boundedQualityNumber(value,max){
  if(value===null||value===undefined||value==='')return 0;
  const number=Number(value);
  if(!Number.isFinite(number))return 0;
  return Math.round(Math.max(0,Math.min(number,max)));
}
export function qualitySample(body={}){
  return {
    rebufferCount:boundedQualityNumber(body.rebufferCount,1000),
    rebufferMs:boundedQualityNumber(body.rebufferMs,3600000),
    recoveryCount:boundedQualityNumber(body.recoveryCount,1000)
  };
}
export function qualityHours(value){
  const hours=Number(value);
  return Number.isFinite(hours)&&hours>=1&&hours<=168?Math.floor(hours):24;
}
export function publicQualitySummary(rows){
  return rows.map(row=>({
    kind:String(row.content_kind||'unknown').replace(/[^a-z]/g,'').slice(0,16),
    observations:boundedQualityNumber(row.observations,10000000),
    starts:boundedQualityNumber(row.starts,10000000),
    medianFirstFrameMs:row.p50_ms==null?null:boundedQualityNumber(row.p50_ms,600000),
    p90FirstFrameMs:row.p90_ms==null?null:boundedQualityNumber(row.p90_ms,600000),
    errors:boundedQualityNumber(row.errors,10000000),
    rebufferCount:boundedQualityNumber(row.rebuffer_count,100000000),
    rebufferMs:boundedQualityNumber(row.rebuffer_ms,1000000000),
    recoveryCount:boundedQualityNumber(row.recovery_count,100000000)
  }));
}
