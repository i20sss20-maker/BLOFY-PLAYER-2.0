/** Admin-only aggregates from the shared Azure database. Missing metrics are never invented. */
export async function readAdminUsage(pool) {
  const tables = (await pool.query(`SELECT to_regclass('public.blofy_download_stats') AS requests_table,
    to_regclass('public.blofy_download_completions') AS completions_table,
    to_regclass('public.blofy_download_metrics_meta') AS metadata_table`)).rows[0] || {};
  let requests = null, completed = null;
  if (tables.requests_table) {
    const row = (await pool.query(`SELECT COALESCE(SUM(download_count),0)::text AS total,
      COALESCE(SUM(download_count) FILTER(WHERE key='blofy'),0)::text AS blofy,
      MAX(last_download_at) FILTER(WHERE key='blofy') AS last_at FROM blofy_download_stats`)).rows[0];
    requests = { total: Number(row.total), blofy: Number(row.blofy), lastAt: timestamp(row.last_at) };
  }
  if (tables.completions_table && tables.metadata_table) {
    const row = (await pool.query(`SELECT COALESCE(SUM(completed_count),0)::text AS total,
      COALESCE(SUM(completed_count) FILTER(WHERE key='blofy'),0)::text AS blofy,
      COALESCE(SUM(completed_count) FILTER(WHERE key='blofy' AND day=(NOW() AT TIME ZONE 'Asia/Riyadh')::date),0)::text AS today,
      MAX(last_completed_at) FILTER(WHERE key='blofy') AS last_at,
      (SELECT started_at FROM blofy_download_metrics_meta WHERE id=1) AS started_at
      FROM blofy_download_completions`)).rows[0];
    completed = { total: Number(row.total), blofy: Number(row.blofy), today: Number(row.today),
      lastAt: timestamp(row.last_at), startedAt: timestamp(row.started_at), timeZone: 'Asia/Riyadh' };
  }
  return { requests, completed, serverTime: Date.now() };
}

function timestamp(value) {
  return value == null ? null : new Date(value).getTime();
}
