import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const base=new URL('../web/',import.meta.url);
const get=name=>readFile(new URL(name,base),'utf8');
const ids=['cinemaGridButton','cinemaDetailsButton','cinemaGenreToolbar',
 'cinemaScope','libraryCinema','libraryResults'];
class MiniNode{
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.children=[];this.attrs={};
  this.handlers={};this.style={};this.textContent='';this.className='';
  this.hidden=false;this.src='';this.alt='';
  this.classList={add:(c)=>{this.className+=' '+c}};
 }
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=[...children]}
 setAttribute(key,value){this.attrs[key]=String(value)}
 addEventListener(key,fn){(this.handlers[key]??=[]).push(fn)}
 fire(key){for(const fn of this.handlers[key]||[])fn({type:key})}
 get childElementCount(){return this.children.length}
}
function findAll(node,pred,acc=[]){
 if(pred(node))acc.push(node);
 for(const child of node.children||[])if(child instanceof MiniNode)
  findAll(child,pred,acc);
 return acc;
}
function makeFakeBrowser(){
 const refs=Object.fromEntries(ids.map(id=>[id,new MiniNode()]));
 const handlers={};
 const document={
  createElement:tag=>new MiniNode(tag),
  getElementById:id=>refs[id]||null,
  addEventListener:(key,fn)=>(handlers[key]??=[]).push(fn),
  dispatchEvent:event=>{
   for(const fn of handlers[event.type]||[])fn(event);
  }
 };
 class FakeEvent{
  constructor(type,{detail}={}){this.type=type;this.detail=detail}
 }
 return {refs,document,CustomEvent:FakeEvent,handlers};
}
test('cinematic UI is private, accessible, and deliberately no-media/no-write',async()=>{
 const [html,css,js,hook]=await Promise.all([
  get('admin-content-hub.html'),get('admin-content-hub.css'),
  get('admin-library-cinema.js'),
  readFile(new URL('../src/content-hub-admin-hook.mjs',import.meta.url),'utf8')
 ]);
 assert.match(html,/admin-library-cinema\.js/);
 assert.match(html,/واجهة بصرية خاصة بالمالك/);
 assert.match(html,/صفحة البحث/);
 assert.match(html,/aria-pressed="true"/);
 for(const id of [...ids,'libraryCinema','cinemaTitle']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(hook,/\/admin-library-cinema\.js/);
 assert.match(js,/blofy:library-page-ready/);
 assert.match(js,/blofy:open-season-report/);
 assert.match(js,/blofy:edit-library-metadata/);
 assert.match(js,/artworkRightsConfirmed===true/);
 assert.match(js,/image\.tmdb\.org\/t\/p\/w342/);
 assert.match(js,/no public route|no public route/i);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.doesNotMatch(js,/\bfetch\(/);
 assert.doesNotMatch(js,/\.play\(/);
 assert.doesNotMatch(js,/\bautoplay\b\s*=/);
 assert.match(css,/#libraryCinema\[hidden\]/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/scroll-snap-type/);
});
test('cinematic cards only show licensed posters and open existing owner actions',async()=>{
 const code=await get('admin-library-cinema.js');
 const fake=makeFakeBrowser(),emitted=[];
 fake.document.addEventListener('blofy:open-season-report',x=>emitted.push(x));
 fake.document.addEventListener('blofy:edit-library-metadata',x=>emitted.push(x));
 vm.runInNewContext(code,fake,{timeout:1000});
 assert.equal(fake.refs.libraryResults.hidden,true);
 assert.equal(fake.refs.libraryCinema.hidden,false);
 assert.equal(fake.refs.cinemaGridButton.attrs['aria-pressed'],'true');
 fake.document.dispatchEvent(new fake.CustomEvent('blofy:library-page-ready',{
  detail:{kind:'all',data:{
   ok:true,readOnly:true,page:1,
   movies:[
    {runId:'movie_1234567890',verified:true,state:'verified',
     metadata:{title:'Film <script>alert(1)</script>',year:2025,
      genre:'drama',artworkRightsConfirmed:true,
      posterPath:'/LicensedPoster123.jpg',overview:'A story'}},
    {runId:'movie_0000000000',verified:false,state:'queued',
     metadata:{title:'Unlicensed Poster',genre:'comedy',
      artworkRightsConfirmed:false,
      posterPath:'/AllowedPathUnlicensed.jpg'}},
    {runId:'movie_1111111111',verified:true,state:'verified',
     metadata:{title:'Malicious Poster',artworkRightsConfirmed:true,
      posterPath:'http://evil.example/foo.jpg'}}
   ],
   seasons:[{seasonKey:'series_42_s01',episodeCount:3,
    verifiedCount:2,fullyVerifiedInQueue:false,
    metadata:{title:'Starry Night',genre:'drama',year:2024,
     overview:'Testing',artworkRightsConfirmed:true,
     posterPath:'/LicensedSeries123.jpg'}}],
   episodes:[{runId:'season_1234567890abcdef',
    seasonKey:'series_42_s01',episodeNumber:1,
    title:'Pilot',verified:true,percent:100,
    seriesMetadata:{title:'Starry Night',genre:'drama',
     artworkRightsConfirmed:true,posterPath:'/LicensedSeries123.jpg'}}]
  }}
 }));
 const container=fake.refs.libraryCinema;
 const images=findAll(container,n=>n.tagName==='IMG');
 assert.ok(images.length>=2,'licensed assets render');
 assert.equal(images.some(img=>img.src.includes('evil.example')),false);
 assert.equal(images.some(img=>img.src.includes('AllowedPathUnlicensed')),false);
 assert.equal(images.every(img=>img.src.startsWith(
  'https://image.tmdb.org/t/p/')),true);
 const unsafeMarkup=findAll(container,n=>n.tagName==='SCRIPT');
 assert.equal(unsafeMarkup.length,0);
 assert.equal(findAll(container,n=>n.textContent.includes('<script>')).length>0,true);
 const details=findAll(container,n=>n.tagName==='BUTTON'&&
  n.textContent==='تفاصيل الموسم');
 assert.ok(details.length>=1);
 details[0].fire('click');
 assert.equal(emitted[0].type,'blofy:open-season-report');
 assert.equal(emitted[0].detail.seasonKey,'series_42_s01');
 const edits=findAll(container,n=>n.tagName==='BUTTON'&&
  n.textContent==='تعديل البيانات');
 assert.ok(edits.length>=1);
 edits[0].fire('click');
 assert.equal(emitted[1].type,'blofy:edit-library-metadata');
 assert.match(emitted[1].detail.key,/^(?:movie:|series:)/);
 assert.match(fake.refs.cinemaScope.textContent,/الصفحة/);
});
test('cinema/details mode switch changes only presentation, not server state',async()=>{
 const fake=makeFakeBrowser();
 vm.runInNewContext(await get('admin-library-cinema.js'),fake);
 fake.refs.cinemaDetailsButton.fire('click');
 assert.equal(fake.refs.libraryCinema.hidden,true);
 assert.equal(fake.refs.libraryResults.hidden,false);
 assert.equal(fake.refs.cinemaDetailsButton.attrs['aria-pressed'],'true');
 fake.refs.cinemaGridButton.fire('click');
 assert.equal(fake.refs.libraryCinema.hidden,false);
 assert.equal(fake.refs.libraryResults.hidden,true);
 assert.equal(fake.refs.cinemaGridButton.attrs['aria-pressed'],'true');
});
