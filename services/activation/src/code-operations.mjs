import crypto from 'node:crypto';
import { selectedCodeSource, checkCodeAccount } from './code-account-status.mjs';
import { assertPublicXtreamUrl } from './xtream-core.mjs';
import { createBlofyCodeCrypto } from './blofy-code-handlers.mjs';

// Separate from the code redemption API. Admin-only aggregate data and safe
// saved host presets; never expose code proofs or Xtream account credentials.
export function createCodeOperationsHandlers({
  pool, json, readJson, requireAdmin, secretHex,
  verifyHost = assertPublicXtreamUrl, checkAccount = checkCodeAccount
}) {
  const codec = createBlofyCodeCrypto(secretHex);
  const cleanLabel = value => String(value || '').trim().slice(0, 64);
  const serializeCode = row => ({
    providerId: row.id,
    source: row.source_label || 'BLOFY',
    active: Boolean(row.active),
    boundDeviceId: row.device_id || null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime()
  });

  async function summary(req, res) {
    if (!requireAdmin(req, res)) return;
    const [counts, bySource, alerts] = await Promise.all([
      pool.query(`SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER(WHERE active AND (expires_at IS NULL OR expires_at > NOW()))::integer AS enabled,
        COUNT(*) FILTER(WHERE NOT active)::integer AS revoked,
        COUNT(*) FILTER(WHERE active AND expires_at <= NOW())::integer AS expired,
        COUNT(*) FILTER(WHERE active AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days')::integer AS expiring,
        COUNT(*) FILTER(WHERE active AND device_id IS NOT NULL)::integer AS bound,
        COUNT(*) FILTER(WHERE active AND device_id IS NULL)::integer AS unbound
        FROM blofy_code_subscriptions`),
      pool.query(`SELECT COALESCE(source_label, 'BLOFY') AS source, COUNT(*)::integer AS count
          FROM blofy_code_subscriptions GROUP BY source_label ORDER BY count DESC LIMIT 12`),
      pool.query(`SELECT id,source_label,expires_at,device_id,created_at
        FROM blofy_code_subscriptions
        WHERE active AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        ORDER BY expires_at ASC LIMIT 30`)
    ]);
    return json(res, 200, {
      totals: counts.rows[0],
      sources: bySource.rows.map(x=>({ name:x.source, count:x.count })),
      alerts: alerts.rows.map(x=>({
        providerId:x.id,source:x.source_label || 'BLOFY',
        expiresAt:new Date(x.expires_at).getTime(),boundDeviceId:x.device_id || null
      })),
      note: 'Last known provider expiration from issuance, redemption or explicit check; not real-time background monitoring.',
      checkedAt: Date.now()
    });
  }

  async function search(req, res, url) {
    if (!requireAdmin(req, res)) return;
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    const status = String(url.searchParams.get('status') || 'all');
    if (!['all','active','expired','expiring','revoked','bound','unbound'].includes(status))
      return json(res, 400, {error:'invalid_filter'});
    const limit = 50;
    const page = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('page') || '1',10) || 1));
    const conditions = [];
    const args = [];
    if (query) {
      args.push('%' + query.replace(/[\\%_]/g, '\\$&') + '%');
      conditions.push(`(CAST(id AS TEXT) ILIKE $${args.length} ESCAPE '\\'
        OR COALESCE(device_id,'') ILIKE $${args.length} ESCAPE '\\'
        OR COALESCE(source_label,'BLOFY') ILIKE $${args.length} ESCAPE '\\')`);
    }
    const clauses = {
      active:'active AND (expires_at IS NULL OR expires_at > NOW())',
      expired:'active AND expires_at <= NOW()',
      expiring:`active AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
      revoked:'NOT active', bound:'active AND device_id IS NOT NULL',
      unbound:'active AND device_id IS NULL'
    };
    if (status !== 'all') conditions.push(clauses[status]);
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    args.push(limit, (page-1)*limit);
    const rows = await pool.query(
      `SELECT id,source_label,active,expires_at,device_id,created_at
       FROM blofy_code_subscriptions${where}
       ORDER BY created_at DESC LIMIT $${args.length-1} OFFSET $${args.length}`, args);
    return json(res, 200, {items:rows.rows.map(serializeCode),page,hasMore:rows.rows.length===limit});
  }

  async function hosts(req, res) {
    if (!requireAdmin(req, res)) return;
    const rows = await pool.query(
      'SELECT id,name,source,base_url,created_at FROM blofy_code_host_presets ORDER BY created_at DESC LIMIT 60'
    );
    return json(res, 200, {items: rows.rows.map(x=>({
      id:x.id,name:x.name,source:x.source,host:x.base_url,createdAt:new Date(x.created_at).getTime()
    }))});
  }

  async function addHost(req, res) {
    if (!requireAdmin(req, res)) return;
    const payload = await readJson(req);
    const name = cleanLabel(payload.name);
    if (name.length < 2 || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name))
      return json(res,400,{error:'invalid_host_name'});
    let selected;
    try {
      selected = selectedCodeSource({source:payload.source || 'custom',host:payload.host});
      // Host is operator-entered. Check DNS without making a credentialed request.
      await Promise.race([
        verifyHost(selected.host),
        new Promise((_,reject)=>setTimeout(()=>reject(Error('host_check_timeout')),7000).unref?.())
      ]);
    } catch {
      return json(res,400,{error:'invalid_code_host'});
    }
    const id = crypto.randomUUID();
    try {
      const count = await pool.query('SELECT COUNT(*)::integer AS total FROM blofy_code_host_presets');
      if (count.rows[0].total >= 40) return json(res,409,{error:'too_many_hosts'});
      await pool.query(
        'INSERT INTO blofy_code_host_presets(id,name,source,base_url) VALUES($1,$2,$3,$4)',
        [id,name,selected.source,selected.host]
      );
      return json(res,201,{id,name,source:selected.source,host:selected.host});
    } catch(error) {
      if (error?.code === '23505') return json(res,409,{error:'host_already_saved'});
      throw error;
    }
  }

  async function removeHost(req, res, id) {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json(res,400,{error:'invalid_host_id'});
    const result = await pool.query('DELETE FROM blofy_code_host_presets WHERE id=$1',[id]);
    return json(res,result.rowCount?200:404,result.rowCount?{ok:true}:{error:'host_not_found'});
  }

  async function checkHost(req, res, id) {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json(res,400,{error:'invalid_host_id'});
    const found=await pool.query('SELECT base_url FROM blofy_code_host_presets WHERE id=$1',[id]);
    if(!found.rows.length)return json(res,404,{error:'host_not_found'});
    try {
      await Promise.race([
        verifyHost(found.rows[0].base_url),
        new Promise((_,reject)=>setTimeout(()=>reject(Error('host_check_timeout')),7000).unref?.())
      ]);
      return json(res,200,{ok:true,status:'dns_verified',accountChecked:false});
    } catch {
      return json(res,200,{ok:false,status:'unreachable',accountChecked:false});
    }
  }

  async function checkCode(req,res,id) {
    if (!requireAdmin(req,res)) return;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json(res,400,{error:'invalid_provider_id'});
    const result=await pool.query(
      'SELECT id,active,host_enc,username_enc,password_enc,expires_at FROM blofy_code_subscriptions WHERE id=$1',[id]);
    const row=result.rows[0];
    if(!row)return json(res,404,{error:'code_not_found'});
    if(!row.active)return json(res,409,{error:'code_not_active'});
    if(!row.host_enc)return json(res,409,{error:'legacy_code_no_host'});
    try {
      const host=codec.open(row.host_enc), username=codec.open(row.username_enc), password=codec.open(row.password_enc);
      const status=await checkAccount({host,username,password});
      const expiresAt=status.expiresAt ?? null;
      await pool.query('UPDATE blofy_code_subscriptions SET expires_at=$2,updated_at=NOW() WHERE id=$1',
        [id,expiresAt==null?null:new Date(expiresAt)]);
      return json(res,200,{ok:true,status:status.status||'active',expiresAt,checkedAt:Date.now()});
    }catch(error){
      const reason=String(error?.message||'');
      return json(res,200,{ok:false,status:reason==='code_source_expired'?'expired':
        reason==='code_source_credentials_invalid'?'invalid_account':'unreachable',checkedAt:Date.now()});
    }
  }

  return {summary,search,hosts,addHost,removeHost,checkHost,checkCode};
}
