import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../web/store-visual.css',import.meta.url),'utf8');
const market=readFileSync(new URL('../web/store-market.css',import.meta.url),'utf8');
const homepage=readFileSync(new URL('../web/store.html',import.meta.url),'utf8');
function contrast(a,b){
 const l=hex=>{
  const vals=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
   .map(c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4));
  return vals[0]*0.2126+vals[1]*0.7152+vals[2]*0.0722;
 };
 return (Math.max(l(a),l(b))+0.05)/(Math.min(l(a),l(b))+0.05);
}
test('pricing options have light card backgrounds and high-contrast text, not inherited navy',()=>{
 assert.match(homepage,/<div class="pricing-rows">/);
 assert.match(css,/\.market-products \.pricing-rows > span\s*\{[^}]*background:linear-gradient\(150deg,#ffffff 0%,#f8f2ff 100%\)/);
 assert.match(css,/\.market-products \.pricing-rows > span b\s*\{[^}]*color:#542a98/);
 assert.ok(contrast('#542a98','#f8f2ff')>4.5);
 assert.ok(contrast('#554567','#f8f2ff')>4.5);
 assert.match(market,/\.pricing-rows span\{color:#665c74\}/);
 assert.ok(css.lastIndexOf('.market-products .pricing-rows > span')>css.lastIndexOf('/* Contrast repair 2026-11-19'), 'repair must come after palette');
});
test('hero promotional offer uses explicit readable white/gold on dark artwork',()=>{
 assert.match(homepage,/id="offer-heading"/);
 assert.match(homepage,/<div class="offer-overlay">/);
 assert.match(css,/\.market-featured-offer \.offer-overlay h2,[\s\S]*?\.market-featured-offer \.offer-overlay h2 strong\s*\{[^}]*color:#ffffff/);
 assert.match(css,/\.market-featured-offer \.offer-overlay h2 em\s*\{[^}]*color:#ffe0ae/);
 assert.match(css,/\.market-featured-offer \.offer-overlay p\s*\{[^}]*color:#f2eef9/);
 assert.ok(contrast('#ffffff','#08152b')>7);
 assert.ok(contrast('#ffe0ae','#08152b')>7);
 assert.match(css,/@media\(max-width:650px\)/);
});
test('visual repair is isolated to CSS and leaves existing checkout intact',()=>{
 assert.match(homepage,/data-cart-add="stream"/);
 assert.match(homepage,/data-cart-add="xtream"/);
 assert.match(homepage,/id="bundle-add-cart"/);
 assert.match(homepage,/\/store\/visual\.css\?v=20261119-2/);
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(server,/serveStoreAssetFile\(res,'store-visual\.css','text\/css; charset=utf-8'\)/);
});
