// Isolated screenshot fixture; never contacts a subscriber or production database.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { renderPublicDownloads } from '../src/public-downloads.mjs';
const items = [
  { versionCode: 2000055, versionName: '2.0.0-rc07.44', isPrimary: true, downloadUrl: 'https://example.test/current.apk', releaseNotes: 'تحسينات الواجهة والثبات وتفاصيل الأفلام والمسلسلات' },
  { versionCode: 2000053, versionName: '2.0.0-rc07.42', isPrimary: false, downloadUrl: 'https://example.test/previous.apk', releaseNotes: 'الإصدار السابق' }
];
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css');
    res.end(await readFile(new URL('../web/release-manager.css', import.meta.url)));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderPublicDownloads(items));
  }
}).listen(8127, '127.0.0.1');
