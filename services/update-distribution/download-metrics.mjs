/** Aggregate delivery counts only: no IP addresses, cookies or device fingerprints. */
export async function ensureDownloadMetrics(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS blofy_download_metrics_meta (
    id SMALLINT PRIMARY KEY CHECK (id=1), started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS blofy_download_completions (
    key TEXT NOT NULL, day DATE NOT NULL, completed_count BIGINT NOT NULL DEFAULT 0 CHECK(completed_count>=0),
    last_completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(key,day)
  )`);
  await client.query('INSERT INTO blofy_download_metrics_meta(id) VALUES(1) ON CONFLICT DO NOTHING');
}

export async function recordCompletedDownload(pool, key) {
  if (!/^(?:blofy|app:[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(key)) throw new Error('invalid_download_stat_key');
  await pool.query(`INSERT INTO blofy_download_completions(key,day,completed_count,last_completed_at)
    VALUES($1,(NOW() AT TIME ZONE 'Asia/Riyadh')::date,1,NOW())
    ON CONFLICT(key,day) DO UPDATE SET
      completed_count=blofy_download_completions.completed_count+1,last_completed_at=NOW()`, [key]);
}

/** Count a full response only after both upstream EOF and successful response finish. */
export function observeDownloadCompletion({ req, res, body, status, length, contentRange, onComplete, onError = () => {} }) {
  const expected = Number(length);
  const range = /^bytes 0-(\d+)\/(\d+)$/.exec(String(contentRange || ''));
  const fullResponse = status === 200 && !contentRange ||
    status === 206 && range && Number(range[1]) + 1 === expected && Number(range[2]) === expected;
  if (req.method !== 'GET' || !body || !fullResponse || !Number.isSafeInteger(expected) || expected <= 0) return;
  let bytes = 0, ended = false, failed = false;
  body.on('data', chunk => { bytes += chunk.length; });
  body.once('end', () => { ended = true; });
  body.once('error', () => { failed = true; });
  res.once('error', () => { failed = true; });
  res.once('close', () => { if (!res.writableFinished) failed = true; });
  res.once('finish', () => {
    if (!failed && ended && bytes === expected && res.writableFinished) {
      Promise.resolve().then(onComplete).catch(onError);
    }
  });
}
