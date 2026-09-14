import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_PATH = process.env.RELEASE_STORE_PATH || '/data/releases.json';

const DEFAULT_RELEASE = {
  versionCode: 2000060,
  versionName: '2.0.0-rc07.49',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.49/BLOFY-PLAYER-2.0-rc07.49-signed.apk',
  releaseNotes: 'BLOFY PLAYER 49 — النسخة المستقرة المبنية على كود الإصدار 46 مع رفع رقم الإصدار فقط للتحديث فوق الإصدارات السابقة دون حذف بيانات العميل.',
  minSupportedVersionCode: 1
};

let state;
let writeChain = Promise.resolve();

function cleanRelease(raw) {
  const versionCode = Number(raw.versionCode);
  const minSupportedVersionCode = Number(raw.minSupportedVersionCode ?? 1);
  const versionName = String(raw.versionName || '').trim();
  const releaseNotes = String(raw.releaseNotes || '').trim();
  const parsed = new URL(String(raw.downloadUrl || '').trim());
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error('invalid_version_code');
  if (!Number.isInteger(minSupportedVersionCode) || minSupportedVersionCode < 1) throw new Error('invalid_min_version');
  if (!versionName || versionName.length > 80) throw new Error('invalid_version_name');
  if (releaseNotes.length > 4000) throw new Error('release_notes_too_long');
  if (parsed.protocol !== 'https:') throw new Error('download_url_must_be_https');
  return { versionCode, versionName, downloadUrl: parsed.toString(), releaseNotes, minSupportedVersionCode };
}

function initialState() {
  return { activeVersionCode: DEFAULT_RELEASE.versionCode, releases: [cleanRelease(DEFAULT_RELEASE)] };
}

async function save() {
  const snapshot = JSON.stringify(state, null, 2) + '\n';
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  writeChain = writeChain.then(async () => {
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, STORE_PATH);
  });
  await writeChain;
}

export async function initReleaseStore() {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, 'utf8'));
    const releases = Array.isArray(raw.releases) ? raw.releases.map(cleanRelease) : [];
    if (!releases.length) throw new Error('empty_release_store');
    const requested = Number(raw.activeVersionCode);
    state = {
      activeVersionCode: releases.some((r) => r.versionCode === requested) ? requested : releases[0].versionCode,
      releases: releases.sort((a, b) => b.versionCode - a.versionCode)
    };
  } catch {
    state = initialState();
    await save();
  }
}

export function getActiveRelease() {
  return state.releases.find((r) => r.versionCode === state.activeVersionCode) || state.releases[0];
}

export function listReleases() {
  return state.releases.map((r) => ({ ...r }));
}

export async function upsertRelease(raw) {
  const release = cleanRelease(raw);
  state.releases = state.releases.filter((r) => r.versionCode !== release.versionCode);
  state.releases.push(release);
  state.releases.sort((a, b) => b.versionCode - a.versionCode);
  await save();
  return release;
}

export async function activateRelease(versionCode) {
  const code = Number(versionCode);
  if (!state.releases.some((r) => r.versionCode === code)) throw new Error('release_not_found');
  state.activeVersionCode = code;
  await save();
  return getActiveRelease();
}

export async function deleteRelease(versionCode) {
  const code = Number(versionCode);
  if (code === state.activeVersionCode) throw new Error('cannot_delete_active_release');
  const before = state.releases.length;
  state.releases = state.releases.filter((r) => r.versionCode !== code);
  if (state.releases.length === before) throw new Error('release_not_found');
  await save();
}
