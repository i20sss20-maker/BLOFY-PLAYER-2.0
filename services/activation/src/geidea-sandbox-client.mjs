import { buildGeideaSessionDraft, GEIDEA_KSA_SESSION_URL } from './geidea-preflight.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validatedSession(response, request) {
  if (!response || String(response.responseCode) !== '000' ||
      String(response.detailedResponseCode) !== '000') {
    throw fail('geidea_session_rejected');
  }
  const session = response.session;
  if (!session || !UUID.test(String(session.id ?? ''))) {
    throw fail('geidea_session_invalid_response');
  }
  if (String(session.currency) !== request.currency ||
      Number(session.amount) !== Number(request.amount) ||
      (session.merchantReferenceId &&
       session.merchantReferenceId !== request.merchantReferenceId)) {
    throw fail('geidea_session_mismatch');
  }
  return Object.freeze({
    sessionId: session.id,
    merchantReferenceId: request.merchantReferenceId,
    amount: request.amount,
    currency: request.currency,
    expiresAt: session.expiryDate ?? null,
    checkoutUrl: 'https://www.ksamerchant.geidea.net/hpp/checkout/?' +
      encodeURIComponent(session.id),
  });
}

/**
 * Prepare a Geidea KSA test checkout session, strictly opt-in.
 * Credentials must be the TEST credentials supplied by the merchant.
 * Does not process a card payment or activate BLOFYSAT service.
 */
export async function createGeideaSandboxSession({
  enabled = false,
  plan,
  merchantReferenceId,
  timestamp,
  merchantPublicKey,
  apiPassword,
  callbackUrl,
  returnUrl,
  fetchImpl = fetch,
}) {
  if (enabled !== true) throw fail('geidea_test_disabled');
  const payload = buildGeideaSessionDraft({
    plan, merchantReferenceId, timestamp, merchantPublicKey,
    apiPassword, callbackUrl, returnUrl,
  });
  if (typeof fetchImpl !== 'function') throw fail('geidea_fetch_missing');
  const authorization = Buffer.from(merchantPublicKey + ':' + apiPassword, 'utf8').toString('base64');
  let response;
  try {
    response = await fetchImpl(GEIDEA_KSA_SESSION_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': 'Basic ' + authorization,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail('geidea_test_network_error');
  }
  if (!response.ok) throw fail('geidea_session_http_error');
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw fail('geidea_session_invalid_json');
  }
  // Do not log raw provider responses (they can contain sensitive data).
  return validatedSession(parsed, payload);
}
