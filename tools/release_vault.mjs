// Encrypt release maintenance material to the existing production certificate.
// The signing private key is never included in the archive or output.
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey,
  privateDecrypt, publicEncrypt, randomBytes, X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = data => createHash('sha256').update(data).digest('hex');
export function seal(payload, certificate, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid source commit');
  const cert = new X509Certificate(certificate);
  if (cert.publicKey.asymmetricKeyType !== 'rsa' || cert.publicKey.asymmetricKeyDetails.modulusLength < 2048)
    throw Error('RSA 2048-bit or stronger certificate required');
  const header = { format: 'BLOFY-RELEASE-VAULT-1', commit,
    certificate_sha256: digest(cert.raw), payload_sha256: digest(payload),
    algorithm: 'AES-256-GCM+RSA-OAEP-SHA256' };
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const wrappedKey = publicEncrypt({ key: cert.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    return { header, iv: iv.toString('base64'), wrapped_key: wrappedKey.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } finally { key.fill(0); }
}

export function unseal(envelope, privateKey) {
  const h = envelope.header;
  if (h?.format !== 'BLOFY-RELEASE-VAULT-1' || h.algorithm !== 'AES-256-GCM+RSA-OAEP-SHA256')
    throw Error('Unsupported release vault');
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.wrapped_key, 'base64'));
  try {
    const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw Error('Invalid encryption parameters');
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(h))); cipher.setAuthTag(tag);
    const payload = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]);
    if (digest(payload) !== h.payload_sha256) throw Error('Payload digest mismatch');
    return payload;
  } finally { key.fill(0); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, input, certificateOrOutput, output] = process.argv.slice(2);
  if (mode === 'seal') {
    const envelope = seal(readFileSync(input), readFileSync(certificateOrOutput), process.env.GITHUB_SHA);
    const expected = process.env.EXPECTED_CERT_SHA256?.toLowerCase();
    if (!expected || envelope.header.certificate_sha256 !== expected) throw Error('Unexpected encryption recipient');
    writeFileSync(output, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
    console.log('Release maintenance archive encrypted to the pinned signing certificate.');
  } else if (mode === 'verify' || mode === 'open') {
    // stdin contains the owner's private PEM, supplied by an explicit local pipe.
    const privatePem = readFileSync(0);
    try {
      const payload = unseal(JSON.parse(readFileSync(input, 'utf8')), createPrivateKey(privatePem));
      if (mode === 'verify') {
        if (!payload.equals(readFileSync(certificateOrOutput))) throw Error('Round-trip verification failed');
        console.log('Encrypted archive round-trip verified; private key was not written.');
      } else writeFileSync(certificateOrOutput, payload, { mode: 0o600, flag: 'wx' });
      payload.fill(0);
    } finally { privatePem.fill(0); }
  } else throw Error('Usage: seal PAYLOAD CERT OUT | verify VAULT ORIGINAL | open VAULT OUT (private PEM on stdin)');
}
