// A stable, nonsecret fingerprint for an exact Xtream media byte stream.
// Weak ETags are unsuitable for immutable byte-copy verification. When
// possible use a strong ETag; otherwise a bounded Last-Modified validator.
// Store only SHA-256, NEVER the upstream header or source credentials.
import {createHash} from 'node:crypto';

export function mirrorSourceValidatorHash(headers){
 if(!headers||typeof headers.get!=='function')return null;
 const etag=String(headers.get('etag')||'').trim();
 const lastModified=String(headers.get('last-modified')||'').trim();
 const canonical=(etag&&!/^W\//i.test(etag))?
  'etag:'+etag:lastModified?'modified:'+lastModified:'';
 if(!canonical||canonical.length>140||/[\r\n]/.test(canonical))
  return null;
 return createHash('sha256').update(canonical,'utf8').digest('hex');
}
