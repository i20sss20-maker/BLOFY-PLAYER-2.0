import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const web=new URL('../web/admin-content-hub.html',import.meta.url);
const js=new URL('../web/admin-library.js',import.meta.url);
const css=new URL('../web/admin-content-hub.css',import.meta.url);
const hook=new URL('../src/content-hub-admin-hook.mjs',import.meta.url);
test('library browser has all controls, accessible labels and private routes',async()=>{
 const [html,logic,styles,portal]=await Promise.all([
  readFile(web,'utf8'),readFile(js,'utf8'),
  readFile(css,'utf8'),readFile(hook,'utf8')]);
 const ids=['libraryBrowser','libraryBrowserTitle','librarySearch',
  'libraryRefresh','libraryText','libraryKind','libraryState',
  'libraryStatus','libraryResults','librarySummary',
  'libraryPrev','libraryNext','libraryPage','libraryScope'];
 for(const id of ids)assert.equal(
  (html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 assert.match(html,/admin-library\.js/);
 assert.match(html,/id="libraryKind"/);
 for(const value of ['all','movie','series','season','episode'])
  assert.match(html,new RegExp('value="'+value+'"'));
 assert.match(logic,/\/api\/v1\/admin\/content-hub\/library\/search/);
 assert.match(logic,/credentials:'same-origin'/);
 assert.match(logic,/x-blofy-owner-action/);
 assert.match(logic,/automaticStart!==false/);
 assert.match(logic,/automaticRetry!==false/);
 assert.match(logic,/textContent/);
 assert.doesNotMatch(logic,/innerHTML\s*=/);
 assert.doesNotMatch(logic,/\/internal\//);
 assert.match(styles,/\.library-browser/);
 assert.match(styles,/max-width:540px/);
 assert.match(portal,/\/admin-library\.js/);
 assert.match(portal,/if\(!authorized\(req,res\)\)return/);
 assert.match(portal,/\/api\/v1\/admin\/content-hub\/library\/search/);
 assert.match(portal,/library-read-only/);
});
test('document makes storage-only and movie-search sampling limitations visible',async()=>{
 const page=await readFile(web,'utf8');
 assert.match(page,/أحدث 50 سجلًا/);
 assert.match(page,/الحلقات المدرجة/);
 assert.match(page,/ليس فهرس محتوى المصدر الكامل/);
});


test('manual poster editor is private, accessible and never auto-imports artwork',async()=>{
 const [html,library,editor,hookText,styles]=await Promise.all([
  readFile(web,'utf8'),
  readFile(js,'utf8'),
  readFile(new URL('../web/admin-library-metadata.js',import.meta.url),'utf8'),
  readFile(hook,'utf8'),readFile(css,'utf8')
 ]);
 for(const id of ['libraryMetaDialog','libraryMetaForm','libraryMetaTitle',
  'libraryMetaKey','libraryMetaName','libraryMetaGenre',
  'libraryMetaYear','libraryMetaPoster','libraryMetaOverview',
  'libraryMetaRights','libraryMetaPreview','libraryMetaSave']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(html,/admin-library-metadata\.js/);
 assert.match(library,/blofy:edit-library-metadata/);
 assert.match(library,/metadata\?\.posterPath/);
 assert.match(editor,/artworkRightsConfirmed:true/);
 assert.match(editor,/confirmed:true/);
 assert.match(editor,/image\.tmdb\.org\/t\/p\/w342/);
 assert.match(editor,/x-blofy-owner-action/);
 assert.match(hookText,/curate-private-metadata/);
 assert.match(hookText,/\/api\/v1\/admin\/content-hub\/library\/metadata/);
 assert.match(styles,/\.library-meta-dialog/);
 assert.doesNotMatch(library,/innerHTML\s*=/);
 assert.doesNotMatch(editor,/innerHTML\s*=/);
 assert.doesNotMatch(editor,/method:'GET'/);
});


test('metadata matching review is only on explicit owner action and cannot auto-save',async()=>{
 const [html,js,hookSource,cssText]=await Promise.all([
  readFile(web,'utf8'),
  readFile(new URL('../web/admin-library-metadata.js',import.meta.url),'utf8'),
  readFile(hook,'utf8'),readFile(css,'utf8')
 ]);
 for(const id of ['libraryMatchTitle','libraryMatchSearch',
  'libraryMatchQuery','libraryMatchLanguage','libraryMatchStatus',
  'libraryMatchResults','libraryMatchHints']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  if(id!=='libraryMatchTitle')assert.ok(js.includes(id),id);
 }
 assert.match(html,/ترخيص تجاري ومفتاح API/);
 assert.match(html,/This product uses the TMDB API but is not endorsed or certified by TMDB/);
 assert.match(js,/libraryMatchSearch'\)\.addEventListener\('click'/);
 assert.match(js,/x-blofy-owner-action':'match-private-metadata'/);
 assert.match(js,/result\.automaticSave!==false/);
 assert.match(js,/libraryMetaRights'\)\.checked=false/);
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.match(hookSource,/\/api\/v1\/admin\/content-hub\/library\/matches/);
 assert.match(hookSource,/match-private-metadata/);
 assert.match(cssText,/\.library-match-review/);
});

test('metadata readiness is explicitly page-scoped and only offers manual owner edit',async()=>{
 const [html,library,styles]=await Promise.all([
  readFile(web,'utf8'),readFile(js,'utf8'),readFile(css,'utf8')
 ]);
 for(const id of ['libraryReviewTitle','libraryReviewScope',
  'libraryReviewMetrics','libraryReviewDetails','libraryReviewItems']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(html,/صفحة النتائج الحالية فقط/);
 assert.match(html,/إضافة الصور اختيارية/);
 assert.match(library,/review\.sampleOnly!==true/);
 assert.match(library,/metadataAvailable!==true/);
 assert.match(library,/blofy:edit-library-metadata/);
 assert.match(library,/lookups\.has\(row\.key\)/);
 assert.match(library,/reviewItems\.slice\(0,16\)/);
 assert.doesNotMatch(library,/innerHTML\s*=/);
 assert.match(styles,/\.library-review-metrics/);
 assert.match(styles,/max-width:590px/);
});
