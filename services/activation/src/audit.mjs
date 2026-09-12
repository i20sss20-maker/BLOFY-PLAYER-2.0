const ALLOWED = new Set(['playlist_saved','playlist_removed','activation_changed','subscription_granted','support_created','support_updated','release_updated']);
export async function recordAudit(client, deviceId, action, details = {}, actor = 'admin') {
  if (!ALLOWED.has(action)) throw new Error('invalid_audit_action');
  const safe = {};
  for (const key of ['playlistId','planKey','status','expiresAt','channel','versionName','ticketId']) {
    if (details[key] != null) safe[key] = String(details[key]).slice(0,128);
  }
  await client.query('INSERT INTO device_audit(device_id,actor,action,details) VALUES($1,$2,$3,$4::jsonb)',
    [deviceId || null, actor === 'device' ? 'device' : 'admin', action, JSON.stringify(safe)]);
}
