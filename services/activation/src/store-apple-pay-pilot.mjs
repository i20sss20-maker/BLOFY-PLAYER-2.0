// Temporary, opt-in owner test gate for Apple Pay for Web on Geidea HPP.
// A pilot link permits ONLY offering Apple Pay in an otherwise normal paid
// checkout. It cannot bypass the verified customer login, price, payment,
// webhook, existing pending order, or verified captured Pay requirements.
import crypto from 'node:crypto';

export function isAuthorizedApplePayPilot(env,token,now=Date.now()){
 if(env?.BLOFY_GEIDEA_APPLE_PAY_PILOT_ENABLED!=='true')return false;
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,90}$/.test(token))return false;
 const expected=String(env.BLOFY_GEIDEA_APPLE_PAY_PILOT_TOKEN_SHA256||'');
 if(!/^[a-f0-9]{64}$/i.test(expected))return false;
 const expiry=Date.parse(String(env.BLOFY_GEIDEA_APPLE_PAY_PILOT_EXPIRES_AT||''));
 if(!Number.isFinite(expiry)||expiry<=now||expiry>now+14*86400000)return false;
 const actual=crypto.createHash('sha256').update(token,'utf8').digest();
 const verified=Buffer.from(expected,'hex');
 return crypto.timingSafeEqual(actual,verified);
}
