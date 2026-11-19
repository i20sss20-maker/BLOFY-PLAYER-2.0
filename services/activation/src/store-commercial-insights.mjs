// Read-only commercial reporting on the authoritative Geidea order ledger.
// Note: paid totals represent captured order amounts, not page visitors or bank settlements.
const allowedPeriods=new Set([7,30,90]);
export function commercialPeriod(value){
 const n=Number(value??30);
 if(!allowedPeriods.has(n))throw Object.assign(Error('store_report_period_invalid'),{status:400});
 return n;
}
export function buildStoreCommercialReport(statusRows,dailyRows,skuRows,days){
 const byStatus=Object.fromEntries(['paid','pending','failed','cancelled'].map(x=>[x,{orders:0,amountMinor:0}]));
 for(const row of statusRows){
   if(!Object.hasOwn(byStatus,row.status))continue;
   byStatus[row.status]={orders:Number(row.orders||0),amountMinor:Number(row.amount_minor||0)};
 }
 const totalOrders=Object.values(byStatus).reduce((n,v)=>n+v.orders,0);
 const confirmed=byStatus.paid.orders;
 const paidAmountMinor=byStatus.paid.amountMinor;
 const completionPercent=totalOrders>0?Math.round(confirmed/totalOrders*1000)/10:0;
 return {
   ok:true,periodDays:days,currency:'SAR',
   definition:'الحالة الحالية للطلبات المنشأة خلال الفترة؛ الإيراد من الطلبات المؤكدة فقط.',
   metrics:{createdOrders:totalOrders,paidOrders:confirmed,pendingOrders:byStatus.pending.orders,
     failedOrders:byStatus.failed.orders,cancelledOrders:byStatus.cancelled.orders,
     revenueMinor:paidAmountMinor,
     averageOrderMinor:confirmed>0?Math.round(paidAmountMinor/confirmed):0,
     completionPercent},
   byStatus, daily:dailyRows.map(x=>({
     date:String(x.day).slice(0,10),paidOrders:Number(x.paid_orders||0),
     createdOrders:Number(x.created_orders||0),
     revenueMinor:Number(x.revenue_minor||0)
   })),
   productGroups:skuRows.map(x=>({
     sku:x.sku,orders:Number(x.orders||0),revenueMinor:Number(x.revenue_minor||0)
   }))
 };
}
export function createStoreCommercialInsightsHandlers({pool,json,authorizeAdmin}){
 return async (req,res,url)=>{
  if(url.pathname!=='/api/v1/admin/store/insights')return false;
  if(!authorizeAdmin(req,res))return true;
  if(req.method!=='GET'){json(res,405,{error:'method_not_allowed'});return true;}
  try{
   const days=commercialPeriod(url.searchParams?.get('days'));
   const filter="created_at >= NOW() - ($1::int * INTERVAL '1 day')";
   const [status,daily,products]=await Promise.all([
     pool.query("SELECT status,COUNT(*)::int AS orders,"+
       "COALESCE(SUM(amount_minor),0)::bigint AS amount_minor "+
       "FROM blofy_store_geidea_orders WHERE "+filter+" GROUP BY status",[days]),
     pool.query("SELECT to_char((created_at AT TIME ZONE 'Asia/Riyadh')::date,'YYYY-MM-DD') AS day,"+
       "COUNT(*)::int AS created_orders,"+
       "COUNT(*) FILTER (WHERE status='paid')::int AS paid_orders,"+
       "COALESCE(SUM(amount_minor) FILTER (WHERE status='paid'),0)::bigint AS revenue_minor "+
       "FROM blofy_store_geidea_orders WHERE "+filter+
       " GROUP BY (created_at AT TIME ZONE 'Asia/Riyadh')::date ORDER BY day ASC",[days]),
     pool.query("SELECT sku,COUNT(*)::int AS orders,"+
       "COALESCE(SUM(amount_minor),0)::bigint AS revenue_minor "+
       "FROM blofy_store_geidea_orders WHERE "+filter+
       " AND status='paid' GROUP BY sku ORDER BY revenue_minor DESC,orders DESC LIMIT 12",[days])
   ]);
   json(res,200,buildStoreCommercialReport(status.rows,daily.rows,products.rows,days));
  }catch(e){
   if(e.status){json(res,e.status,{error:e.message});return true;}
   throw e;
  }
  return true;
 };
}
