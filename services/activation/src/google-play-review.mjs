import crypto from 'node:crypto';
import {
  createActivationCredentialCodec,
  createFixedWindowLimiter,
  requestClientKey
} from './auth-protection.mjs';

const REVIEW_KEY_SHA256 = '9973c4232383256693db1d1142ca9ca9389a0d62e8ff0ebb9c3e8e974e272ab5';
const REVIEW_PAGE_PATH = '/google-play-review';
const REVIEW_API_PATH = '/api/v1/google-play-review/activate';
const DEMO_PLAYLIST_URL = 'https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/docs/google-play-review-demo.m3u';
const REVIEW_DAYS = 180;

function constantTimeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function reviewKeyMatches(value) {
  const digest = crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  return constantTimeEqual(digest, REVIEW_KEY_SHA256);
}

function validDeviceId(value) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(String(value || '').trim());
}

function validActivationCode(value) {
  return /^\d{6}$/.test(String(value || '').trim());
}

function seal(keyHex, value) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

function serveReviewPage(res) {
  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BLOFY PLAYER — Google Play Review Access</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#100b17;color:#f8f4ff;font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(560px,100%);background:#1b1325;border:1px solid #3d2c50;border-radius:22px;padding:28px;box-shadow:0 20px 60px #0008}h1{margin:0 0 10px;font-size:26px}.muted{color:#c9b9da;line-height:1.55;margin:0 0 22px}.field{margin:14px 0}label{display:block;margin:0 0 7px;font-weight:700}input{width:100%;height:50px;border-radius:12px;border:1px solid #544064;background:#100b17;color:#fff;padding:0 14px;font-size:16px}button{width:100%;height:52px;border:0;border-radius:13px;background:#9a5cff;color:#fff;font-size:16px;font-weight:800;margin-top:12px;cursor:pointer}button:disabled{opacity:.6}.status{display:none;margin-top:16px;padding:13px;border-radius:12px;line-height:1.45}.ok{display:block;background:#10352c;color:#c6ffef}.bad{display:block;background:#421a24;color:#ffd6df}.steps{font-size:14px;color:#d8cae5;line-height:1.6;margin-top:20px}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}</style>
</head>
<body>
<main class="card">
<h1>BLOFY PLAYER review access</h1>
<p class="muted">This page gives Google Play reviewers a non-paid review entitlement. No purchase or free-trial enrollment is required.</p>
<form id="review-form">
<div class="field"><label for="deviceId">Device ID</label><input id="deviceId" autocomplete="off" placeholder="BLOFY-XXXX-XXXX" required></div>
<div class="field"><label for="activationCode">6-digit pairing code</label><input id="activationCode" inputmode="numeric" autocomplete="off" placeholder="123456" maxlength="6" required></div>
<div class="field"><label for="reviewKey">Google Play review key</label><input id="reviewKey" type="password" autocomplete="off" required></div>
<button id="submit" type="submit">Enable review access</button>
</form>
<div id="status" class="status"></div>
<div class="steps"><strong>After activation:</strong> return to BLOFY PLAYER and select <span class="mono">Refresh activation</span>. A legal demo playlist is attached automatically for playback testing.</div>
</main>
<script>
const form=document.getElementById('review-form'),status=document.getElementById('status'),button=document.getElementById('submit');
form.addEventListener('submit',async(event)=>{
  event.preventDefault();status.className='status';status.textContent='';button.disabled=true;
  try{
    const response=await fetch('${REVIEW_API_PATH}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:document.getElementById('deviceId').value.trim(),activationCode:document.getElementById('activationCode').value.trim(),reviewKey:document.getElementById('reviewKey').value})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(body.error||'review_activation_failed');
    status.className='status ok';status.textContent='Review access enabled. Return to the app and refresh activation.';
  }catch(error){status.className='status bad';status.textContent='Could not enable access: '+error.message;}
  finally{button.disabled=false;}
});
</script>
</body>
</html>`;
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(html);
}

export function createGooglePlayReviewHandler({ pool, keyHex, json, readJson }) {
  const credentials = createActivationCredentialCodec(keyHex);
  const limiter = createFixedWindowLimiter({ limit: 12, windowMs: 60_000 });

  async function activate(req, res) {
    const rate = limiter.consume(requestClientKey(req));
    if (!rate.allowed) {
      return json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfterSeconds) });
    }

    const body = await readJson(req);
    const deviceId = String(body.deviceId || '').trim().toUpperCase();
    const activationCode = String(body.activationCode || '').trim();
    if (!reviewKeyMatches(body.reviewKey)) return json(res, 403, { error: 'invalid_review_key' });
    if (!validDeviceId(deviceId) || !validActivationCode(activationCode)) {
      return json(res, 400, { error: 'invalid_device_identity' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['blofy-google-review:' + deviceId]);
      const proof = credentials.proof(deviceId, activationCode);
      const expiresAt = new Date(Date.now() + REVIEW_DAYS * 86_400_000);

      await client.query(
        `INSERT INTO devices(
           device_id,activation_code,status,expires_at,last_seen_at,last_app_version,last_platform,
           auth_failed_attempts,last_auth_failure_at,auth_locked_until,trial_registration_pending,data_deleted_at
         ) VALUES($1,$2,'active',$3,NOW(),'google-play-review','android',0,NULL,NULL,FALSE,NULL)
         ON CONFLICT(device_id) DO UPDATE SET
           activation_code=EXCLUDED.activation_code,status='active',expires_at=EXCLUDED.expires_at,
           last_seen_at=NOW(),last_app_version='google-play-review',last_platform='android',
           auth_failed_attempts=0,last_auth_failure_at=NULL,auth_locked_until=NULL,
           trial_registration_pending=FALSE,data_deleted_at=NULL,updated_at=NOW()`,
        [deviceId, proof, expiresAt]
      );

      await client.query('UPDATE device_playlists SET active=FALSE,updated_at=NOW() WHERE device_id=$1', [deviceId]);
      await client.query("DELETE FROM device_playlists WHERE device_id=$1 AND name='BLOFY Review Demo'", [deviceId]);
      await client.query(
        `INSERT INTO device_playlists(
           id,device_id,name,provider_type,base_url_enc,username_enc,password_enc,active,revision
         ) VALUES($1,$2,'BLOFY Review Demo','m3u',$3,NULL,NULL,TRUE,1)`,
        [crypto.randomUUID(), deviceId, seal(keyHex, DEMO_PLAYLIST_URL)]
      );
      await client.query('COMMIT');
      return json(res, 200, { active: true, expiresAt: expiresAt.getTime(), demoPlaylistAttached: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return async function handleGooglePlayReview(req, res, url) {
    if (req.method === 'GET' && url.pathname === REVIEW_PAGE_PATH) {
      serveReviewPage(res);
      return true;
    }
    if (url.pathname !== REVIEW_API_PATH) return false;
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    await activate(req, res);
    return true;
  };
}
