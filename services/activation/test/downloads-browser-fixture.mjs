// Isolated screenshot fixture; never contacts a subscriber or production database.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { renderPublicDownloads } from '../src/public-downloads.mjs';
import { servePrivacyPage } from '../src/privacy-pages.mjs';
import '../src/subscriber-portal-ui-hook.mjs';
const playLists=[];
const items = [
  { versionCode: 2000055, versionName: '2.0.0-rc07.44', isPrimary: true, downloadUrl: 'https://example.test/current.apk', releaseNotes: 'تحسينات الواجهة والثبات وتفاصيل الأفلام والمسلسلات' },
  { versionCode: 2000053, versionName: '2.0.0-rc07.42', isPrimary: false, downloadUrl: 'https://example.test/previous.apk', releaseNotes: 'الإصدار السابق' }
];
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (await servePrivacyPage(req, res, new URL(req.url, 'http://localhost'))) return;
  if(path==='/connect') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end((await readFile(new URL('../web/index.html',import.meta.url),'utf8')).replaceAll('href="/"','href="/connect"'));return;
  }
  if (req.method==='POST' && ['/api/v1/activation/check','/api/v1/portal/playlists/list','/api/v1/subscribers/session','/api/v1/portal/playlists'].includes(path)) {
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    res.setHeader('Content-Type','application/json');
    if(body.deviceId!=='BLOFY-TEST-TEST'||body.activationCode!=='123456'){res.writeHead(403);res.end('{}');return;}
    let response={};
    if(path==='/api/v1/activation/check')response={status:'active'};
    else if(path==='/api/v1/portal/playlists/list')response={items:playLists};
    else if(path==='/api/v1/subscribers/session') {
      if(body.username!=='fixture-user'||body.password!=='fixture-password'){res.writeHead(403);res.end('{}');return;}
      response={baseUrl:'https://media.example.test',username:'opaque-fixture-session',password:'isolated-token'};
    } else {
      if(playLists.length||body.name!=='Play QA'||body.providerType!=='xtream'||body.baseUrl!=='https://media.example.test'||body.username!=='opaque-fixture-session'||body.password!=='isolated-token'){res.writeHead(400);res.end('{}');return;}
      playLists.push({...body,id:'11111111-1111-4111-8111-111111111111'});response={saved:true};
    }
    res.end(JSON.stringify(response));return;
  }
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
