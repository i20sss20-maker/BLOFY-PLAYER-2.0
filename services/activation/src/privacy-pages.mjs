import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/privacy',['privacy.html','text/html; charset=utf-8']],
  ['/delete-account',['privacy.html','text/html; charset=utf-8']],
  ['/privacy-actions.js',['privacy-actions.js','text/javascript; charset=utf-8']]
]);
export async function servePrivacyPage(req,res,url) {
  if (!files.has(url.pathname) || !['GET','HEAD'].includes(req.method)) return false;
  const [name,type]=files.get(url.pathname);
  const body=await readFile(new URL('../web/'+name,import.meta.url));
  res.writeHead(200,{'content-type':type,'content-length':body.length,'cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  res.end(req.method==='HEAD'?undefined:body);return true;
}
