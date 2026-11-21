/* Read-only BLOFY PLAYER device-activation order ledger summary.
 * This is NOT payment-provider settlement and NOT STREAM/Xtream checkout.
 * No customer records, card data, order references or secrets leave the server.
 */
export const ONE_SALES_QUERY = `
  SELECT
    COUNT(*)::TEXT AS total_orders,
    COUNT(*) FILTER (WHERE status = 'paid')::TEXT AS paid_orders,
    COUNT(*) FILTER (WHERE status = 'pending')::TEXT AS pending_orders,
    COUNT(*) FILTER (WHERE status = 'failed')::TEXT AS failed_orders,
    COUNT(*) FILTER (WHERE status = 'cancelled')::TEXT AS cancelled_orders,
    COUNT(*) FILTER (WHERE status = 'refunded')::TEXT AS refunded_orders,
    COUNT(*) FILTER (
      WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days'
    )::TEXT AS paid_30d,
    COALESCE(SUM(amount_minor) FILTER (
      WHERE status = 'paid' AND amount_minor > 0
    ),0)::TEXT AS recorded_paid_minor,
    COALESCE(SUM(amount_minor) FILTER (
      WHERE status = 'paid' AND paid_at >= NOW() - INTERVAL '30 days'
      AND amount_minor > 0
    ),0)::TEXT AS paid_30d_minor
  FROM subscription_orders
  WHERE currency = 'SAR'
`;
function count(value) {
  const s=String(value ?? '');
  if (!/^\d{1,20}$/.test(s)) return null;
  const n=Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
function sar(value) {
  const s=String(value ?? '');
  if (!/^\d{1,30}$/.test(s)) return null;
  const minor=BigInt(s);
  return String(minor/100n)+'.'+String(minor%100n).padStart(2,'0');
}
export async function readOneSalesSummary(pool, clock=() => new Date()) {
  const {rows}=await pool.query(ONE_SALES_QUERY);
  if (!Array.isArray(rows) || !rows[0]) throw new Error('one_sales_summary_unavailable');
  const r=rows[0];
  return {
    ok:true,
    scope:'BLOFY_PLAYER_device_activation_orders_only',
    source:'subscription_orders',
    currency:'SAR',
    period:'rolling_30_days',
    calculatedAt:clock().toISOString(),
    orders:{
      total:count(r.total_orders),
      paid:count(r.paid_orders),
      pending:count(r.pending_orders),
      failed:count(r.failed_orders),
      cancelled:count(r.cancelled_orders),
      refunded:count(r.refunded_orders),
      paidLast30Days:count(r.paid_30d)
    },
    value:{
      recordedPaidSar:sar(r.recorded_paid_minor),
      paidLast30DaysSar:sar(r.paid_30d_minor)
    },
    note:'Recorded order statuses only; not bank settlement, profit, fee-adjusted revenue, or STREAM/Xtream sales.'
  };
}
