import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const CHECKOUT_SECRET = String(process.env.BLOFY_PAYMENT_CHECKOUT_SECRET || process.env.BLOFY_PAYMENT_WEBHOOK_SECRET || '').trim();
const RETURN_PATH = '/payment/return';
const CANCEL_PATH = '/payment/cancel';
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
}) : null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function timingSafeEqualHex(left, right) {
  const a = Buffer.from(String(left || '').toLowerCase());
  const b = Buffer.from(String(right || '').toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(order, expiresAtMs) {
  if (!CHECKOUT_SECRET) return '';
  const payload = [
    order.id,
    order.device_id,
    order.plan_key,
    String(order.amount_minor),
    String(order.currency).toUpperCase(),
    String(expiresAtMs)
  ].join('|');
  return crypto.createHmac('sha256', CHECKOUT_SECRET).update(payload, 'utf8').digest('hex');
}

function page(res, status, title, message, state = 'info') {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const accent = state === 'success' ? '#39d98a' : state === 'error' ? '#ff6b81' : '#9d6cff';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;background:#100b18;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center}.card{width:min(520px,88vw);background:#1c1328;border:1px solid #3a2850;border-radius:24px;padding:32px;text-align:center;box-shadow:0 20px 70px #0008}.dot{width:66px;height:66px;border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;background:${accent}22;color:${accent};font-size:34px;font-weight:800}.brand{color:#b996ff;font-weight:800;letter-spacing:.08em}.muted{color:#b9acc9;line-height:1.6}.hint{margin-top:22px;padding-top:18px;border-top:1px solid #352545;color:#8f829e;font-size:14px}</style></head><body><main class="card"><div class="brand">BLOFY PLAYER</div><div class="dot">${state === 'success' ? '✓' : state === 'error' ? '!' : '•'}</div><h1>${safeTitle}</h1><p class="muted">${safeMessage}</p><div class="hint">You can return to BLOFY PLAYER now. The app will refresh your subscription automatically.</div></main></body></html>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  res.end(html);
}

async function loadOrder(orderId) {
  if (!pool || !/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const result = await pool.query(
    `SELECT id,device_id,plan_key,status,amount_minor,currency,created_at,paid_at,coupon_code
     FROM subscription_orders WHERE id=$1 LIMIT 1`,
    [orderId]
  );
  return result.rows[0] || null;
}

/**
 * A signed cancel return is authoritative only for an order that is still pending. Cancel it and
 * release the coupon reservation in one transaction so abandoned checkouts cannot consume a
 * limited promotion indefinitely. Paid/refunded/failed orders are never rewritten here.
 */
async function cancelPendingOrder(order) {
  if (!pool || !order || order.status !== 'pending') return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cancelled = await client.query(
      `UPDATE subscription_orders SET status='cancelled',updated_at=NOW()
       WHERE id=$1 AND status='pending'
       RETURNING coupon_code`,
      [order.id]
    );
    if (!cancelled.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const couponCode = cancelled.rows[0].coupon_code || null;
    if (couponCode) {
      const redemption = await client.query(
        'DELETE FROM coupon_redemptions WHERE order_id=$1 AND code=$2 RETURNING id',
        [order.id, couponCode]
      );
      if (redemption.rows[0]) {
        await client.query(
          'UPDATE coupons SET redemption_count=GREATEST(0,redemption_count-1),updated_at=NOW() WHERE code=$1',
          [couponCode]
        );
      }
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function handleReturn(req, res, requestUrl, cancelled = false) {
  if (!pool || !CHECKOUT_SECRET) return page(res, 503, 'Payment unavailable', 'Payment status is temporarily unavailable.', 'error');
  const orderId = String(requestUrl.searchParams.get('order_id') || '').trim();
  const expiresAtMs = Number(requestUrl.searchParams.get('expires_at') || 0);
  const suppliedState = String(requestUrl.searchParams.get('state') || '').trim();
  const order = await loadOrder(orderId);
  if (!order || !Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return page(res, 400, 'Invalid payment link', 'This payment return link is incomplete or invalid.', 'error');
  const expected = sign(order, Math.trunc(expiresAtMs));
  if (!/^[a-f0-9]{64}$/i.test(suppliedState) || !timingSafeEqualHex(suppliedState, expected)) {
    return page(res, 401, 'Invalid payment link', 'The payment verification signature is not valid.', 'error');
  }

  if (cancelled) {
    if (order.status === 'paid') {
      return page(res, 200, 'Subscription activated', 'Payment was already confirmed and your BLOFY subscription is active.', 'success');
    }
    if (order.status === 'refunded') {
      return page(res, 200, 'Payment refunded', 'This order has already been refunded and is no longer active.', 'error');
    }
    if (order.status === 'pending') await cancelPendingOrder(order);
    return page(res, 200, 'Payment cancelled', 'No payment was confirmed. The pending order was closed and you can safely try again.', 'info');
  }
  if (order.status === 'paid') {
    return page(res, 200, 'Subscription activated', 'Payment was confirmed and your BLOFY subscription is active.', 'success');
  }
  if (order.status === 'refunded') {
    return page(res, 200, 'Payment refunded', 'This order has been refunded and is no longer active.', 'error');
  }
  if (['failed', 'cancelled'].includes(order.status)) {
    return page(res, 200, 'Payment not completed', 'The payment did not complete. You can return to the app and try again.', 'error');
  }
  if (Date.now() > expiresAtMs + 5 * 60_000) {
    return page(res, 200, 'Checking payment', 'The checkout link has expired. If you paid successfully, the app will still activate after the payment provider confirms it.', 'info');
  }
  return page(res, 200, 'Confirming payment', 'We are waiting for the payment provider confirmation. Return to the app; it will refresh automatically.', 'info');
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedPaymentReturnCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let requestUrl;
    try { requestUrl = new URL(req.url || '/', 'http://localhost'); }
    catch { return listener(req, res); }
    if (req.method === 'GET' && requestUrl.pathname === RETURN_PATH) {
      try { return await handleReturn(req, res, requestUrl, false); }
      catch { return page(res, 500, 'Payment status error', 'Unable to read payment status right now.', 'error'); }
    }
    if (req.method === 'GET' && requestUrl.pathname === CANCEL_PATH) {
      try { return await handleReturn(req, res, requestUrl, true); }
      catch { return page(res, 500, 'Payment status error', 'Unable to read payment status right now.', 'error'); }
    }
    return listener(req, res);
  });
};
