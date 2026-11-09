import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gatewayOrderedItemsPageQuery,gatewayOrderCursor,gatewayItemsPageQuery}
 from '../src/xtream-gateway-query.mjs';
const source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const category='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('code streams use category and item source position, not generated gateway ids',()=>{
 const q=gatewayOrderedItemsPageQuery('live',null,{sourceId:source});
 assert.match(q.text,/ORDER BY COALESCE\(s.priority,2147483647\),s.id,COALESCE\(c.sort_order,2147483647\),COALESCE\(i.source_sort_order,2147483647\),m.gateway_id/);
 assert.match(q.text,/c.name AS category_name/);
 assert.deepEqual(q.values,['live',source,2000]);
 assert.doesNotMatch(q.text,/ORDER BY m.gateway_id ASC/);
});
test('keyset cursor continues at the correct last ordered tuple with no duplicates',()=>{
 const previous={
  sort_source_priority:0,sort_server_id:source,
  sort_category_order:3,sort_item_order:12,gateway_id:'345'
 };
 const cursor=gatewayOrderCursor(previous);
 const q=gatewayOrderedItemsPageQuery('movie',cursor,{sourceId:source});
 assert.deepEqual(q.values,['movie',source,0,source,3,12,345,2000]);
 assert.match(q.text,/\(COALESCE\(s.priority,2147483647\),s.id,COALESCE\(c.sort_order,2147483647\),COALESCE\(i.source_sort_order,2147483647\),m.gateway_id\) > /);
 assert.match(q.text,/\$3::integer,\$4::uuid,\$5::integer,\$6::integer,\$7::bigint/);
 assert.ok(!q.text.includes(' OFFSET '));
});
test('scoped code and M3U filters remain bound parameters and preserve source isolation',()=>{
 const q=gatewayOrderedItemsPageQuery('series',null,{
  sourceId:source,filter:{server_id:source,source_category_id:'9'}
 });
 assert.deepEqual(q.values,['series',source,source,'9',2000]);
 assert.match(q.text,/i.server_id=\$3/);
 assert.match(q.text,/i.category_id=\$4/);
 assert.throws(()=>gatewayOrderedItemsPageQuery('live',null,{
  sourceId:source,filter:{server_id:category,source_category_id:'9'}
 }),/mismatch/);
});
test('malformed cursor and requested page size are rejected',()=>{
 assert.throws(()=>gatewayOrderedItemsPageQuery('movie',{priority:0,serverId:source,
  categoryOrder:1,itemOrder:1,gatewayId:-1}),/invalid_order_cursor/);
 assert.throws(()=>gatewayOrderedItemsPageQuery('movie',null,{pageSize:1000000}),/invalid_page_size/);
 assert.throws(()=>gatewayOrderedItemsPageQuery('invalid',null),/invalid_media_type/);
 assert.throws(()=>gatewayOrderedItemsPageQuery('live',null,{sourceId:'1 OR true'}),/invalid_source_id/);
 assert.throws(()=>gatewayOrderCursor({gateway_id:1}),/invalid_gateway_order_row/);
});
test('legacy gateway ID pager remains available for callers relying on stable IDs',()=>{
 const q=gatewayItemsPageQuery('live',4,{sourceId:source});
 assert.match(q.text,/m.gateway_id>\$2/);
 assert.deepEqual(q.values,['live',4,source,2000]);
});
test('redeemed Xtream codes and M3U export use the same ordered walker',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(c,/gatewayOrderedItemsPageQuery\(mediaType,cursor,\{filter,sourceId\}\)/);
 assert.match(c,/cursor=gatewayOrderCursor\(rows\[rows.length-1\]\)/);
 assert.match(c,/row.category_name \|\| row.metadata\?\.genre/);
 assert.match(c,/get_live_streams/);
 assert.match(c,/get_vod_streams/);
 assert.match(c,/get_series/);
 assert.match(c,/await walkGatewayItems\(mediaType, null,/);
});
