import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('operator dashboard warns of upstream concurrency limits shared by all codes',async()=>{
 const js=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
 assert.match(js,/Number\(item\.accountInfo\?\.maxConnections\)/);
 assert.match(js,/sourceLimit===1/);
 assert.match(js,/item\.enabled&&item\.publishCatalog/);
 assert.match(js,/اتصال واحد معلَن من المزود/);
 assert.match(js,/مشترك بين جميع الأكواد/);
 assert.match(js,/ترخيص إعادة بث/);
 assert.doesNotMatch(js,/max_connections\s*=\s*100|sourceLimit\s*=\s*100/);
});
