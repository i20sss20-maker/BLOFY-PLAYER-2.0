import crypto from 'node:crypto';

// KSA Hosted Payment Page v2 preparation only. This module does NOT create
// orders, call Geidea, verify payments, or activate subscriptions.
export const GEIDEA_KSA_SESSION_URL =
  'https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session';
export const GEIDEA_KSA_HPP_SCRIPT_URL =
  'https://www.ksamerchant.geidea.net/hpp/geideaCheckout.min.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/;

function reject(message) {
  throw new Error(message);
}

export function parseGeideaPlans(source) {
  if (!source || !String(source).trim()) return [];
  let input;
  try { input = JSON.parse(source); } catch { return reject('invalid_geidea_plans_json'); }
  if (!Array.isArray(input) || input.length > 20) return reject('invalid_geidea_plans_json');
  const seen = new Set();
  return input.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return reject('invalid_geidea_plan');
    const planKey = String(entry.planKey ?? '');
    const name = String(entry.name ?? '').trim();
    const priceMinor = entry.priceMinor;
    const durationDays = entry.durationDays;
    const currency = entry.currency ?? 'SAR';
    if (!/^geidea-[a-z0-9][a-z0-9-]{1,58}$/.test(planKey) || seen.has(planKey) ||
        !name || name.length > 120 ||
        !Number.isSafeInteger(priceMinor) || priceMinor <= 0 || priceMinor > 100000000 ||
        !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650 ||
        currency !== 'SAR') return reject('invalid_geidea_plan');
    seen.add(planKey);
    return Object.freeze({ planKey, name, priceMinor, durationDays, currency: 'SAR' });
  });
}

// Never use browser/customer-supplied pricing: select the plan from the
// server's validated allowlist, and derive the amount in halalas from it.
export function buildGeideaSessionDraft({
  plan, merchantReferenceId, timestamp, merchantPublicKey, apiPassword,
  callbackUrl, returnUrl,
}) {
  if (!plan || !Number.isSafeInteger(plan.priceMinor) || plan.priceMinor <= 0 ||
      plan.currency !== 'SAR') return reject('invalid_geidea_plan');
  if (!UUID.test(String(merchantReferenceId ?? ''))) return reject('invalid_geidea_reference');
  if (!TIMESTAMP.test(String(timestamp ?? ''))) return reject('invalid_geidea_timestamp');
  if (!UUID.test(String(merchantPublicKey ?? '')) || !String(apiPassword ?? '').trim()) {
    return reject('geidea_credentials_missing');
  }
  for (const url of [callbackUrl, returnUrl]) {
    let parsed;
    try { parsed = new URL(url); } catch { return reject('invalid_geidea_url'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      return reject('invalid_geidea_url');
    }
  }
  const amount = (plan.priceMinor / 100).toFixed(2);
  const message = merchantPublicKey + amount + 'SAR' + merchantReferenceId + timestamp;
  const signature = crypto.createHmac('sha256', apiPassword).update(message, 'utf8').digest('base64');
  return Object.freeze({
    amount,
    currency: 'SAR',
    timestamp,
    merchantReferenceId,
    signature,
    paymentOperation: 'Pay',
    language: 'ar',
    callbackUrl,
    returnUrl,
  });
}
