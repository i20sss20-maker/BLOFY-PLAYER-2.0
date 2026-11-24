import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createConnectHttp} from '../src/stream-connect-http.mjs';
function request(body,{method='POST',url='/api/v1/stream/connect/redeem',contentType='application/json'}={}){
 const req=Readable.from([Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);Object.assign(req,{method,url,headers:{'content-type':contentType},socket:{remoteAddress:'127.0.0.1'}});return req;
}
function response(){return {writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=JSON.parse(body)}}}
test('fail closed, protected issue, no query-string secrets',async()=>{
 const disabled=createConnectHttp(),res=response();await disabled.handle(request({code:'test'}),res,{operation:'redeem'});assert.equal(res.status,503);assert.equal(res.body.code,'connect_disabled');
 const service=createConnectHttp({enabled:true,pairing:{}}),unauthorized=response();await service.handle(request({}),unauthorized,{operation:'issue'});assert.equal(unauthorized.status,401);
 const query=response();await service.handle(request({}, {url:'/api/v1/stream/connect/redeem?code=private'}),query,{operation:'redeem'});assert.equal(query.status,405);assert.equal(JSON.stringify(query.body).includes('private'),false);
});
test('body allowlist, private response headers and generic errors',async()=>{
 let seen;const service=createConnectHttp({enabled:true,pairing:{issue:async input=>{seen=input;return {ok:true,code:'synthetic'}},redeem:async()=>{throw Error('secret provider password')}}});
 const result=response();await service.handle(request({host:'https://provider.example.com',username:'user',password:'test',accountId:'ignored'}),result,{operation:'issue',bridgeAuthorized:true});assert.equal(result.status,201);assert.deepEqual(seen,{host:'https://provider.example.com',username:'user',password:'test'});assert.match(result.headers['cache-control'],/no-store/);
 const bad=response();await service.handle(request({code:'test'}),bad,{operation:'redeem'});assert.equal(bad.status,503);assert.equal(bad.body.code,'connect_pairing_unavailable');assert.doesNotMatch(JSON.stringify(bad.body),/secret/);
 const huge=response();await service.handle(request({code:'x'.repeat(5000)}),huge,{operation:'redeem'});assert.equal(huge.status,413);
 const wrong=response();await service.handle(request({}, {contentType:'text/plain'}),wrong,{operation:'redeem'});assert.equal(wrong.status,415);
});
test('rate limits repeated redemption attempts',async()=>{
 const service=createConnectHttp({enabled:true,pairing:{redeem:async()=>({ok:true})}});
 for(let i=0;i<8;i++){const res=response();await service.handle(request({code:'test'}),res,{operation:'redeem'});assert.equal(res.status,200)}
 const last=response();await service.handle(request({code:'test'}),last,{operation:'redeem'});assert.equal(last.status,429);assert.ok(last.headers['retry-after']);
});
