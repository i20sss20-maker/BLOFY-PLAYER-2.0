import http from 'node:http';

const PREFIX = '/api/v1/cloud/profile';
const DEVICE_HEADER = 'x-blofy-device-id';
const CODE_HEADER = 'x-blofy-activation-code';

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedProfileCloudHeaderAuth(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer((req, res) => {
    if (req.method === 'GET' && String(req.url || '').startsWith(PREFIX)) {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const deviceId = String(req.headers[DEVICE_HEADER] || '').trim();
        const activationCode = String(req.headers[CODE_HEADER] || '').trim();
        // New clients keep credentials out of URLs/access logs. Query parameters remain supported
        // temporarily by profile-cloud-hook for upgrade compatibility with already-installed builds.
        if (!url.searchParams.get('deviceId') && deviceId) url.searchParams.set('deviceId', deviceId);
        if (!url.searchParams.get('activationCode') && activationCode) url.searchParams.set('activationCode', activationCode);
        req.url = `${url.pathname}${url.search}`;
      } catch {
        // Let the normal profile-cloud handler return its regular validation error.
      }
    }
    return listener(req, res);
  });
};
