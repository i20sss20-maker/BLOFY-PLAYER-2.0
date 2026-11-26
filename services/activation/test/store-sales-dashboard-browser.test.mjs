import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../web/blofy-one-store-sales.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
const row=(id,status,createdAt)=>({
 orderId:id,orderNumber:'BF-'+id.slice(0,6),
 email:'verified@example.com',sku:'cart',channel:'app',
 status,amountMinor:12900,currency:'SAR',
 createdAt,paidAt:status==='paid'?createdAt:null
});
const now=new Date().toISOString();
function browser({unauthorized=false,broken=false}={}){
 const nodes=new Map(),callbacks=new Map(),requests=[];
 const make=(id='')=>{
  const el={id,textContent:'',value:'',disabled:false,dataset:{},
   children:[],hidden:false,attributes:{},
   addEventListener(type,fn){callbacks.set(this.id+':'+type,fn)},
   replaceChildren(...xs){this.children=[...xs]},
   append(...xs){this.children.push(...xs)},
   setAttribute(key,value){this.attributes[key]=value}};
  if(id)nodes.set(id,el);
  return el;
 };
 for(const id of ['one-store-sales-form','one-store-sales-filter','one-store-sales-search',
  'one-store-sales-refresh','one-store-sales-prev','one-store-sales-next',
  'one-store-sales-rows','one-store-sales-status','one-store-sales-page',
  'one-store-sales-gross','one-store-sales-30d','one-store-sales-paid',
  'one-store-sales-pending','one-store-sales-overdue','one-store-sales-failed'])make(id);
 nodes.get('one-store-sales-filter').value='all';
 const document={getElementById:id=>nodes.get(id)||null,
  createElement:()=>make()};
 const fetch=async(url,options)=>{
  requests.push({url:String(url),method:options.method,cache:options.cache});
  if(unauthorized)return {ok:false,status:401,json:async()=>({})};
  if(broken)throw Error('simulated_network_drop');
  const query=new URL('https://blofyplayer.com'+url).searchParams;
  const filter=query.get('status');
  const items=[
   row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','paid',now),
   row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pending',new Date(Date.now()-25*60000).toISOString())
  ].filter(x=>filter==='all'||x.status===filter);
  const page=Number(query.get('page')||1);
  return {ok:true,status:200,json:async()=>({
   ok:true,readOnly:true,view:'sales',page,matched:items.length,pageSize:25,
   sales:{paidAmountMinor:'95000',paidLast30Minor:'68000',paid:6,
    pending:3,pendingOver20m:2,failed:1,cancelled:1},
   items
  })};
 };
 vm.runInNewContext(js,{document,fetch,AbortController,URLSearchParams,
  window:{setTimeout,clearTimeout,addEventListener(){}},
  console,Date,Intl},{filename:'blofy-one-store-sales.js'});
 return {nodes,callbacks,requests};
}

test('admin site shows recorded sales without bank settlement or personal code data',async()=>{
 const b=browser();await tick();
 assert.equal(b.nodes.get('one-store-sales-gross').textContent,'950.00 ر.س');
 assert.equal(b.nodes.get('one-store-sales-30d').textContent,'680.00 ر.س');
 assert.equal(b.nodes.get('one-store-sales-paid').textContent,'6');
 assert.equal(b.nodes.get('one-store-sales-pending').textContent,'3');
 assert.equal(b.nodes.get('one-store-sales-overdue').textContent,'2');
 assert.equal(b.nodes.get('one-store-sales-failed').textContent,'2');
 assert.equal(b.nodes.get('one-store-sales-rows').children.length,2);
 assert.equal(b.requests.length,1);
 assert.equal(b.requests[0].method,'GET');
 assert.equal(b.requests[0].cache,'no-store');
 assert.match(b.nodes.get('one-store-sales-status').textContent,/سجلات طلبات المتجر/);
 const pending=b.nodes.get('one-store-sales-rows').children[1].children[2];
 assert.equal(pending.dataset.state,'overdue');
});

test('filter changes use server-side status and do not send payment mutations',async()=>{
 const b=browser();await tick();
 b.nodes.get('one-store-sales-filter').value='pending';
 b.callbacks.get('one-store-sales-filter:change')();
 await tick();
 assert.equal(b.nodes.get('one-store-sales-rows').children.length,1);
 assert.equal(b.nodes.get('one-store-sales-rows').children[0].children[2].dataset.state,'overdue');
 const query=new URL('https://blofyplayer.com'+b.requests.at(-1).url).searchParams;
 assert.equal(query.get('status'),'pending');
 assert.equal(query.get('view'),'sales');
 assert.ok(b.requests.every(x=>x.method==='GET'));
});

test('owner session expiry clears previous financial values instead of showing stale green metrics',async()=>{
 const b=browser({unauthorized:true});await tick();
 assert.equal(b.nodes.get('one-store-sales-gross').textContent,'—');
 assert.equal(b.nodes.get('one-store-sales-rows').children.length,1);
 assert.equal(b.nodes.get('one-store-sales-status').dataset.error,'true');
 assert.match(b.nodes.get('one-store-sales-status').textContent,/انتهت جلسة/);
});

test('database failure is unknown, never reported as zero sales',async()=>{
 const b=browser({broken:true});await tick();
 assert.equal(b.nodes.get('one-store-sales-paid').textContent,'—');
 assert.equal(b.nodes.get('one-store-sales-pending').textContent,'—');
 assert.equal(b.nodes.get('one-store-sales-status').dataset.error,'true');
});
