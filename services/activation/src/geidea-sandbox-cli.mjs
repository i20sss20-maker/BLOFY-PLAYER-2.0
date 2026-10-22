import crypto from 'node:crypto';
import { createGeideaSandboxSession } from './geidea-sandbox-client.mjs';

// Run locally only with TEST merchant credentials held in environment variables.
// Never commit actual keys, publish this CLI as a web route, or use live keys.
if (process.env.BLOFY_GEIDEA_TEST_MODE !== 'enabled') {
  console.error('geidea_test_disabled: set BLOFY_GEIDEA_TEST_MODE=enabled');
  process.exitCode = 1;
} else {
  const priceMinor = Number(process.env.GEIDEA_TEST_PRICE_MINOR || 100);
  const now = new Date();
  const timestamp = now.getUTCFullYear() + '/' +
    String(now.getUTCMonth() + 1).padStart(2, '0') + '/' +
    String(now.getUTCDate()).padStart(2, '0') + ' ' +
    String(now.getUTCHours()).padStart(2, '0') + ':' +
    String(now.getUTCMinutes()).padStart(2, '0') + ':' +
    String(now.getUTCSeconds()).padStart(2, '0');

  try {
    const session = await createGeideaSandboxSession({
      enabled: true,
      plan: { planKey: 'geidea-sandbox', name: 'Sandbox transaction',
        durationDays: 1, priceMinor, currency: 'SAR' },
      merchantReferenceId: crypto.randomUUID(),
      timestamp,
      merchantPublicKey: process.env.GEIDEA_TEST_MERCHANT_PUBLIC_KEY,
      apiPassword: process.env.GEIDEA_TEST_API_PASSWORD,
      callbackUrl: process.env.GEIDEA_TEST_CALLBACK_URL,
      returnUrl: process.env.GEIDEA_TEST_RETURN_URL,
    });
    console.log(JSON.stringify(session, null, 2));
    console.log('Use Geidea TEST cards only. This CLI does NOT activate services.');
  } catch (error) {
    // Print only a known status code. Never dump headers or secrets.
    const code = /^(invalid_|geidea_)/.test(String(error.code || error.message))
      ? (error.code || error.message) : 'geidea_test_failed';
    console.error(code);
    process.exitCode = 1;
  }
}
