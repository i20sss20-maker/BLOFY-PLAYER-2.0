import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const navStart=app.indexOf('function navIcon(');
const navEnd=app.indexOf('function shell(',navStart);
assert.ok(navStart>0&&navEnd>navStart);

test('all nine navigation destinations use first-party scalable vector icons',()=>{
 const NAV=[
  ['home','','الرئيسية'],['live','','البث المباشر'],['movie','','الأفلام'],
  ['series','','المسلسلات'],['collections','','التصنيفات'],
  ['favorites','','المفضلة'],['search','','البحث'],['ai','','الذكاء الاصطناعي'],
  ['settings','','الإعدادات']
 ];
 const S={route:'live'};
 const context={S,NAV};
 const {navIcon,navHtml}=vm.runInNewContext(app.slice(navStart,navEnd)+';({navIcon,navHtml})',context);
 const actual=navHtml();
 assert.equal((actual.match(/class="nav-svg"/g)||[]).length,9);
 assert.match(actual,/aria-current="page"/);
 assert.match(actual,/aria-label="البث المباشر"/);
 assert.match(actual,/data-go="settings"/);
 assert.match(actual,/aria-hidden="true"/);
 assert.doesNotMatch(actual,/https?:\/\//);
 for(const route of NAV){
  const svg=navIcon(route[0]);
  assert.match(svg,/^<svg class="nav-svg"/);
  assert.match(svg,/<\/svg>$/);
  assert.match(svg,/stroke="currentColor"/)
 }
});
test('iPhone optional preview is truly idle until requested; TV retains original auto-preview',()=>{
 const start=app.indexOf('function buildCatalog('),end=app.indexOf('function renderCategoryItems(',start);
 const part=app.slice(start,end);
 assert.match(part,/appleTouchBrowser\(navigator\.userAgent,navigator\.maxTouchPoints\)\?' preview-idle'/);
 assert.match(part,/if\(selected\)selectChannel\(itemId\(selected,'live'\),/);
 assert.match(part,/!appleTouchBrowser\(navigator\.userAgent,navigator\.maxTouchPoints\)/);
 const begin=app.slice(app.indexOf('function beginPreview('),app.indexOf('function mergeCatalogPage('));
 assert.match(begin,/livePreviewPanel\.classList\.remove\('preview-idle'\)/);
 assert.match(css,/\.catalog \.preview\.preview-idle \.preview-video-wrap\{\s*display:none!important/);
});
test('mobile channel list is the first content pane and catalog/film/series retain shape',()=>{
 assert.match(css,/\.catalog-app \.catalog \.channels\{\s*order:1/);
 assert.match(css,/\.catalog-app \.catalog \.preview\{\s*order:2/);
 assert.match(css,/\.catalog-app \.catalog \.cat-rail\{/);
 assert.match(css,/\.poster-grid/);
 assert.match(css,/\.detail-content/);
 assert.match(css,/\.setting-panel/);
 assert.match(css,/\.login-panel/);
 assert.match(css,/\.episode-row/);
});
test('safe-area, TV focus and foreground video remain available',()=>{
 assert.match(css,/safe-area-inset-top/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/safe-area-inset-left/);
 assert.match(css,/safe-area-inset-right/);
 assert.match(css,/data-blofy-input="remote"/);
 assert.match(css,/\.remote-focus/);
 assert.match(css,/\.player-overlay>video/);
 assert.match(css,/\.player-hud\.native-stream-hud/);
 assert.match(css,/\.native-player-choice-item/);
 assert.match(css,/\.player-overlay>#player-status\[style\*="display: none"\]\{display:none!important\}/);
 assert.doesNotMatch(css,/\.player-overlay\s*\{[^}]*display:none/);
});
test('cinema theme has no webfont or third-party CDN dependency',()=>{
 const block=css.slice(css.indexOf('/* BLOFY STREAM CINEMA UI / 2026-11-25'));
 assert.ok(block.length>5000);
 assert.doesNotMatch(block,/@import|@font-face|https?:\/\//);
 assert.match(block,/font-family:system-ui/);
 assert.match(block,/data-blofy-device="touch"/);
 assert.match(block,/prefers-reduced-motion:reduce/);
});
test('CSS braces are balanced even inside comments and strings',()=>{
 let quote=null,escaped=false,comment=false,depth=0;
 for(let i=0;i<css.length;i++){
  const x=css[i],next=css[i+1];
  if(comment){if(x==='*'&&next==='/'){comment=false;i++}continue}
  if(quote){
   if(escaped){escaped=false;continue}
   if(x==='\\'){escaped=true;continue}
   if(x===quote)quote=null;
   continue
  }
  if(x==='/'&&next==='*'){comment=true;i++;continue}
  if(x==='"'||x==="'"){quote=x;continue}
  if(x==='{')depth++;
  if(x==='}')depth--;
  assert.ok(depth>=0,'unexpected closing brace at position '+i)
 }
 assert.equal(comment,false);
 assert.equal(quote,null);
 assert.equal(depth,0)
});
