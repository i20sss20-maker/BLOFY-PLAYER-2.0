import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArabicAudioImport} from '../web/stream-arabic-audio-import.mjs';

const url='https://audio.example.org/live/ar.mp3?ticket=private';
test('M3U lists multiple audio feeds; video and duplicate streams are excluded',()=>{
  const playlist=[
    '#EXTM3U',
    '#EXTINF:-1 tvg-name="Arabic Voice",صوت عربي',
    url,
    '#EXTINF:-1,Video stream',
    'https://media.example.org/live/video.ts',
    '#EXTINF:-1,Duplicate',
    url,
    '#EXTINF:-1,AAC feed',
    'https://audio.example.org/live/ar2.aac',
  ].join('\n');
  const r=parseArabicAudioImport(playlist,'m3u');
  assert.equal(r.error,null);
  assert.equal(r.entries.length,2);
  assert.equal(r.entries[0].label,'Arabic Voice');
  assert.equal(r.entries[0].url,url);
  assert.equal(r.entries[0].kind,'audio_candidate');
  assert.equal(r.entries[0].selectable,true);
});

test('M3U8 media and master playlists are previews only, not direct progressive imports',()=>{
  const m3u8=['#EXTM3U','#EXT-X-TARGETDURATION:5',
    '#EXTINF:5','https://audio.example.org/live/seg001.aac'].join('\n');
  const r=parseArabicAudioImport(m3u8,'m3u8');
  assert.equal(r.entries.length,1);
  assert.equal(r.entries[0].kind,'hls_unavailable');
  assert.equal(r.entries[0].selectable,false);
  const nested=parseArabicAudioImport('#EXTM3U\n#EXTINF:-1,Arabic\nhttps://audio.example.org/live/master.m3u8','m3u');
  assert.equal(nested.entries[0].selectable,false);
});

test('CFG and TXT key-value or plain https URLs work without interpreting passwords as sources',()=>{
  const txt=['url = https://audio.example.org/live/ar.ogg',
    'password=abc', 'username=private',
    'https://audio.example.org/live/radio',
    'https://example.org/video.mp4'
  ].join('\n');
  const r=parseArabicAudioImport(txt,'cfg');
  assert.equal(r.entries.length,2);
  assert.equal(r.entries[0].kind,'audio_candidate');
  assert.equal(r.entries[1].kind,'verify_audio_type');
  assert.equal(parseArabicAudioImport(txt,'txt').entries.length,2);
});

test('JSON audio and nested playlist objects extract only explicit URL keys',()=>{
  const payload=JSON.stringify({
    audio:[{label:'Arabic A',url:'https://audio.example.org/live/a.mp3'}],
    streams:[{name:'Arabic B',stream_url:'https://audio.example.org/live/b.m4a'}],
    credentials:{username:'someone',password:'never-copy'},
    EPG:[{title:'Sports',homepage:'https://example.org/not-a-stream'}]
  });
  const r=parseArabicAudioImport(payload,'json');
  assert.equal(r.entries.length,2);
  assert.equal(r.entries[0].label,'Arabic A');
  assert.equal(r.entries[1].label,'Arabic B');
  assert.equal(JSON.stringify(r).includes('never-copy'),false);
});

test('invalid URLs and unsupported files are rejected',()=>{
  const lines=['http://audio.example.org/a.mp3',
    'https://u:p@audio.example.org/a.mp3',
    'https://audio.example.org:8080/a.mp3',
    'file:///storage/0/sound.mp3',
    'https://localhost/a.mp3',
    'https://audio.example.org/a.mp3#secret',
    'https://audio.example.org/a.mp3'];
  const r=parseArabicAudioImport(lines.join('\n'),'m3u');
  assert.equal(r.entries.length,1);
  assert.equal(r.entries[0].url,'https://audio.example.org/a.mp3');
  assert.equal(parseArabicAudioImport('a','exe').error,'unsupported_file_type');
  assert.equal(parseArabicAudioImport('{bad}','json').error,'invalid_json');
  assert.equal(parseArabicAudioImport('x'.repeat(1_000_001),'txt').error,'file_too_large');
});

test('XML EPG without audio URLs is not represented as a playable stream',()=>{
  // DOMParser is browser-native, so this Node unit test deliberately checks
  // the safe failure. Browser integration will test the actual DOM parser.
  const r=parseArabicAudioImport('<tv><programme channel="sport"></programme></tv>','xml');
  assert.equal(r.entries.length,0);
});

test('bounded results limit admin browser work on massive lists',()=>{
  const rows=Array.from({length:100},(_,i)=>'https://audio.example.org/live/'+i+'.mp3');
  const r=parseArabicAudioImport(rows.join('\n'),'txt');
  assert.equal(r.entries.length,60);
  assert.equal(r.truncated,true);
});
