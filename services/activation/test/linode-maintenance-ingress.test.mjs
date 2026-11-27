import test from 'node:test';
import assert from 'node:assert/strict';
import {linodeMaintenanceActive,blocksDuringLinodeMaintenance} from '../src/linode-maintenance-ingress.mjs';
const enabled={BLOFY_LINODE_MEDIA_MAINTENANCE:'1'};
const media=['/live/a/b/1.ts','/movie/a/b/2.mp4','/series/a/b/3.mp4','/hls/a/b/1/ticket','/api/v1/stream/media/live/1.ts','/api/v1/stream/media/series/2.mp4','/internal/blofy-content-hub/source/movie/123','/api/v1/admin/xtream-gateway/playback-probe','/api/v1/admin/xtream-gateway/episode-delivery-audit','/api/v1/admin/xtream-gateway/unavailable-media/recheck','/api/v1/admin/xtream-gateway/unavailable-media/recheck-now'];
test('maintenance is explicit and defaults off',()=>{
 for(const e of [{},{BLOFY_LINODE_MEDIA_MAINTENANCE:'0'},{BLOFY_LINODE_MEDIA_MAINTENANCE:'true'}]){
  assert.equal(linodeMaintenanceActive(e),false);
  for(const p of media)assert.equal(blocksDuringLinodeMaintenance(p,e),false);
 }
});
test('known new media requests and probes blocked, control plane available',()=>{
 for(const p of media)assert.equal(blocksDuringLinodeMaintenance(p,enabled),true,p);
 for(const p of ['/player_api.php','/panel_api.php','/get.php','/xtream/health','/api/v1/stream/app/session','/api/v1/stream/app/unified-redeem','/api/v1/internal/linode-heartbeat','/api/v1/admin/xtream-gateway/playback-health','/sources-admin','/movies'])assert.equal(blocksDuringLinodeMaintenance(p,enabled),false,p);
});

test('subscriber media and signed raw targets are fenced but subscriber login and catalog remain available',()=>{
 for(const p of ['/api/v1/subscribers/xtream/live/a/b/1.ts','/api/v1/subscribers/xtream/movie/a/b/2.mp4','/api/v1/subscribers/xtream/series/a/b/3.mp4','/api/v1/subscribers/xtream/url/token/a/b','/api/v1/subscribers/xtream/raw/token/path'])assert.equal(blocksDuringLinodeMaintenance(p,enabled),true,p);
 for(const p of ['/api/v1/subscribers/session','/api/v1/subscribers/health','/api/v1/subscribers/xtream/player_api.php'])assert.equal(blocksDuringLinodeMaintenance(p,enabled),false,p);
});
