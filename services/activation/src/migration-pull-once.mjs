const enabled = /^(1|true|yes|on)$/i.test(String(process.env.BLOFY_MIGRATION_PULL_ONCE || '').trim());

if (enabled) {
  const sourceBase = String(process.env.BLOFY_MIGRATION_SOURCE_URL || '').trim();
  const importToken = String(process.env.BLOFY_MIGRATION_IMPORT_TOKEN || '').trim();
  const port = Number(process.env.PORT || 3000);

  const safeSource = (() => {
    try {
      const url = new URL(sourceBase);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null;
      return url;
    } catch { return null; }
  })();

  if (!safeSource || !importToken) {
    console.error('migration_pull_failed:configuration_unavailable');
  } else {
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));

      const statusUrl = new URL('/api/v1/internal/migration-export/status', safeSource);
      const statusResponse = await fetch(statusUrl, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
        headers: { accept: 'application/json', 'cache-control': 'no-cache' }
      });
      const status = await statusResponse.json().catch(() => null);
      if (!statusResponse.ok || status?.protocol !== 'blofy-migration-v1' || status?.enabled !== true) {
        throw new Error('source_export_window_unavailable');
      }

      const exportUrl = new URL('/api/v1/internal/migration-export', safeSource);
      const sourceResponse = await fetch(exportUrl, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(180_000),
        headers: { accept: 'application/json', 'cache-control': 'no-cache' }
      });
      if (!sourceResponse.ok) throw new Error(`source_export_http_${sourceResponse.status}`);
      const envelopeText = await sourceResponse.text();
      if (!envelopeText || Buffer.byteLength(envelopeText) > 16 * 1024 * 1024) throw new Error('source_export_invalid_size');
      const envelope = JSON.parse(envelopeText);
      if (envelope?.protocol !== 'blofy-migration-envelope-v1') throw new Error('source_export_invalid_protocol');

      const localImport = `http://127.0.0.1:${port}/api/v1/internal/migration-import`;
      const importResponse = await fetch(localImport, {
        method: 'POST',
        signal: AbortSignal.timeout(300_000),
        headers: {
          authorization: `Bearer ${importToken}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: envelopeText
      });
      const result = await importResponse.json().catch(() => null);
      if (!importResponse.ok || !['applied','already-applied'].includes(result?.mode)) {
        throw new Error(`target_import_http_${importResponse.status}`);
      }

      const summary = {
        mode: result.mode,
        sourceCounts: result.sourceCounts || null,
        targetCountsAfter: result.targetCountsAfter || null,
        schemaCompatible: result.schemaCompatible ?? true,
        keyCompatible: result.keyCompatible ?? null,
        restartRequired: result.restartRequired === true
      };
      console.log(`BLOFY migration pull completed: ${JSON.stringify(summary)}`);
    } catch (error) {
      console.error(`migration_pull_failed:${String(error?.message || 'unknown').slice(0,160)}`);
    }
  }
}
