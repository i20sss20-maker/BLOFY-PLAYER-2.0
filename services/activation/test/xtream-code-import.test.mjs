import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createBlofyCodeHandlers } from '../src/blofy-code-handlers.mjs';

const parserSource = await readFile(new URL('../web/xtream-code-import.js', import.meta.url),'utf8');
const context = { URL };
runInNewContext(parserSource, context);
const parse = context.BlofyXtreamImporter.parseXtream;

test('paste Xtream get.php or player_api.php URL and extract login locally', () => {
  const a = parse('http://annkel.com:80/get.php?username=customer1&password=p%40ss%26word&type=m3u_plus&output=ts');
  assert.equal(a.host, 'http://annkel.com');
  assert.equal(a.username,'customer1');
  assert.equal(a.password,'p@ss&word');
  const b = parse('annkel.com:80/player_api.php?username=hello&password=secure123');
  assert.equal(b.username,'hello');
  assert.equal(b.password,'secure123');
  const c=parse('https://iptv.example.net/get.php?username=c&password=other');
  assert.equal(c.host,'https://iptv.example.net');
});

test('paste Xtream host username password as three lines', () => {
  const a=parse('Host: http://annkel.com:80\nUsername: u-33\nPassword: z:test');
  assert.equal(a.username,'u-33');
  assert.equal(a.password,'z:test');
  assert.equal(a.host,'http://annkel.com');
});

test('reject unsafe URLs, host mismatch, malformed credentials, and duplicates without exposing secrets', () => {
  const entries=[
    'http://127.0.0.1:80/get.php?username=a&password=b',
    'http://192.168.1.4/get.php?username=a&password=b',
    'http://attacker@annkel.com/get.php?username=a&password=b',
    'http://annkel.com/get.php?username=a&password=exposedSecret&username=other',
    'http://annkel.com/get.php?username=a',
    'http://annkel.com/unrelated.php?username=a&password=b',
    '',
    'not-a-valid-url'
  ];
  for(const entry of entries){
    assert.throws(()=>parse(entry), err=>{
      assert.equal(err instanceof Error || typeof err.message==='string',true);
      assert.equal(err.message.includes('exposedSecret'),false);
      return true;
    });
  }
});

test('the management page imports before admin script and creates codes with existing endpoint', async () => {
  const html=await readFile(new URL('../web/admin.html',import.meta.url),'utf8');
  const admin=await readFile(new URL('../web/experience.js',import.meta.url),'utf8');
  const service=await readFile(new URL('../src/experience-handlers.mjs',import.meta.url),'utf8');
  assert.ok(html.indexOf('/xtream-code-import.js') < html.indexOf('/experience.js'));
  assert.match(html,/id="code-xtream-import"/);
  assert.match(html,/id="code-import-btn"/);
  assert.match(admin,/BlofyXtreamImporter\.parseXtream/);
  assert.match(admin,/api\('\/api\/v1\/admin\/blofy-codes',payload\)/);
  assert.ok(service.includes("'/xtream-code-import.js':'xtream-code-import.js'"));
});

test('server blocks code issuance for an unapproved upstream host', async () => {
  let queried=false;
  const responses=[];
  const handlers=createBlofyCodeHandlers({
    pool:{query:async()=>{queried=true;return{rows:[]};}},
    secretHex:'ab'.repeat(32),
    readJson:async()=>({host:'http://unknown.example:80',username:'user',password:'password'}),
    json:(_res,status,body)=>responses.push({status,body}),
    requireAdmin:()=>true,
    authorizedDevice:async()=>null
  });
  await handlers.issue({},{});
  assert.equal(queried,false);
  assert.equal(responses[0].status,400);
  assert.equal(responses[0].body.error,'invalid_code_host');
});
