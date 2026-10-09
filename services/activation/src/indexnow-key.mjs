/** Public IndexNow ownership proof for blofyplayer.com.
 * The exact response path must be https://blofyplayer.com/<key>.txt.
 */
export const INDEXNOW_KEY = '0c00de98798ee0a415ae6185595bf6f0';
export const INDEXNOW_KEY_PATH = '/' + INDEXNOW_KEY + '.txt';

export function serveIndexNowKey(req, res, url) {
  if (url.pathname !== INDEXNOW_KEY_PATH || !['GET', 'HEAD'].includes(req.method)) return false;
  const body = INDEXNOW_KEY;
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'strict-transport-security': 'max-age=31536000'
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
