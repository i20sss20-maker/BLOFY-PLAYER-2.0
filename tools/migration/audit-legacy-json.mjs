import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};
const licensesPath = valueAfter('--licenses') || process.env.LEGACY_LICENSES_PATH || '';
const profilesPath = valueAfter('--profiles') || process.env.LEGACY_PROFILES_PATH || '';
if (!licensesPath && !profilesPath) {
  console.error('Provide --licenses <path> and/or --profiles <path>. File contents are never printed.');
  process.exit(2);
}

async function loadJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json_shape');
  return { parsed, bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

const now = Date.now();
const DAY = 86_400_000;
const report = {
  safeAuditVersion: 1,
  generatedAt: new Date(now).toISOString(),
  privacy: 'Aggregate counts and file fingerprints only. No device IDs, codes, pairing values, playlist credentials, customer values, or row contents are included.',
};

try {
  if (licensesPath) {
    const { parsed, bytes, sha256 } = await loadJson(licensesPath);
    const devices = parsed.devices && typeof parsed.devices === 'object' && !Array.isArray(parsed.devices) ? Object.values(parsed.devices) : [];
    const codes = parsed.codes && typeof parsed.codes === 'object' && !Array.isArray(parsed.codes) ? Object.values(parsed.codes) : [];
    let active = 0, trial = 0, expired = 0;
    for (const item of devices) {
      const activatedUntil = Number(item?.activatedUntil || 0);
      const startedAt = Number(item?.startedAt || item?.createdAt || 0);
      if (activatedUntil > now) active += 1;
      else if (startedAt > 0 && startedAt + 7 * DAY > now) trial += 1;
      else expired += 1;
    }
    report.licenses = {
      bytes,
      sha256,
      formatVersion: Number(parsed.version || 0),
      devices: devices.length,
      active,
      trial,
      expired,
      activationCodes: codes.length,
      enabledCodes: codes.filter(item => !item?.disabled).length,
      disabledCodes: codes.filter(item => item?.disabled === true).length,
    };
  }

  if (profilesPath) {
    const { parsed, bytes, sha256 } = await loadJson(profilesPath);
    const devices = parsed.devices && typeof parsed.devices === 'object' && !Array.isArray(parsed.devices) ? Object.values(parsed.devices) : [];
    const aliases = parsed.aliases && typeof parsed.aliases === 'object' && !Array.isArray(parsed.aliases) ? Object.keys(parsed.aliases).length : 0;
    let playlists = 0, devicesWithPlaylists = 0, activePlaylists = 0;
    for (const item of devices) {
      const list = Array.isArray(item?.playlists) ? item.playlists : [];
      if (list.length) devicesWithPlaylists += 1;
      playlists += list.length;
      activePlaylists += list.filter(entry => entry?.id && entry.id === item?.defaultPlaylistId).length;
    }
    report.profiles = {
      bytes,
      sha256,
      formatVersion: Number(parsed.version || 0),
      devices: devices.length,
      aliases,
      playlists,
      devicesWithPlaylists,
      defaultPlaylists: activePlaylists,
    };
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  console.error(`Legacy migration audit failed: ${error?.code || error?.message || 'audit_failed'}`);
  process.exitCode = 1;
}
