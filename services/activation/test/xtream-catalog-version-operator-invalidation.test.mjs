import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ensureRevisionAwareGatewayMap} from '../src/xtream-gateway-map-revision-cache.mjs';

test('unchanged version still gets an eventual safety rebuild of gateway IDs',async()=>{
  const cache=new Map();let clock=10,mapped=0;
  const access=()=>ensureRevisionAwareGatewayMap(cache,'live:saleh',async()=>++mapped,
    async()=> '23',{now:()=>clock,ttlMs:60,maxMapAgeMs:240});
  assert.equal(await access(),1);
  clock+=65;
  assert.equal(await access(),1);
  clock+=245;
  assert.equal(await access(),2,'mapping must not remain stale indefinitely');
});

test('every public source item visibility edit bumps source catalog revision',async()=>{
  const admin=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const studio=await readFile(new URL('../src/xtream-studio-pro.mjs',import.meta.url),'utf8');
  const cases=[
    ['patchCategory','async function patchCategory(','// Operator-triggered, transactional'],
    ['patchItem','async function patchItem(','async function updateStudioItem('],
    ['updateStudioItem','async function updateStudioItem(','export async function getXtreamStudioBranding('],
    ['bulkToggle','async function bulkToggle(','async function publicSummary(']
  ];
  for(const [label,start,end] of cases){
    const a=admin.indexOf(start),b=admin.indexOf(end,a+start.length);
    assert.ok(a>=0&&b>a,label);
    assert.match(admin.slice(a,b),/bumpXtreamCatalogRevision\(pool,serverId,'operator_edit'\)/,label);
  }
  assert.match(studio,/if\(result\.rowCount>0\)await bumpXtreamCatalogRevision\(db,serverId,'operator_edit'\)/);
  assert.match(studio,/await bumpXtreamCatalogRevision\(db,serverId,'restored'\)/);
  assert.match(admin,/await bumpXtreamCatalogRevision\(pool,plan\.sourceId,'operator_edit'\)/);
  assert.doesNotMatch(studio,/UPDATE blofy_xtream_gateway_item_map/);
});
