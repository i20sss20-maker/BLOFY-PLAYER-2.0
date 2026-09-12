/** Administrator-only device visibility. First registration is NOT an APK install timestamp. */
export class DeviceAdminError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
export const DEVICE_ADMIN_SCHEMA = `CREATE TABLE IF NOT EXISTS device_admin_metadata (
 device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
 notes TEXT NOT NULL DEFAULT '', revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0),
 resume_status TEXT CHECK(resume_status IS NULL OR resume_status IN ('active','trial','expired')), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;
const millis = value => { const n = value == null ? NaN : new Date(value).getTime(); return Number.isFinite(n) ? n : null; };
export function deviceView(row, now = Date.now()) {
  const expiresAt = millis(row.expires_at), firstSeenAt = millis(row.created_at), lastSeenAt = millis(row.last_seen_at);
  const status = ['active', 'trial'].includes(row.status) && expiresAt != null && expiresAt <= now ? 'expired' : row.status;
  return { deviceId: row.device_id, name: row.customer_name || '', phone: row.customer_phone || '', email: row.customer_email || '',
    notes: row.notes || '', revision: Number(row.revision || 0), rawStatus: row.status, status, expiresAt,
    firstSeenAt, trialStartedAt: millis(row.trial_started_at), lastSeenAt,
    isNew: firstSeenAt != null && firstSeenAt <= now && now - firstSeenAt < 86400000,
    recentlySeen: lastSeenAt != null && lastSeenAt <= now && now - lastSeenAt < 600000,
    remainingDays: expiresAt == null ? null : Math.max(0, Math.ceil((expiresAt - now) / 86400000)),
    clientVersion: row.last_app_version || null, platform: row.last_platform || null,
    playlistCount: Number(row.playlist_count || 0), activePlaylist: row.active_playlist || null,
    playlistUpdatedAt: millis(row.playlist_updated_at), authLockedUntil: millis(row.auth_locked_until) };
}
export function deviceFilters(params) {
  const allowed = ['all','new24h','new7d','trial','active','expired','blocked','noPlaylists','recent','inactive7d','expiring7d'];
  const filter = params.get('filter') || 'all', sort = params.get('sort') || 'newest';
  if (!allowed.includes(filter) || !['newest','seen','expiry'].includes(sort)) throw new DeviceAdminError('invalid_filter');
  const page = Number(params.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new DeviceAdminError('invalid_page');
  return { q: String(params.get('q') || '').trim().slice(0,128), version: String(params.get('version') || '').trim().slice(0,64), filter, sort, page, limit: 50 };
}
export function validateDeviceProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new DeviceAdminError('invalid_device_edit');
  const fields = {};
  for (const [key, max] of [['name',120],['phone',32],['email',254],['notes',2000]]) {
    if (typeof body[key] !== 'string' || body[key].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body[key])) throw new DeviceAdminError('invalid_device_edit');
    fields[key] = body[key].trim();
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new DeviceAdminError('invalid_device_email');
  return { ...fields, expectedRevision: body.expectedRevision };
}
const ID = /^BLOFY-[A-Z0-9-]{4,32}$/i;
const ROOT = '/api/v1/admin/device-manager';
const statusSql = `CASE WHEN d.status IN ('active','trial') AND d.expires_at<=NOW() THEN 'expired' ELSE d.status END`;
const joins = `FROM devices d LEFT JOIN device_customers c ON c.device_id=d.device_id LEFT JOIN device_admin_metadata m ON m.device_id=d.device_id`;
const columns = `d.device_id,d.status,d.created_at,d.trial_started_at,d.expires_at,d.last_seen_at,d.last_app_version,d.last_platform,d.auth_locked_until,
 c.customer_name,c.customer_email,c.customer_phone,m.notes,m.revision,
 (SELECT COUNT(*)::int FROM device_playlists p WHERE p.device_id=d.device_id) AS playlist_count,
 (SELECT p.name FROM device_playlists p WHERE p.device_id=d.device_id AND p.active=TRUE ORDER BY p.updated_at DESC LIMIT 1) AS active_playlist,
 (SELECT MAX(p.updated_at) FROM device_playlists p WHERE p.device_id=d.device_id) AS playlist_updated_at`;
export function createDeviceAdmin({ pool, requireAdmin, readJson, json, ensureAdmin = async () => {} }) {
  let ready;
  async function ensure() {
    if (!ready) ready = (async () => {
      await ensureAdmin(); const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(718420655)'); await client.query(DEVICE_ADMIN_SCHEMA); await client.query('COMMIT'); }
      catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally { client.release(); }
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function list(params) {
    const f = deviceFilters(params);
    const clause = { all:'TRUE', new24h:"d.created_at BETWEEN NOW()-INTERVAL '24 hours' AND NOW()", new7d:"d.created_at BETWEEN NOW()-INTERVAL '7 days' AND NOW()",
      trial:`(${statusSql})='trial'`, active:`(${statusSql})='active'`, expired:`(${statusSql})='expired'`, blocked:"d.status='blocked'",
      noPlaylists:'NOT EXISTS(SELECT 1 FROM device_playlists p WHERE p.device_id=d.device_id)', recent:"d.last_seen_at BETWEEN NOW()-INTERVAL '10 minutes' AND NOW()",
      expiring7d:"d.status IN ('active','trial') AND d.expires_at>NOW() AND d.expires_at<=NOW()+INTERVAL '7 days'",
      inactive7d:"(d.last_seen_at IS NULL OR d.last_seen_at<NOW()-INTERVAL '7 days')" }[f.filter];
    const order = { newest:'d.created_at DESC,d.device_id',seen:'d.last_seen_at DESC NULLS LAST,d.device_id',expiry:'d.expires_at ASC NULLS LAST,d.device_id' }[f.sort];
    const where = `WHERE ($1='' OR d.device_id ILIKE $2 OR c.customer_name ILIKE $2 OR c.customer_phone ILIKE $2) AND ($3='' OR d.last_app_version=$3) AND ${clause}`;
    const values = [f.q, '%' + f.q.replace(/[\\%_]/g, '\\$&') + '%', f.version];
    const result = await pool.query(`SELECT ${columns} ${joins} ${where} ORDER BY ${order} LIMIT $4 OFFSET $5`, [...values,f.limit,(f.page-1)*f.limit]);
    const total = await pool.query(`SELECT COUNT(*)::int AS total ${joins} ${where}`, values);
    const counts = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE created_at BETWEEN NOW()-INTERVAL '24 hours' AND NOW())::int AS new24h,
     COUNT(*) FILTER(WHERE created_at BETWEEN NOW()-INTERVAL '7 days' AND NOW())::int AS new7d,
     COUNT(*) FILTER(WHERE last_seen_at BETWEEN NOW()-INTERVAL '10 minutes' AND NOW())::int AS recent FROM devices`);
    const now = Date.now();
    return { items:result.rows.map(row=>deviceView(row,now)),total:total.rows[0].total,page:f.page,pageSize:f.limit,counts:counts.rows[0],serverTime:now };
  }
  async function detail(id) {
    const row = (await pool.query(`SELECT ${columns} ${joins} WHERE d.device_id=$1`,[id])).rows[0];
    if (!row) throw new DeviceAdminError('device_not_found',404);
    return deviceView(row);
  }
  async function mutate(id, action, body) {
    const profile = action==='profile' ? validateDeviceProfile(body) : null;
    if (!profile && (!body || !['block','unblock'].includes(body.action) || !['trial','active','expired','blocked'].includes(body.expectedStatus) ||
        !Object.hasOwn(body,'expectedExpiresAt') || body.expectedExpiresAt!==null && (!Number.isSafeInteger(body.expectedExpiresAt) || body.expectedExpiresAt<0))) throw new DeviceAdminError('invalid_device_edit');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT status,expires_at FROM devices WHERE device_id=$1 FOR UPDATE',[id])).rows[0];
      if (!row) throw new DeviceAdminError('device_not_found',404);
      await client.query('INSERT INTO device_admin_metadata(device_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
      const meta = (await client.query('SELECT * FROM device_admin_metadata WHERE device_id=$1 FOR UPDATE',[id])).rows[0];
      if (profile) {
        if (Number(meta.revision)!==profile.expectedRevision) throw new DeviceAdminError('device_changed',409);
        await client.query(`INSERT INTO device_customers(device_id,customer_name,customer_email,customer_phone,source) VALUES($1,$2,$3,$4,'admin')
          ON CONFLICT(device_id) DO UPDATE SET customer_name=$2,customer_email=$3,customer_phone=$4,updated_at=NOW()`,[id,profile.name,profile.email,profile.phone]);
        await client.query('UPDATE device_admin_metadata SET notes=$2,revision=revision+1,updated_at=NOW() WHERE device_id=$1',[id,profile.notes]);
      } else {
        if (row.status!==body.expectedStatus || millis(row.expires_at)!==body.expectedExpiresAt) throw new DeviceAdminError('device_changed',409);
        if (body.action==='block') {
          if (row.status==='blocked') throw new DeviceAdminError('device_changed',409);
          await client.query('UPDATE device_admin_metadata SET resume_status=$2,revision=revision+1,updated_at=NOW() WHERE device_id=$1',[id,row.status]);
          await client.query("UPDATE devices SET status='blocked',updated_at=NOW() WHERE device_id=$1",[id]);
        } else {
          if (row.status!=='blocked' || !['trial','active','expired'].includes(meta.resume_status)) throw new DeviceAdminError('device_restore_unavailable',409);
          // Restore the previous entitlement, never create a new trial or extend the expiry.
          await client.query('UPDATE devices SET status=$2,updated_at=NOW() WHERE device_id=$1',[id,['active','trial'].includes(meta.resume_status) && millis(row.expires_at)!=null && millis(row.expires_at)<=Date.now() ? 'expired' : meta.resume_status]);
          await client.query('UPDATE device_admin_metadata SET resume_status=NULL,revision=revision+1,updated_at=NOW() WHERE device_id=$1',[id]);
        }
      }
      await client.query("INSERT INTO device_audit(device_id,actor,action,details) VALUES($1,'admin',$2,$3::jsonb)",[id,profile?'customer_profile_updated':body.action==='block'?'device_blocked':'device_unblocked',JSON.stringify({source:'device_admin'})]);
      await client.query('COMMIT'); return {ok:true};
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; } finally {client.release();}
  }
  return async function handle(req,res,url) {
    if (url.pathname!==ROOT && !url.pathname.startsWith(ROOT+'/')) return false;
    if (!requireAdmin(req,res)) return true;
    try {
      const suffix = url.pathname.slice(ROOT.length); const parts = suffix.split('/').filter(Boolean);
      if (req.method==='GET' && !suffix) { deviceFilters(url.searchParams); await ensure(); json(res,200,await list(url.searchParams)); return true; }
      let id; try { id=decodeURIComponent(parts[0]||''); } catch { throw new DeviceAdminError('invalid_device'); } if(!ID.test(id)) throw new DeviceAdminError('invalid_device');
      if(parts.length>2) throw new DeviceAdminError('not_found',404);
      if(req.method==='GET' && parts.length===1) {await ensure();json(res,200,await detail(id));return true;}
      if((req.method==='PATCH' && parts.length===1) || (req.method==='POST' && parts.length===2 && parts[1]==='status')) {
        const body=await readJson(req);await ensure();json(res,200,await mutate(id,req.method==='PATCH'?'profile':'status',body));return true;
      }
      json(res,405,{error:'method_not_allowed'});return true;
    } catch(error) {if(error instanceof DeviceAdminError) {json(res,error.status,{error:error.message});return true;} throw error;}
  };
}
