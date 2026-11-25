import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const css=read('styles.css'),server=read('server.ts');
const docker=read('Dockerfile'),index=read('index.html');
const sw=read('sw.js'),logo=read('stream-icon.svg');

test('official native Arabic fonts were reused as local, non-network-dependent web assets',()=>{
 for(const [weight,file] of [['regular','IBMPlexSansArabic-Regular.ttf'],['bold','IBMPlexSansArabic-SemiBold.ttf']]){
  const filename='fonts/'+file;
  const data=readFileSync(new URL(filename,root));
  assert.ok(data.length>200000,weight+' complete native font is present');
  assert.ok(['00010000','4f54544f','74727565'].includes(data.subarray(0,4).toString('hex')),weight+' valid font header');
  assert.match(css,new RegExp(file.replace('.','\\.')));
  assert.match(server,new RegExp(file.replace('.','\\.')));
  assert.match(sw,new RegExp(file.replace('.','\\.')));
 }
 assert.match(css,/@font-face/);
 assert.match(css,/font-display:swap/);
 assert.match(css,/font-family:var\(--font-stream-ar\)/);
 assert.doesNotMatch(css,/@import\s+url\(["']?https?:/);
 assert.match(index,/rel="preload" href="\/fonts\/IBMPlexSansArabic-Regular\.ttf" as="font"/);
 assert.match(server,/const isNativeArabicFont=p==='\/fonts\/IBMPlexSansArabic-Regular\.ttf'\|\|p==='\/fonts\/IBMPlexSansArabic-SemiBold\.ttf'/);
 assert.match(server,/isNativeArabicFont\?'font\/ttf'/);
 assert.match(server,/max-age=604800/);
 assert.match(docker,/COPY fonts\/ \/app\/fonts\//);
});
test('iPhone and PWA branded PNG icons are copied to actual server image, not just declared in manifest',()=>{
 for(const file of ['icon-192.png','icon-512.png','apple-touch-icon.png']){
  const bytes=readFileSync(new URL(file,root));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.match(server,new RegExp(file.replace('.','\\.')));
  assert.match(docker,new RegExp(file.replace('.','\\.')));
  assert.match(sw,new RegExp(file.replace('.','\\.')));
 }
 assert.match(docker,/COPY icon-192\.png icon-512\.png apple-touch-icon\.png \/app\//);
});
test('logo uses BLOFY original ocean ring/play shape and high contrast, not a new competing identity',()=>{
 assert.match(logo,/viewBox="0 0 128 128"/);
 assert.match(logo,/BLOFY STREAM/);
 assert.match(logo,/fill="url\(#blofy-gold\)"/);
 assert.match(logo,/stroke="url\(#blofy-teal\)"/);
 assert.match(logo,/stroke="url\(#blofy-sky\)"/);
 assert.match(logo,/#06161d/);
 assert.match(css,/\.brand:before,\.login-brand:before/);
 assert.match(css,/\/stream-icon\.svg/);
 assert.doesNotMatch(logo,/<script|<foreignObject/i);
});
test('updates are cached only as public app shell and never media/session credentials',()=>{
 assert.match(sw,/blofy-stream-shell-v7/);
 assert.match(sw,/\/fonts\/IBMPlexSansArabic-Regular\.ttf/);
 assert.match(sw,/\/fonts\/IBMPlexSansArabic-SemiBold\.ttf/);
 assert.match(sw,/if\(SHELL\.indexOf\(url\.pathname\)<0\)return/);
 assert.doesNotMatch(sw,/['"]\/api\/|['"]\/vendor\/|['"]\/media\//);
});
