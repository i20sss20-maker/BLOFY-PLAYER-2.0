// Optional, owner-approved daily Xtream CATALOG refresh, never media copying.
// Kept separate from private Content Hub upload flags and subscriber playback.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function riyadhDailyCatalogWindow(now = new Date(), env = {}) {
  if (env.BLOFY_XTREAM_DAILY_CATALOG_SYNC_ENABLED !== '1')
    return { due: false, code: 'disabled' };
  const date = new Date(now);
  if (!Number.isFinite(date.getTime()))
    return { due: false, code: 'clock_invalid' };
  // Saudi Arabia has a fixed UTC+03 offset; Intl avoids any host TZ dependency.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(x => [x.type, x.value]));
  const localDay = [parts.year, parts.month, parts.day].join('-');
  if (Number(parts.hour) !== 4)
    return { due: false, code: 'outside_local_window', localDay };
  return { due: true, code: 'daily_window', localDay };
}

export async function requestDailyXtreamCatalogSync({
  env = {}, now = new Date(), db, getSource, startSync, isBusy = () => false
} = {}) {
  const window = riyadhDailyCatalogWindow(now, env);
  if (!window.due) return { requested: false, code: window.code };
  const sourceId = String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID || '').trim();
  if (!UUID.test(sourceId))
    return { requested: false, code: 'source_not_configured' };
  if (!db || typeof db.query !== 'function' ||
      typeof getSource !== 'function' || typeof startSync !== 'function')
    return { requested: false, code: 'daily_sync_dependencies_missing' };
  const source = await getSource(sourceId);
  // Never bulk-refresh unrelated providers merely because they exist.
  if (!source || source.id !== sourceId ||
      String(source.name || '').trim().toLowerCase() !== 'saleh' ||
      source.enabled !== true || source.deletion_requested_at)
    return { requested: false, code: 'source_not_approved' };
  if (isBusy(sourceId)) return { requested: false, code: 'source_already_busy' };

  // Cross-replica idempotency: at most one request per local day.
  await db.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_daily_catalog_requests (
    source_id UUID NOT NULL,
    local_day DATE NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','completed','partial','failed')),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (source_id, local_day)
  )`);
  await db.query(`ALTER TABLE blofy_xtream_daily_catalog_requests
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
  const claim = await db.query(`INSERT INTO blofy_xtream_daily_catalog_requests
    (source_id, local_day) VALUES ($1, $2::date)
    ON CONFLICT DO NOTHING RETURNING source_id`, [sourceId, window.localDay]);
  if (claim.rowCount !== 1)
    return { requested: false, code: 'already_requested_today' };
  try {
    const job = startSync(sourceId, ['live', 'movie', 'series']);
    return {
      requested: true, code: 'catalog_queued',
      queued: job?.queued === true,
      localDay: window.localDay,
      mediaFilesCopied: 0, customerCutover: false
    };
  } catch (error) {
    // An enqueue failure is not a successful daily refresh. Allow a new
    // attempt later in the window; never mutate provider or customer rows.
    await db.query(`DELETE FROM blofy_xtream_daily_catalog_requests
      WHERE source_id=$1 AND local_day=$2::date`,
      [sourceId, window.localDay]).catch(() => {});
    throw error;
  }
}
