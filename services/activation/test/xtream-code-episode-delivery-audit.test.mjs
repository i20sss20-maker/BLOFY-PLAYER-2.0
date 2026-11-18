import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('operator-only probe uses identical get_series_info resolver as already existing Xtream subscriber codes',async()=>{
 const file=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const admin=file.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway')) return listener(req, res);");
 const auth=file.indexOf('if (!requireAdmin(req, res)) return;',admin);
 const diagnostic=file.indexOf("/api/v1/admin/xtream-gateway/episode-delivery-audit",auth);
 assert.ok(admin>0 && auth>admin && diagnostic>auth);
 const next=file.indexOf("if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream-gateway/playback-health')",diagnostic);
 assert.ok(next>diagnostic);
 const block=file.slice(diagnostic,next);
 assert.match(block,/gatewayItemById\('series',gatewayId,sourceId\)/);
 assert.match(block,/seriesSourceId/);
 assert.match(block,/blofy_xtream_gateway_item_map/);
 assert.match(block,/seriesInfo\(gatewayId,sourceId\)/);
 assert.match(block,/source\.publish_catalog!==true/);
 assert.match(block,/episode_audit_source_not_approved/);
 assert.match(block,/episode_audit_ids_mapped/);
 assert.match(block,/episode_audit_upstream_unavailable/);
 assert.match(block,/mediaBytesRead:0,customerCodesChanged:0/);
 assert.match(block,/customerCredentialsReturned:false/);
 assert.doesNotMatch(block,/decryptServerCredentials|proxyMedia\(|probeGatewayMedia\(|streamDistributors\.issue|rotateXtream/);
 const customer=file.indexOf("if (action === 'get_series_info') {");
 assert.ok(customer>=0 && file.indexOf('await seriesInfo(url.searchParams.get',customer)>customer);
});
