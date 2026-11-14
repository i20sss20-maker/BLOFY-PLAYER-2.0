import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMetadataReview} from '../src/metadata-review.mjs';

const movie=id=>({runId:'movie_'+String(id).padStart(10,'0')});
const season=(n,s='01',metadata=null)=>({
 seasonKey:'series_'+n+'_s'+s,metadata
});
const full={title:'Title verified by owner',year:2024,genre:'drama',
 overview:'Story recorded manually',posterPath:'/LicensedCover123.jpg'};
test('review distinguishes missing title from optional licensed artwork',()=>{
 const out=buildMetadataReview({
  movies:[movie(1),{...movie(2),metadata:full}],
  seasons:[season(42),season(42,'02'),season(99,'01',{
   ...full,posterPath:null})],
  page:2,moviesSampleLimited:true,seasonsHasMore:true
 });
 assert.equal(out.readOnly,true);
 assert.equal(out.sampleOnly,true);
 assert.equal(out.globalCoverageKnown,false);
 assert.equal(out.moviesSampleLimited,true);
 assert.equal(out.seasonsHasMore,true);
 assert.equal(out.page,2);
 assert.deepEqual(out.counts,{
  movies:2,series:2,titled:2,missingTitle:2,
  withPoster:1,missingPoster:3,fullyDescribed:1
 });
 assert.equal(out.reviewItems.length,3);
 assert.deepEqual(out.reviewItems.map(x=>x.status),[
  'needs_title','needs_title','optional_artwork_review'
 ]);
 assert.equal(out.reviewItems.every(x=>x.manualReviewOnly),true);
 assert.equal(out.reviewItems.every(x=>x.automaticallyMatched===false),true);
 assert.equal(out.providerMediaRequests,0);
 assert.equal(out.tmdbRequests,0);
 assert.equal(out.storageRequests,0);
 const seriesReview=out.reviewItems.find(x=>x.key==='series:42');
 assert.equal(seriesReview.seasonKey,'series_42_s01');
});
test('invalid keys and duplicates are ignored, no title html or secrets',()=>{
 const out=buildMetadataReview({
  movies:[movie(3),movie(3),{runId:'https://secret.example/?token=abc'}],
  seasons:[season(5),{seasonKey:'../../etc/passwd'},
   season(6,'01',{...full,title:'<b>Injected</b>'})]
 });
 assert.equal(out.counts.movies,1);
 assert.equal(out.counts.series,2);
 assert.equal(JSON.stringify(out).includes('secret.example'),false);
 assert.equal(JSON.stringify(out).includes('<b>'),false);
 assert.equal(out.reviewItems.some(x=>x.key.includes('/')),false);
});
test('review list is bounded to 16, never treated as global library total',()=>{
 const out=buildMetadataReview({
  movies:Array.from({length:42},(_,i)=>movie(i+1)),
  seasons:[season(100)]
 });
 assert.equal(out.reviewItems.length,16);
 assert.equal(out.reviewItemsLimited,true);
 assert.equal(out.counts.movies,42);
 assert.equal(out.globalCoverageKnown,false);
});
test('missing genre, year and overview are optional review not false failure',()=>{
 const out=buildMetadataReview({
  seasons:[season(77,'01',{title:'Known series',posterPath:'/Abcdef123.jpg',
   year:null,genre:'unspecified',overview:''})]
 });
 assert.equal(out.reviewItems[0].status,'optional_details_review');
 assert.equal(out.counts.titled,1);
 assert.equal(out.counts.withPoster,1);
 assert.equal(out.counts.fullyDescribed,0);
});
