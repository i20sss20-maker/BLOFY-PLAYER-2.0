import crypto from 'node:crypto';
import { createGeideaSandboxSession } from '../../activation/src/geidea-sandbox-client.mjs';
import { amountMinor, fault, PRICE_MINOR, UUID } from './config.mjs';

const ORDER_URL = 'https://api.ksamerchant.geidea.net/pgw/api/v1/direct/order';

export function safeError(error) {
  const code = String(error?.code ?? error?.message ?? '');
  // Do not forward provider messages, response bodies, Basic headers or secrets.
  return /^(?:geidea|sandbox|invalid_geidea)_[a-z_]{1,70}$/.test(code) ? code : 'sandbox_internal_error';
}

export async function createSession(config, reference, fetchImpl) {
  const session = await createGeideaSandboxSession({
    enabled: true,
    plan: { priceMinor: PRICE_MINOR, currency: 'SAR' },
    merchantReferenceId: reference,
    timestamp: new Date().toISOString().slice(0, 19).replaceAll('-', '/').replace('T', ' '),
    merchantPublicKey: config.publicKey,
    apiPassword: config.password,
    callbackUrl: config.publicOrigin + '/api/geidea/callback',
    returnUrl: config.publicOrigin + '/return?reference=' + reference,
    // A redirect must never forward server-side credentials to another host.
    fetchImpl: (url, options) => fetchImpl(url, { ...options, redirect: 'error' }),
  });
  if (!session.expiresAt || !Number.isFinite(Date.parse(session.expiresAt)) ||
      Date.parse(session.expiresAt) <= Date.now()) throw fault('geidea_session_expired', 502);
  return session;
}

function identity(order, expected, config) {
  if (!order || !UUID.test(order.orderId ?? '') ||
      order.merchantReferenceId !== expected.reference || order.merchantPublicKey !== config.publicKey ||
      order.currency !== 'SAR' || amountMinor(order.amount) !== expected.amountMinor) {
    throw fault('geidea_order_mismatch');
  }
  if (order.isTest !== true) throw fault('geidea_test_order_required');
  if (expected.providerOrderId && order.orderId !== expected.providerOrderId) {
    throw fault('geidea_order_mismatch');
  }
  if (order.totalAmount !== undefined && amountMinor(order.totalAmount) !== expected.amountMinor) {
    throw fault('geidea_order_mismatch');
  }
}

export function verifyCallback(payload, expected, config) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fault('geidea_invalid_callback');
  identity(payload.order, expected, config);
  const order = payload.order;
  const stamp = payload.timeStamp ?? payload.timestamp;
  if (typeof stamp !== 'string' || !stamp.trim() || stamp.length > 80 ||
      typeof order.status !== 'string' || !/^[A-Za-z]{1,30}$/.test(order.status) ||
      typeof payload.signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(payload.signature)) {
    throw fault('geidea_invalid_callback_signature', 401);
  }
  if (payload.timeStamp && payload.timestamp && payload.timeStamp !== payload.timestamp) {
    throw fault('geidea_invalid_callback_signature', 401);
  }
  const message = config.publicKey + (expected.amountMinor / 100).toFixed(2) + order.currency +
    order.orderId + order.status + order.merchantReferenceId + stamp;
  const expectedSignature = crypto.createHmac('sha256', config.password).update(message, 'utf8').digest();
  const supplied = Buffer.from(payload.signature, 'base64');
  if (supplied.length !== expectedSignature.length || !crypto.timingSafeEqual(supplied, expectedSignature)) {
    throw fault('geidea_invalid_callback_signature', 401);
  }
  return crypto.createHash('sha256').update(message + payload.signature).digest('hex');
}

async function providerJson(config, url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error',
      headers: { accept: 'application/json', authorization: 'Basic ' +
        Buffer.from(config.publicKey + ':' + config.password, 'utf8').toString('base64') },
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw fault('geidea_reconcile_network_error', 503); }
  if (!response.ok) throw fault('geidea_reconcile_http_error', 503);
  let body;
  try { body = await response.json(); } catch { throw fault('geidea_reconcile_invalid_json', 502); }
  if (!body || body.responseCode !== '000' || body.detailedResponseCode !== '000') {
    throw fault('geidea_reconcile_rejected', 502);
  }
  return body;
}

export async function reconcile(config, expected, fetchImpl, orderId = expected.providerOrderId) {
  if (orderId && !UUID.test(orderId)) throw fault('geidea_invalid_order_id');
  const url = orderId ? ORDER_URL + '/' + orderId :
    ORDER_URL + '?MerchantReferenceId=' + encodeURIComponent(expected.reference);
  const body = await providerJson(config, url, fetchImpl);
  const orders = body.order ? [body.order] : body.orders;
  if (!Array.isArray(orders)) throw fault('geidea_reconcile_invalid_response', 502);
  // Some providers return an empty list before checkout creates an order.
  if (!orders.length && !orderId) return null;
  if (orders.length !== 1) throw fault('geidea_reconcile_ambiguous', 502);
  const order = orders[0];
  identity(order, expected, config);
  if (orderId && order.orderId !== orderId) throw fault('geidea_order_mismatch');
  const status = order.status;
  const detail = order.detailedStatus;
  if (typeof status !== 'string' || !/^[A-Za-z]{1,40}$/.test(status) ||
      typeof detail !== 'string' || !/^[A-Za-z]{1,40}$/.test(detail)) {
    throw fault('geidea_reconcile_invalid_response', 502);
  }
  let result = 'pending';
  if (status === 'Success' && detail === 'Paid') {
    if (amountMinor(order.totalCapturedAmount) !== expected.amountMinor ||
        amountMinor(order.totalRefundedAmount) !== 0 || order.paymentOperation !== 'Pay') {
      throw fault('geidea_capture_mismatch');
    }
    const payments = Array.isArray(order.transactions) ? order.transactions.filter(transaction =>
      transaction.type === 'Pay' && transaction.status === 'Success' &&
      transaction.codes?.responseCode === '000' && transaction.codes?.detailedResponseCode === '000' &&
      transaction.currency === 'SAR' && amountMinor(transaction.amount) === expected.amountMinor) : [];
    if (!payments.length) throw fault('geidea_successful_payment_missing');
    result = 'paid';
  } else if (['Cancelled', 'Canceled'].includes(status) || ['Cancelled', 'Canceled'].includes(detail)) {
    result = 'cancelled';
  } else if (status === 'Failed' || detail === 'OrderFailed') result = 'failed';
  else if (['Refunded', 'PartiallyRefunded', 'Voided'].includes(detail)) result = 'review';
  const brand = order.paymentMethod?.brand?.toLowerCase();
  const lastTransaction = Array.isArray(order.transactions) ? order.transactions.at(-1) : null;
  const codes = lastTransaction?.codes;
  return {
    status: result, providerOrderId: order.orderId, providerStatus: String(status ?? '').slice(0, 40),
    providerDetailedStatus: detail,
    responseCode: /^\d{3}$/.test(codes?.responseCode ?? '') ? codes.responseCode : body.responseCode,
    detailedResponseCode: /^\d{3}$/.test(codes?.detailedResponseCode ?? '') ? codes.detailedResponseCode : body.detailedResponseCode,
    observedNetwork: ['visa', 'mastercard', 'mada'].includes(brand) ? brand : null,
    providerVerified: 1, errorCode: null,
  };
}
