import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const base=new URL('../web/',import.meta.url);
const read=name=>readFile(new URL(name,base),'utf8');
const ids=['seasonReadinessRefresh','seasonReadinessPrev','seasonReadinessNext',
 'seasonReadinessStatus','seasonReadinessKpis','seasonReadinessWarnings',
 'seasonReadinessRows','seasonReadinessScope','seasonReadinessPage'];
class MiniNode{
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.textContent='';this.className='';
  this.children=[];this.style={};this.attrs={};this.disabled=false;
  this.handlers={};
 }
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.children=[...nodes]}
 addEventListener(type,cb){(this.handlers[type]??=[]).push(cb)}
 click(){for(const f of this.handlers.click||[])f({type:'click'})}
 setAttribute(k,v){this.attrs[k]=String(v)}
}
const walk=(root,pred,out=[])=>{
 if(pred(root))out.push(root);
 for(const x of root.children||[])if(x instanceof MiniNode)walk(x,pred,out);
 return out;
};
const tick=()=>new Promise(done=>setTimeout(done,6));
test('owner readiness page has clearly scoped registered-queue-only labels',async()=>{
 const [html,js,css,hook,hub]=await Promise.all([
  read('admin-content-hub.html'),read('admin-season-readiness.js'),
  read('admin-content-hub.css'),
  readFile(new URL('../src/content-hub-admin-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../../content-hub/src/server.mjs',import.meta.url),'utf8')
 ]);
 for(const id of [...ids,'seasonReadinessTitle']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(html,/الحلقات المدرجة في قائمة النقل الخاصة فقط/);
 assert.match(html,/لا تقيس تلقائيًا جودة الصوت أو الفيديو/);
 assert.match(html,/admin-season-readiness\.js/);
 assert.match(hook,/admin-season-readiness\.js/);
 assert.match(hook,/review-private-seasons/);
 assert.match(hub,/review-private-seasons/);
 assert.match(css,/\.season-readiness-kpis/);
 assert.match(js,/all_registered_private_season_queue_episodes_only/);
 assert.match(js,/providerMediaRequests!==0/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.doesNotMatch(js,/\.play\(/);
 assert.doesNotMatch(js,/method:'POST'/);
});
test('owner dashboard shows global counts and season report links, without media requests',async()=>{
 const references=Object.fromEntries(ids.map(id=>[id,new MiniNode()]));
 const actions=[],requests=[];
 const data={
  ok:true,readOnly:true,privateOnly:true,databaseSnapshotOnly:true,
  scope:'all_registered_private_season_queue_episodes_only',
  page:1,perPage:20,hasPrevious:false,hasNext:true,
  automaticStart:false,providerMediaRequests:0,storageRequests:0,
  manifestStateAvailable:true,ownerReviewSchemaAvailable:true,
  global:{
   registeredSeasons:4,registeredEpisodes:15,
   storageVerifiedEpisodes:8,ownerAvReviewedEpisodes:3,
   verifiedAwaitingOwnerAv:5,failedEpisodes:2,
   inconsistentVerifiedQueueEpisodes:0
  },
  seasons:[{
   seasonKey:'series_42_s01',registeredEpisodes:10,
   storageVerifiedEpisodes:7,ownerAvReviewedEpisodes:2,
   verifiedAwaitingOwnerAv:5,failedEpisodes:1,
   queuedEpisodes:1,pausedEpisodes:1,runningEpisodes:0,
   inconsistentVerifiedQueueEpisodes:0,
   storageVerificationPercent:70
  }]
 };
 const doc={
  getElementById:id=>references[id],
  createElement:tag=>new MiniNode(tag),
  dispatchEvent:e=>actions.push(e),
  addEventListener(){}
 };
 class CE{constructor(type,{detail}={}){this.type=type;this.detail=detail}}
 const context={
  document:doc,CustomEvent:CE,AbortSignal,
  fetch:async(url,options)=>{
   requests.push({url,options});
   return {ok:true,status:200,json:async()=>data};
  },
  location:{assign:()=>{throw Error('unexpected login')}}
 };
 vm.runInNewContext(await read('admin-season-readiness.js'),context);
 await tick();
 assert.equal(requests.length,1);
 assert.equal(requests[0].options.headers['x-blofy-owner-action'],
  'review-private-seasons');
 assert.equal(requests[0].options.method,'GET');
 assert.equal(references.seasonReadinessKpis.children.length,7);
 assert.equal(references.seasonReadinessRows.children.length,1);
 assert.equal(references.seasonReadinessNext.disabled,false);
 assert.equal(references.seasonReadinessPrev.disabled,true);
 assert.match(references.seasonReadinessStatus.textContent,/لا يعني جاهزية/);
 const reportButtons=walk(references.seasonReadinessRows,
  n=>n.tagName==='BUTTON');
 assert.equal(reportButtons.length,1);
 reportButtons[0].click();
 assert.equal(actions[0].type,'blofy:open-season-report');
 assert.equal(actions[0].detail.seasonKey,'series_42_s01');
 assert.equal(requests.every(x=>x.url.includes(
  '/api/v1/admin/content-hub/seasons/readiness/page/')),true);
});
