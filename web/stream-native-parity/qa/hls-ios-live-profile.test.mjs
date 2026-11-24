import test from 'node:test';
import assert from 'node:assert/strict';
import {preferAppleLiveStart} from '../hls-ios-live-profile.mjs';
const live='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:28\n'+
 Array.from({length:8},(_,i)=>'#EXTINF:1.000000,\nseg-'+String(i+28).padStart(6,'0')+'.ts\n').join('');
test('iPhone native HLS gets a bounded behind-edge hint while keeping segment references',()=>{
 const result=preferAppleLiveStart(live,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7) AppleWebKit/605.1.15');
 assert.match(result,/#EXT-X-START:TIME-OFFSET=-6\.0,PRECISE=NO/);
 assert.equal(result.match(/seg-\d+\.ts/g)?.length,8);
 assert.equal(result.replace(/^#EXT-X-START:[^\n]*\n/m,''),live);
});
test('non-iOS, VOD, short or malformed playlists are byte-for-byte untouched',()=>{
 const short=live.split('#EXTINF:').slice(0,4).join('#EXTINF:');
 for(const s of [live+'#EXT-X-ENDLIST\n',short,
  live.replace('#EXT-X-TARGETDURATION:1','#EXT-X-TARGETDURATION:10'),
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nindex.m3u8\n'])
  assert.equal(preferAppleLiveStart(s,'iPhone'),s);
 for(const ua of ['VIDAA TV','Android Mobile','Mozilla/5.0 (Macintosh; Intel Mac OS X)'])
  assert.equal(preferAppleLiveStart(live,ua),live);
});
test('preexisting EXT-X-START is never duplicated and does not change master playlists',()=>{
 const withStart=live.replace('#EXTM3U\n','#EXTM3U\n#EXT-X-START:TIME-OFFSET=-4\n');
 assert.equal(preferAppleLiveStart(withStart,'iPhone'),withStart);
});
