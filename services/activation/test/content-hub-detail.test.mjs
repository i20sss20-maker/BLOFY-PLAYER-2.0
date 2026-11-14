import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const web=name=>readFile(new URL('../web/'+name,import.meta.url),'utf8');
const ids=['libraryDetailDialog','libraryDetailClose','libraryDetailStop',
 'libraryDetailArt','libraryDetailKind','libraryDetailTitle',
 'libraryDetailMeta','libraryDetailDescription','libraryDetailFacts',
 'libraryDetailPlayer','libraryDetailPlayerWrap','libraryDetailPlay',
 'libraryDetailEdit','libraryDetailReport','libraryDetailSeasons',
 'libraryDetailSeriesScope','libraryDetailEpisodes','libraryDetailPrev',
 'libraryDetailNext','libraryDetailPageLabel','libraryDetailStatus',
 'libraryDetailPrevVerified','libraryDetailNextVerified',
 'libraryDetailPreviewPosition','libraryDetailAvReview',
 'libraryDetailAvVideoCheck','libraryDetailAvAudioCheck',
 'libraryDetailAvConfirm','libraryDetailAvStatus'];
class FakeNode{
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.children=[];this.textContent='';
  this.style={};this.src='';this.hidden=false;this.open=false;
  this.checked=false;this.disabled=false;
  this.listeners={};this.pauses=0;this.loads=0;this.parentElement=null;
  this.className='';this.classList={
   add:name=>{this.className+=' '+name},
   toggle:()=>{}
  };
 }
 replaceChildren(...items){this.children=items;for(const c of items){
  if(c instanceof FakeNode)c.parentElement=this
 }}
 append(...items){this.children.push(...items)}
 addEventListener(event,fn){(this.listeners[event]??=[]).push(fn)}
 dispatch(event){for(const fn of this.listeners[event.type]||[])fn(event)}
 click(){this.dispatch({type:'click'});this.onclick?.()}
 pause(){this.pauses++}
 load(){this.loads++}
 removeAttribute(key){if(key==='src')this.src=''}
 showModal(){this.open=true}
 close(){this.open=false;this.dispatch({type:'close'})}
 focus(){}
 querySelectorAll(){return []}
 setAttribute(){}
}
function env({fetchImpl=async()=>{throw Error('unexpected fetch')}}={}){
 const refs=Object.fromEntries(ids.map(id=>[id,new FakeNode()]));
 refs.libraryDetailSeasons.parentElement=new FakeNode();
 refs.libraryDetailEpisodes.parentElement=new FakeNode();
 const events={};
 const document={
  getElementById:id=>refs[id],
  createElement:tag=>new FakeNode(tag),
  addEventListener:(name,fn)=>(events[name]??=[]).push(fn),
  dispatchEvent:event=>{for(const fn of events[event.type]||[])fn(event)}
 };
 class CustomEvent{constructor(type,{detail}={}){this.type=type;this.detail=detail}}
 return {refs,context:{document,CustomEvent,fetch:fetchImpl,AbortSignal,
  location:{assign:()=>{throw Error('session not expected')}},console},
  dispatch:(name,detail)=>document.dispatchEvent(new CustomEvent(name,{detail}))};
}
function flatten(node,pred,output=[]){
 if(pred(node))output.push(node);
 for(const x of node.children||[])if(x instanceof FakeNode)
  flatten(x,pred,output);
 return output;
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
test('owner cinematic details are private, no autoplay, and id/rights constrained',async()=>{
 const [html,css,js,hook,hub]=await Promise.all([
  web('admin-content-hub.html'),web('admin-content-hub.css'),
  web('admin-library-detail.js'),
  readFile(new URL('../src/content-hub-admin-hook.mjs',import.meta.url),'utf8'),
  readFile(new URL('../../content-hub/src/server.mjs',import.meta.url),'utf8')
 ]);
 assert.match(html,/admin-library-detail\.js/);
 assert.match(html,/controls preload="none" playsinline/);
 assert.match(html,/عدد الحلقات المكتملة يعني الحلقات المدرجة/);
 assert.match(html,/توثيق مشاهدة الصورة والصوت يدويًا/);
 assert.match(html,/الحلقة المكتملة التالية/);
 for(const id of ids){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(js,/blofy:open-library-detail/);
 assert.match(js,/artworkRightsConfirmed===true/);
 assert.match(js,/sourceVerified===true/);
 assert.match(js,/video\.addEventListener\('playing'/);
 assert.match(js,/confirm-manual-episode-av/);
 assert.match(js,/verifiedPageEntries/);
 assert.match(js,/view-private-series/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(hook,/view-private-series/);
 assert.match(hook,/queuedEpisodePreview/);
 assert.match(hook,/confirm-manual-episode-av/);
 assert.match(hub,/ownsVerifiedRun/);
 assert.match(hub,/owner_preview_confirmation_required/);
 assert.match(css,/\.library-detail-dialog/);
 assert.match(css,/library-detail-registered\[hidden\]/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.doesNotMatch(js,/\.play\(/);
 assert.doesNotMatch(js,/https?:\/\/(?!image\.tmdb\.org)/);
});
test('movie canary is set only on explicit click with verified snapshot; close resets',async()=>{
 const fake=env();
 vm.runInNewContext(await web('admin-library-detail.js'),fake.context,{timeout:1000});
 fake.dispatch('blofy:open-library-detail',{item:{
  kind:'movie',key:'movie:movie_1234567890',state:'queued',
  title:'Work <script>bad</script>',
  meta:{title:'Work',posterPath:'/LicensedPoster999.jpg',
   artworkRightsConfirmed:false,overview:'Safe'},
  editKey:'movie:movie_1234567890'
 }});
 assert.equal(fake.refs.libraryDetailDialog.open,true);
 assert.equal(fake.refs.libraryDetailPlay.hidden,true);
 assert.equal(fake.refs.libraryDetailPlayer.src,'');
 assert.equal(fake.refs.libraryDetailArt.children.some(x=>x.tagName==='IMG'),false);
 assert.equal(fake.refs.libraryDetailTitle.textContent,'Work <script>bad</script>');
 fake.refs.libraryDetailClose.click();
 assert.equal(fake.refs.libraryDetailDialog.open,false);
 fake.dispatch('blofy:open-library-detail',{item:{
  kind:'movie',key:'movie:movie_1234567890',state:'verified',
  title:'Verified film',caption:'Verified in DB',
  meta:{title:'Verified film',posterPath:'/LicensedPoster999.jpg',
   artworkRightsConfirmed:true},
  editKey:'movie:movie_1234567890'
 }});
 assert.equal(fake.refs.libraryDetailPlay.hidden,false);
 assert.equal(fake.refs.libraryDetailPlayer.src,'');
 fake.refs.libraryDetailPlay.click();
 assert.equal(fake.refs.libraryDetailPlayer.src,
  '/api/v1/admin/content-hub/canary/movie_1234567890');
 assert.equal(fake.refs.libraryDetailPlayerWrap.hidden,false);
 assert.equal(fake.refs.libraryDetailPlayer.pauses>0,true);
 fake.refs.libraryDetailStop.click();
 assert.equal(fake.refs.libraryDetailPlayer.src,'');
 assert.equal(fake.refs.libraryDetailPlayerWrap.hidden,true);
});
test('series details fetch all registered seasons and only verified episodes show preview',async()=>{
 const seen=[];
 const route=async(url,options)=>{
  seen.push({url,options});
  if(url.endsWith('/library/series/42'))return {ok:true,status:200,
   json:async()=>({ok:true,readOnly:true,privateOnly:true,seriesId:'42',
    automaticStart:false,hasMoreSeasons:false,seasonSummaries:[
     {seasonKey:'series_42_s01',episodeCount:2,verifiedCount:1,
      failedCount:1,fullyVerifiedInQueue:false},
     {seasonKey:'series_42_s02',episodeCount:1,verifiedCount:0,
      failedCount:0,fullyVerifiedInQueue:false}]})};
  if(url.endsWith('/seasons/report/series_42_s01/page/1'))return {
   ok:true,status:200,json:async()=>({ok:true,readOnly:true,
    privateOnly:true,seasonKey:'series_42_s01',
    page:{number:1,pages:1,totalEpisodes:2},
    totals:{verifiedCount:1,episodeCount:2},
    episodes:[
     {runId:'season_verified12345',episodeNumber:1,title:'Pilot',
      state:'verified',sourceVerified:true,
      expectedBytes:100,storedBytes:100},
     {runId:'season_pending12345',episodeNumber:2,title:'Pending',
      state:'queued',sourceVerified:false,
      expectedBytes:100,storedBytes:35}
    ]})};
  throw Error('unexpected '+url);
 };
 const fake=env({fetchImpl:route});
 vm.runInNewContext(await web('admin-library-detail.js'),fake.context,{timeout:1000});
 fake.dispatch('blofy:open-library-detail',{item:{
  kind:'series',key:'series:42',title:'Series',
  editKey:'series:42',meta:{title:'Series',genre:'drama'}}});
 await flush();await flush();
 assert.equal(seen.length,2);
 assert.equal(seen[0].options.headers['x-blofy-owner-action'],
  'view-private-series');
 assert.equal(fake.refs.libraryDetailSeasons.children.length,2);
 assert.equal(fake.refs.libraryDetailEpisodes.children.length,2);
 const buttons=flatten(fake.refs.libraryDetailEpisodes,n=>
  n.tagName==='BUTTON'&&n.textContent.includes('معاينة'));
 assert.equal(buttons.length,1,'unverified episodes never previewable');
 buttons[0].click();
 assert.equal(fake.refs.libraryDetailPlayer.src,
  '/api/v1/admin/content-hub/seasons/episodes/season_verified12345/preview');
 fake.refs.libraryDetailClose.click();
 assert.equal(fake.refs.libraryDetailPlayer.src,'');
 assert.equal(fake.refs.libraryDetailDialog.open,false);
});


test('manual A/V proof follows real player event, resets between verified episodes and never autoconfirms',async()=>{
 let saved=false,postCalls=0;
 const reports=[];
 const routes=async(url,options)=>{
  if(url.endsWith('/seasons/report/series_42_s01/page/1')){
   reports.push(url);
   return {ok:true,status:200,json:async()=>({
    ok:true,readOnly:true,privateOnly:true,seasonKey:'series_42_s01',
    page:{number:1,pages:1,totalEpisodes:3},
    totals:{verifiedCount:2,episodeCount:3},
    episodes:[{
     runId:'season_reviewed_12345',episodeNumber:1,title:'Episode One',
     state:'verified',sourceVerified:true,expectedBytes:100,storedBytes:100,
     ownerAvConfirmedAt:null,videoOwnerConfirmed:false,audioOwnerConfirmed:false
    },{
     runId:'season_verif_9876543',episodeNumber:2,title:'Episode Two',
     state:'verified',sourceVerified:true,expectedBytes:100,storedBytes:100,
     ownerAvConfirmedAt:saved?'2026-11-14T12:34:00Z':null,
     videoOwnerConfirmed:saved,audioOwnerConfirmed:saved
    },{
     runId:'season_pending_98765',episodeNumber:3,title:'Pending',
     state:'queued',sourceVerified:false,expectedBytes:100,storedBytes:30
    }]
   })};
  }
  if(url.endsWith('/seasons/episodes/av/confirm')){
   postCalls++;
   assert.equal(options.method,'POST');
   assert.equal(options.headers['x-blofy-owner-action'],
    'confirm-manual-episode-av');
   const body=JSON.parse(options.body);
   assert.equal(body.runId,'season_verif_9876543');
   assert.equal(body.confirmed,true);
   assert.equal(body.videoConfirmed,true);
   assert.equal(body.audioConfirmed,true);
   saved=true;
   return {ok:true,status:200,json:async()=>({
    ok:true,manualOnly:true,runId:body.runId,
    confirmedAt:'2026-11-14T12:34:00Z',
    videoOwnerConfirmed:true,audioOwnerConfirmed:true})};
  }
  throw Error('unexpected private request '+url);
 };
 const fake=env({fetchImpl:routes});
 vm.runInNewContext(await web('admin-library-detail.js'),fake.context);
 fake.dispatch('blofy:open-library-detail',{item:{
  kind:'season',key:'series_42_s01',seasonKey:'series_42_s01',
  title:'One season',meta:{title:'Series Test'}}});
 await flush();await flush();
 assert.equal(reports.length,1);
 assert.equal(fake.refs.libraryDetailEpisodes.children.length,3);
 assert.equal(fake.refs.libraryDetailNextVerified.disabled,false);
 assert.equal(fake.refs.libraryDetailAvReview.hidden,true);
 assert.equal(postCalls,0);
 // Navigating starts no playback and has no external side effects.
 fake.refs.libraryDetailNextVerified.click();
 assert.equal(fake.refs.libraryDetailPlayer.src,
  '/api/v1/admin/content-hub/seasons/episodes/season_reviewed_12345/preview');
 assert.equal(fake.refs.libraryDetailAvReview.hidden,true);
 assert.equal(fake.refs.libraryDetailAvConfirm.disabled,true);
 assert.equal(postCalls,0);
 fake.refs.libraryDetailPlayer.dispatch({type:'playing'});
 assert.equal(fake.refs.libraryDetailAvReview.hidden,false);
 assert.equal(fake.refs.libraryDetailAvConfirm.disabled,true);
 fake.refs.libraryDetailAvVideoCheck.checked=true;
 fake.refs.libraryDetailAvVideoCheck.dispatch({type:'change'});
 assert.equal(fake.refs.libraryDetailAvConfirm.disabled,true);
 // Move to the next verified episode, revoking previous click's checks.
 fake.refs.libraryDetailNextVerified.click();
 assert.equal(fake.refs.libraryDetailPlayer.src,
  '/api/v1/admin/content-hub/seasons/episodes/season_verif_9876543/preview');
 assert.equal(fake.refs.libraryDetailAvReview.hidden,true);
 assert.equal(fake.refs.libraryDetailAvVideoCheck.checked,false);
 assert.equal(fake.refs.libraryDetailAvAudioCheck.checked,false);
 assert.equal(fake.refs.libraryDetailNextVerified.disabled,true);
 fake.refs.libraryDetailPlayer.dispatch({type:'playing'});
 fake.refs.libraryDetailAvVideoCheck.checked=true;
 fake.refs.libraryDetailAvAudioCheck.checked=true;
 fake.refs.libraryDetailAvAudioCheck.dispatch({type:'change'});
 assert.equal(fake.refs.libraryDetailAvConfirm.disabled,false);
 fake.refs.libraryDetailAvConfirm.click();
 await flush();await flush();
 assert.equal(postCalls,1);
 assert.ok(reports.length>=2,'server persisted proof is read back from report');
 const card=fake.refs.libraryDetailEpisodes.children[1];
 assert.equal(flatten(card,n=>n.textContent.includes('أكدها المالك يدويًا')).length>0,true);
 assert.equal(fake.refs.libraryDetailPlayer.src,'');
 fake.refs.libraryDetailClose.click();
 assert.equal(fake.refs.libraryDetailDialog.open,false);
});
