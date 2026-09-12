"""Apply the reviewed, narrow integration to the current website branch; assertions stop drift."""
from pathlib import Path
import json
root = Path('services/activation')
def replace(path, before, after, count=1):
    p = root / path
    value = p.read_text()
    if after in value and before not in value:
        return
    assert value.count(before) == count, f'{path}: expected {count} matching anchors'
    p.write_text(value.replace(before, after))

# Keep the existing read-only /device-insights page. Management uses a distinct authenticated API.
for p in ['src/device-admin.mjs','test/device-admin.test.mjs','test/device-admin-runtime.mjs']:
    path = root/p
    path.write_text(path.read_text().replace('/api/v1/admin/device-insights','/api/v1/admin/device-manager'))
replace('src/admin-console-hook.mjs', "import { servePublicDownloads } from './public-downloads.mjs';", "import { servePublicDownloads } from './public-downloads.mjs';\nimport { createDeviceAdmin } from './device-admin.mjs';")
replace('src/admin-console-hook.mjs', "const assets = new Map([", "const deviceAdmin = createDeviceAdmin({ pool, json, readJson, requireAdmin, ensureAdmin });\nconst assets = new Map([\n  ['/device-admin.js', ['device-admin.js', 'text/javascript']], ['/device-admin.css', ['device-admin.css', 'text/css']],")
replace('src/admin-console-hook.mjs', "      if (await handleReleaseAdmin(catalog, req, res, url.pathname, { requireAdmin, readJson, json })) return;", "      if (await deviceAdmin(req, res, url)) return;\n      if (await handleReleaseAdmin(catalog, req, res, url.pathname, { requireAdmin, readJson, json })) return;")
replace('web/admin.html', '<script src="/experience.js" defer></script>', '<link rel="stylesheet" href="/device-admin.css"><script src="/device-admin.js" defer></script><script src="/experience.js" defer></script>')
replace('web/experience.js', "  async function customers(){const current=++customerGeneration;", "  async function customers(){if(window.BlofyDeviceAdmin)return window.BlofyDeviceAdmin.customers(openRecord);const current=++customerGeneration;")
replace('web/experience.js', "    playlistCards($('record-playlists'),data.playlists,id=>request('check',{deviceId,playlistId:id}));", "    if(window.BlofyDeviceAdmin)window.BlofyDeviceAdmin.record(deviceId,()=>current===generation,()=>{openRecord(deviceId);customers();overview().catch(()=>{});});\n    playlistCards($('record-playlists'),data.playlists,id=>request('check',{deviceId,playlistId:id}));")

# Android requests delivery=direct. Preserve the legacy portal response unless the caller explicitly opts in.
replace('src/subscriber-proxy-hook.mjs', "  return sendJson(res, 200, {\n    providerName: 'مشتركين BLOFY',\n    providerType: 'xtream',\n    baseUrl: `${requestOrigin(req)}${XTREAM_PREFIX}`,\n    username: token,\n    password: 'blofy',", "  return sendJson(res, 200, {\n    providerName: 'مشتركين BLOFY',\n    providerType: 'xtream',\n    ...(body.delivery === 'direct'\n      ? { delivery: 'direct', baseUrl: subscriberHost, username, password, sessionToken: token }\n      : { baseUrl: `${requestOrigin(req)}${XTREAM_PREFIX}`, username: token, password: 'blofy' }),")
# Release service/package version drift, not Android version. Keep the public app metadata contract tested.
p = root/'package.json'
data = json.loads(p.read_text()); data['version']='1.1.0'
for path in ['src/device-admin.mjs','web/device-admin.js']:
    command='node --check '+path
    if command not in data['scripts']['check']: data['scripts']['check'] += ' && '+command
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
replace('test/release-metadata.test.mjs', '  activationReleaseMetadata,', '  activationReleaseMetadata,\n  appReleaseMetadata,')
replace('test/release-metadata.test.mjs', '    commitSha\n  });', '    commitSha,\n    app: appReleaseMetadata({})\n  });', 2)
# Verify the true path and fresh expected entitlement: never edit customer data just to pass a test.
