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
 'libraryDetailNext','libraryDetailPageLabel','libraryDetailStatus'];
class FakeNode{
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.children=[];this.textContent='';
  this.style={};this.src='';this.hidden=false;this.open=false;
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
 for(const id of ids){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(js,/blofy:open-library-detail/);
 assert.match(js,/artworkRightsConfirmed===true/);
 assert.match(js,/sourceVerified===true/);
 assert.match(js,/view-private-series/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(hook,/view-private-series/);
 assert.match(hook,/queuedEpisodePreview/);
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
  kind:'movie',key:'movie_movie_1234567890',state:'queued',
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
