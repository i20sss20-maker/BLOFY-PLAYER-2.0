// Call inside the transaction that already locks the affected order(s). Deleting the
// reservation first makes repeated webhooks and maintenance passes idempotent.
export async function releaseCouponReservations(client, orderIds) {
  const released = await client.query(
    `DELETE FROM coupon_redemptions
     WHERE order_id = ANY($1::uuid[])
     RETURNING code`,
    [orderIds]
  );
  const counts = new Map();
  for (const row of released.rows) {
    const code = String(row.code || '').trim();
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  for (const [code, count] of counts) {
    await client.query(
      `UPDATE coupons
       SET redemption_count=GREATEST(0,redemption_count-$2),updated_at=NOW()
       WHERE code=$1`,
      [code, count]
    );
  }
}

// A provider can confirm payment after checkout cancellation/expiry. Record the
// consumed discount again if its pending reservation was already released.
export async function restorePaidCouponReservation(client, order) {
  if (!order.coupon_code) return;
  const restored = await client.query(
    `INSERT INTO coupon_redemptions(code,device_id,order_id) VALUES($1,$2,$3)
     ON CONFLICT(code,order_id) DO NOTHING RETURNING code`,
    [order.coupon_code, order.device_id, order.id]
  );
  if (restored.rows[0]) {
    await client.query(
      `UPDATE coupons SET redemption_count=redemption_count+1,updated_at=NOW() WHERE code=$1`,
      [order.coupon_code]
    );
  }
}
