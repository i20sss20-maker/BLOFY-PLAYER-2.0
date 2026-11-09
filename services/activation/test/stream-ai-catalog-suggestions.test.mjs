import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeCatalogAIBatch,suggestCatalogWithAI}
  from '../src/stream-ai-catalog-suggestions.mjs';

test('AI disabled means zero requests and no surprise billing',async()=>{
  let calls=0;
  const r=await suggestCatalogWithAI([{id:'1',name:'Sports 1'}],{
    fetchImpl:async()=>{calls++;throw Error('must not call provider')}
  });
  assert.equal(r.ok,false);
  assert.equal(r.code,'stream_ai_not_configured');
  assert.equal(calls,0);
});
test('AI payload includes only selected titles and sanitized categories',async()=>{
  let posted;
  const rows=[
    {id:'1',name:'Sports 1',categoryName:'AR|Sports',url:'https://secret.example/path',
      password:'secret',token:'token'},
    {id:'2',name:'https://example.com/get.php?password=s',categoryName:'private'},
    {id:'3',name:'user@example.com',categoryName:'private'},
    {id:'4',name:'News channel',categoryName:'NEWS'}
  ];
  const safe=sanitizeCatalogAIBatch(rows);
  assert.deepEqual(safe.map(x=>x.id),['1','4']);
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.redirect,'error');
    posted=JSON.parse(options.body);
    return new Response(JSON.stringify({
      status:'completed',
      output:[{type:'message',content:[{type:'output_text',
        text:JSON.stringify({suggestions:[
          {id:'1',category:'رياضة',cleanTitle:'Sports 1',
            confidence:'مرتفع',reason:'فئة رياضية واضحة'},
          {id:'4',category:'أخبار',cleanTitle:'News channel',
            confidence:'متوسط',reason:'اسم إخباري واضح'}
        ]})}]}]
    }),{status:200,headers:{'content-type':'application/json'}});
  };
  const r=await suggestCatalogWithAI(rows,{apiKey:'x'.repeat(45),fetchImpl});
  assert.equal(r.ok,true);
  assert.equal(r.modelUsed,true);
  assert.equal(r.suggestions.length,2);
  assert.ok(posted.store===false);
  assert.ok(posted.text.format.type==='json_schema');
  assert.ok(!JSON.stringify(posted).includes('secret.example'));
  assert.ok(!JSON.stringify(posted).includes('user@example.com'));
  assert.ok(!JSON.stringify(posted).includes('password'));
  assert.equal(r.suggestions[0].category,'رياضة');
});
test('AI provider errors and malicious return are fail-closed',async()=>{
  const sample=[{id:'1',name:'News 1',categoryName:'News'}];
  const denied=await suggestCatalogWithAI(sample,{apiKey:'x'.repeat(40),
    fetchImpl:async()=>new Response('denied',{status:429})});
  assert.equal(denied.code,'stream_ai_provider_unavailable');
  const invalid=await suggestCatalogWithAI(sample,{apiKey:'x'.repeat(40),
    fetchImpl:async()=>new Response(JSON.stringify({status:'completed',
      output:[{content:[{type:'output_text',text:JSON.stringify({suggestions:[
        {id:'1',category:'أخبار',cleanTitle:'https://evil.example',confidence:'مرتفع',reason:'fake'}]})}]}]}),
      {status:200})});
  assert.equal(invalid.ok,true);
  assert.equal(invalid.suggestions.length,0);
});
