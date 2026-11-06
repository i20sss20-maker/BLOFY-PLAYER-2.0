// Xtream clients may POST their login/action as form data instead of
// including it in the query. Query parameters take precedence for compatibility.
// This parser does not log or persist passwords.
export async function mergeXtreamPlayerRequest(req, inputUrl) {
  if (req.method !== 'POST') return inputUrl;
  const type = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'application/json') return inputUrl;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 32_000) throw Object.assign(new Error('xtream_post_too_large'), { status: 413 });
    chunks.push(buffer);
  }
  if (!chunks.length) return inputUrl;

  const raw = Buffer.concat(chunks).toString('utf8');
  let pairs;
  if (type === 'application/json') {
    let body;
    try { body = JSON.parse(raw); }
    catch { throw Object.assign(new Error('xtream_post_invalid_json'), { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw Object.assign(new Error('xtream_post_invalid_json'), { status: 400 });
    pairs = Object.entries(body);
  } else {
    pairs = new URLSearchParams(raw);
  }
  const url = new URL(inputUrl);
  for (const [key, value] of pairs) {
    if (!/^[A-Za-z0-9_]{1,48}$/.test(key)) continue;
    if (url.searchParams.has(key) || value == null || typeof value === 'object') continue;
    url.searchParams.set(key, String(value).slice(0, 2000));
  }
  return url;
}
