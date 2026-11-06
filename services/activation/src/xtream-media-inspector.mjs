// A provider may respond HTTP 200 with "File not found", a JSON error,
// or an HTML login page. Such a reply is not playable media. Keep this
// inspection small, deterministic, and safe for encrypted/binary formats.
export function inspectXtreamMediaChunk(chunk, contentType = '') {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!bytes.byteLength) return { valid: false, format: 'empty', reason: 'upstream_empty_media' };
  const slice = bytes.subarray(0, 256);
  const text = slice.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  const lower = text.toLowerCase();
  const hls = lower.startsWith('#extm3u');
  const ts = bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47);
  const mp4 = bytes.length >= 8 && slice.subarray(4,8).toString('ascii') === 'ftyp';
  const mkv = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const avi = bytes.length >= 12 && slice.subarray(0,4).toString('ascii') === 'RIFF' &&
    slice.subarray(8,12).toString('ascii') === 'AVI ';
  const known = hls || ts || mp4 || mkv || avi;
  const format = hls ? 'hls' : ts ? 'ts' : mp4 ? 'mp4' : mkv ? 'mkv' : avi ? 'avi' : 'unknown';
  if (known) return { valid: true, format, reason: null };
  if (/^(text\/|application\/(?:json|xml|xhtml\+xml|problem\+json))/.test(mime) ||
      /^<(!doctype\s+html|html|\?xml)|^\{\s*"(?:(?:error|message|status|code)\b)/i.test(lower) ||
      /^(?:access\s+denied|forbidden|unauthorized|not\s+found|file\s+not\s+found|invalid\s+(?:user|password|stream)|error\s*[:!])/i.test(lower)) {
    return { valid: false, format: 'text', reason: 'upstream_non_media_response' };
  }
  // Keep unknown binary formats (including encrypted/packed streams)
  // playable: media headers vary by provider, and no signature is universal.
  return { valid: true, format: 'unknown', reason: null };
}
