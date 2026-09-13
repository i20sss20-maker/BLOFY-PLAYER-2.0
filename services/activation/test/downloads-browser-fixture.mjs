// Isolated screenshot fixture; never contacts a subscriber or production database.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { renderPublicDownloads } from '../src/public-downloads.mjs';
import { servePrivacyPage } from '../src/privacy-pages.mjs';
const items = [
  { versionCode: 2000055, versionName: '2.0.0-rc07.44', isPrimary: true, downloadUrl: 'https://example.test/current.apk', releaseNotes: 'تحسينات الواجهة والثبات وتفاصيل الأفلام والمسلسلات' },
  { versionCode: 2000053, versionName: '2.0.0-rc07.42', isPrimary: false, downloadUrl: 'https://example.test/previous.apk', releaseNotes: 'الإصدار السابق' }
];
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (await servePrivacyPage(req, res, new URL(req.url, 'http://localhost'))) return;
  if (path==='/api/v1/privacy/support' && req.method==='POST') {
    let body='';for await (const chunk of req) body+=chunk;
    const data=JSON.parse(body);
    if (data.deviceId!=='BLOFY-TEST-TEST' || data.activationCode!=='123456' || !data.message) {res.writeHead(400);res.end('{}');return;}
    res.writeHead(201,{'content-type':'application/json'});res.end('{"received":true}');return;
  }
  const assets = { '/premium.css': 'text/css', '/release-manager.css': 'text/css',
    '/blofy-logo.png': 'image/png', '/IBMPlexSansArabic-Regular.ttf': 'font/ttf', '/IBMPlexSansArabic-Medium.ttf': 'font/ttf' };
  if (assets[path]) {
    res.setHeader('Content-Type', assets[path]);
    res.end(await readFile(new URL('../web' + path, import.meta.url)));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderPublicDownloads(items));
  }
}).listen(8127, '127.0.0.1');
