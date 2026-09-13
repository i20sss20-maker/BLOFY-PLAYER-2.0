/** Every proxy request checks the current entitlement. Do not cache allowed sessions. */
export async function subscriberSessionValid(pool, session, now = Date.now()) {
  if (!session || typeof session.d !== 'string' || !/^BLOFY-[A-Z0-9-]{4,32}$/i.test(session.d) ||
      !Number.isFinite(session.exp) || session.exp <= now) return false;
  const version = session.sv ?? 0; // Old issued tokens belong to the original version only.
  if (!Number.isSafeInteger(version) || version < 0) return false;
  const row = (await pool.query('SELECT status,expires_at,session_version FROM devices WHERE device_id=$1', [session.d])).rows[0];
  if (!row || !['active', 'trial'].includes(row.status) || Number(row.session_version) !== version) return false;
  const expiry = row.expires_at == null ? null : new Date(row.expires_at).getTime();
  return expiry === null || Number.isFinite(expiry) && expiry > now;
}
