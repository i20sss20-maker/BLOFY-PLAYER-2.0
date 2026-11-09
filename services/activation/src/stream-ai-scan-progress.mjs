// Persistent progress for operator-triggered, rate-limited Gemini catalog
// reviews. This is ANALYSIS progress only: nothing is auto-published.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES=new Set(['live','movie','series']);
export async function ensureAiScanSchema(client){
 await client.query(`CREATE TABLE IF NOT EXISTS blofy_library_ai_scan_batches (
  source_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
  batch_offset INTEGER NOT NULL CHECK(batch_offset>=0 AND batch_offset%12=0),
  items_seen INTEGER NOT NULL CHECK(items_seen>=0 AND items_seen<=12),
  suggested_moves INTEGER NOT NULL CHECK(suggested_moves>=0 AND suggested_moves<=12),
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(source_id,media_type,batch_offset)
 )`);
}
export function validAiScanArgs({sourceId,type,offset,seen,proposed}={}){
 return UUID.test(String(sourceId||''))&&TYPES.has(type)&&
  Number.isInteger(offset)&&offset>=0&&offset<=39996&&offset%12===0&&
  Number.isInteger(seen)&&seen>=1&&seen<=12&&
  Number.isInteger(proposed)&&proposed>=0&&proposed<=seen;
}
export async function recordAiAnalyzedBatch(pool,{sourceId,type,offset,seen,proposed}={}){
 if(!validAiScanArgs({sourceId,type,offset,seen,proposed}))
  return {ok:false,code:'stream_ai_scan_invalid'};
 await pool.query(`INSERT INTO blofy_library_ai_scan_batches
  (source_id,media_type,batch_offset,items_seen,suggested_moves,analyzed_at)
  VALUES($1,$2,$3,$4,$5,NOW())
  ON CONFLICT(source_id,media_type,batch_offset) DO UPDATE SET
    items_seen=EXCLUDED.items_seen,suggested_moves=EXCLUDED.suggested_moves,
    analyzed_at=NOW()`,[sourceId,type,offset,seen,proposed]);
 return {ok:true};
}
export async function getAiScanProgress(pool,{sourceId,type}={}){
 if(!UUID.test(String(sourceId||''))||!TYPES.has(type))
  return {ok:false,code:'stream_ai_selection_invalid'};
 const [catalog,batches]=await Promise.all([
  pool.query(`SELECT COUNT(*)::int AS total FROM blofy_xtream_items
     WHERE server_id=$1 AND media_type=$2 AND enabled=TRUE`,[sourceId,type]),
  pool.query(`SELECT COUNT(*)::int AS batches,
    COALESCE(SUM(items_seen),0)::int AS analyzed,
    COALESCE(SUM(suggested_moves),0)::int AS suggestions,
    COALESCE(MAX(batch_offset),-12)::int AS last_offset
    FROM blofy_library_ai_scan_batches WHERE source_id=$1 AND media_type=$2`,[sourceId,type])
 ]);
 const total=Number(catalog.rows[0]?.total||0);
 const analyzed=Number(batches.rows[0]?.analyzed||0);
 const examinedBatches=Number(batches.rows[0]?.batches||0);
 const suggested=Number(batches.rows[0]?.suggestions||0);
 const lastOffset=Number(batches.rows[0]?.last_offset??-12);
 return {ok:true,sourceId,type,totalItems:total,analyzedItems:analyzed,
  analyzedBatches:examinedBatches,suggestedMoves:suggested,
  estimatedPercent:total?Math.min(100,Math.round(Math.min(analyzed,total)*100/total)):0,
  nextSuggestedOffset:lastOffset>=0?lastOffset+12:0,
  scope:'operator_initiated_analysis_only',
  complete:false,
  note:'نسبة تقريبية للعناصر التي أُرسلت لتحليل AI على دفعات، ولا تعني اعتماد التصنيف أو تحديث أجهزة العملاء. إذا تغير المصدر بالمزامنة قد تتغير الدقة.'};
}
