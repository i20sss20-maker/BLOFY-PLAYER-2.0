import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { probeAccount } from './account-health.mjs';
import { recordAudit } from './audit.mjs';
import { appReleaseMetadata, sanitizeHttpsUrl, sanitizeVersionCode, sanitizeVersionName, sanitizeReleaseNotes } from './release-metadata.mjs';
import { pseudonymizeDiagnosticProviderKey, sanitizeDiagnosticMessage } from './diagnostics-sanitizer.mjs';

export function createExperienceHandlers({ pool, json, readJson, requireAdmin, authorizedDevice, authorizedAccountDevice = authorizedDevice, probe = probeAccount }) {
  const checked = new Map();
  const ms = value => value ? new Date(value).getTime() : null;
  const normalized = row => ['active','trial'].includes(row.status) && ms(row.expires_at) && ms(row.expires_at) <= Date.now() ? 'expired' : row.status;
  const pageFiles = { '/':'landing.html', '/downloads':'downloads.html', '/account':'account.html' };
  const assetFiles = { '/experience.css':'experience.css', '/experience.js':'experience.js', '/app-preview.png':'app-preview.png' };

  async function releases() {
    const result = await pool.query('SELECT * FROM app_releases ORDER BY channel');
    const items = result.rows.map(row => ({channel:row.channel,versionCode:row.version_code,versionName:row.version_name,downloadUrl:row.download_url,releaseNotes:row.release_notes,updatedAt:ms(row.updated_at)}));
    const configured = appReleaseMetadata();
    if (!items.length && configured) items.push({...configured,channel:/rc|beta|alpha/i.test(configured.versionName)?'testing':'stable'});
    return items;
  }

  async function summary(deviceId) {
    const result = await pool.query(`SELECT d.device_id,d.status,d.expires_at,d.last_seen_at,d.last_app_version,d.last_platform,
      c.customer_name,c.customer_email,c.customer_phone FROM devices d LEFT JOIN device_customers c ON c.device_id=d.device_id WHERE d.device_id=$1`, [deviceId]);
    const row = result.rows[0];
    if (!row) return null;
    const playlists = await pool.query('SELECT id,name,provider_type,active,updated_at FROM device_playlists WHERE device_id=$1 ORDER BY active DESC,updated_at DESC',[deviceId]);
    const tickets = await pool.query('SELECT id,description,status,created_at,updated_at FROM support_tickets WHERE device_id=$1 ORDER BY created_at DESC LIMIT 30',[deviceId]);
    const audit = await pool.query('SELECT id,actor,action,details,created_at FROM device_audit WHERE device_id=$1 ORDER BY created_at DESC LIMIT 50',[deviceId]);
    return {deviceId,status:normalized(row),expiresAt:ms(row.expires_at),lastSeenAt:ms(row.last_seen_at),appVersion:row.last_app_version,platform:row.last_platform,
      customer:{name:row.customer_name,email:row.customer_email,phone:row.customer_phone},
      playlists:playlists.rows.map(p=>({id:p.id,name:p.name,type:p.provider_type,active:p.active,providerKey:pseudonymizeDiagnosticProviderKey(p.id)})),
      tickets:tickets.rows,audit:audit.rows};
  }

  async function check(deviceId, playlistId, res) {
    if (!/^[0-9a-f-]{36}$/i.test(playlistId)) return json(res,400,{error:'invalid_playlist'});
    const key = deviceId + ':' + playlistId;
    if (checked.size > 2000) for (const [k, time] of checked) if (Date.now()-time>30_000) checked.delete(k);
    if (Date.now() - (checked.get(key)||0) < 15_000) return json(res,429,{error:'check_recently_requested'});
    const result = await pool.query('SELECT * FROM device_playlists WHERE device_id=$1 AND id=$2',[deviceId,playlistId]);
    if (!result.rows[0]) return json(res,404,{error:'playlist_not_found'});
    checked.set(key, Date.now());
    return json(res,200,await probe(result.rows[0]));
  }

  async function handle(req,res,url) {
    const pathname = url.pathname;
    if (req.method==='GET' && (pageFiles[pathname] || assetFiles[pathname])) {
      // Existing QR links still enter the device portal.
      if (pathname==='/' && (url.searchParams.has('deviceId') || url.searchParams.has('device') || url.searchParams.has('code') || url.searchParams.has('activationCode'))) return false;
      const file = pageFiles[pathname] || assetFiles[pathname];
      const body = await readFile(new URL('../web/'+file,import.meta.url));
      const type = file.endsWith('.png')?'image/png':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html';
      res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
        'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});
      res.end(body); return true;
    }
    if (req.method==='GET' && pathname==='/api/v1/releases') { json(res,200,{items:await releases()}); return true; }
    const admin = pathname.startsWith('/api/v1/admin/experience');
    const portal = pathname.startsWith('/api/v1/portal/experience');
    if (!admin && !portal) return false;
    let body = {};
    let deviceId = '';
    if (admin) {
      if (!requireAdmin(req,res)) return true;
      if (req.method !== 'GET') body = await readJson(req);
      deviceId = String(body.deviceId || url.searchParams.get('deviceId') || '').trim();
    } else {
      if (req.method !== 'POST') { json(res,405,{error:'method_not_allowed'}); return true; }
      body = await readJson(req);
      deviceId = String(body.deviceId || '').trim();
      // An expired device can still read its status and ask for renewal/support. Transport checks
      // retain the active-device requirement used by the original playlist portal.
      const accountRoute = ['/api/v1/portal/experience/customer','/api/v1/portal/experience/support'].includes(pathname);
      const authorize = accountRoute ? authorizedAccountDevice : authorizedDevice;
      if (!await authorize(deviceId,String(body.activationCode||''),req)) { json(res,403,{error:'unauthorized_device'}); return true; }
    }
    const route = pathname.replace(/^\/api\/v1\/(?:admin|portal)\/experience/,'');
    if (admin && req.method==='GET' && route==='/tickets') {
      const result=await pool.query("SELECT id,device_id,description,created_at FROM support_tickets WHERE status='open' ORDER BY created_at DESC LIMIT 50");
      json(res,200,{items:result.rows}); return true;
    }
    if (admin && req.method==='GET' && route==='/overview') {
      const result = await pool.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER(WHERE status IN ('active','trial') AND (expires_at IS NULL OR expires_at>NOW()))::int active,
        COUNT(*) FILTER(WHERE status='expired' OR (status IN ('active','trial') AND expires_at<=NOW()))::int expired,
        COUNT(*) FILTER(WHERE status IN ('active','trial') AND expires_at>NOW() AND expires_at<=NOW()+INTERVAL '7 days')::int expiring,
        (SELECT COUNT(*)::int FROM support_tickets WHERE status='open') AS support FROM devices`);
      json(res,200,result.rows[0]); return true;
    }
    if (admin && route==='/releases' && req.method==='POST') {
      const channel = body.channel;
      const versionCode = sanitizeVersionCode(body.versionCode), versionName=sanitizeVersionName(body.versionName), downloadUrl=sanitizeHttpsUrl(body.downloadUrl), releaseNotes=sanitizeReleaseNotes(body.releaseNotes);
      if (!['stable','testing'].includes(channel) || !versionCode || !versionName || !downloadUrl) { json(res,400,{error:'invalid_release'}); return true; }
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO app_releases(channel,version_code,version_name,download_url,release_notes) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(channel) DO UPDATE SET version_code=$2,version_name=$3,download_url=$4,release_notes=$5,updated_at=NOW()`,[channel,versionCode,versionName,downloadUrl,releaseNotes]);
        await recordAudit(client,null,'release_updated',{channel,versionName}); await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
      json(res,200,{ok:true}); return true;
    }
    if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId)) { json(res,400,{error:'invalid_device'}); return true; }
    if (route==='/customer' && (admin ? req.method==='GET' : true)) {
      const data=await summary(deviceId);
      if (!data) { json(res,404,{error:'device_not_found'}); return true; }
      if (!admin) { delete data.customer; delete data.audit; }
      json(res,200,data); return true;
    }
    if (route==='/check' && req.method==='POST') { await check(deviceId,String(body.playlistId||''),res); return true; }
    if (route==='/support' && req.method==='POST') {
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE',[deviceId]);
        let ticketId;
        if (admin) {
          if (!/^[0-9a-f-]{36}$/i.test(body.ticketId||'') || !['open','resolved'].includes(body.status)) { await client.query('ROLLBACK'); json(res,400,{error:'invalid_ticket'}); return true; }
          const result=await client.query('UPDATE support_tickets SET status=$3,updated_at=NOW() WHERE id=$1 AND device_id=$2 RETURNING id',[body.ticketId,deviceId,body.status]);
          if (!result.rows[0]) { await client.query('ROLLBACK'); json(res,404,{error:'ticket_not_found'}); return true; }
          ticketId=body.ticketId;
        } else {
          const description=sanitizeDiagnosticMessage(String(body.description||''),1000);
          if (!description || description.length<5) { await client.query('ROLLBACK'); json(res,400,{error:'description_required'}); return true; }
          const recent=await client.query("SELECT id FROM support_tickets WHERE device_id=$1 AND created_at>NOW()-INTERVAL '5 minutes' LIMIT 1",[deviceId]);
          if (recent.rows.length) { await client.query('ROLLBACK'); json(res,429,{error:'support_recently_submitted'}); return true; }
          ticketId=crypto.randomUUID();
          await client.query('INSERT INTO support_tickets(id,device_id,description) VALUES($1,$2,$3)',[ticketId,deviceId,description]);
        }
        await recordAudit(client,deviceId,admin?'support_updated':'support_created',{ticketId,status:admin?body.status:'open'},admin?'admin':'device');
        await client.query('COMMIT'); json(res,200,{ok:true,ticketId}); return true;
      } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
    }
    json(res,404,{error:'not_found'}); return true;
  }
  return {handle,summary,releases};
}
