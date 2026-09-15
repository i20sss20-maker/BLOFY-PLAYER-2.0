import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_PATH = process.env.RELEASE_STORE_PATH || '/data/releases.json';
const RELEASE_STAGES = Object.freeze(['draft', 'qa', 'public']);

const DEFAULT_RELEASE = {
  versionCode: 2000060,
  versionName: '2.0.0-rc07.49',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.49/BLOFY-PLAYER-2.0-rc07.49-signed.apk',
  releaseNotes: 'BLOFY PLAYER 49 — النسخة المستقرة المبنية على كود الإصدار 46 مع رفع رقم الإصدار فقط للتحديث فوق الإصدارات السابقة دون حذف بيانات العميل.',
  minSupportedVersionCode: 1,
  stage: 'public'
};

const RC0750_RELEASE = {
  versionCode: 2000061,
  versionName: '2.0.0-rc07.50',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.50/BLOFY-PLAYER-2.0-rc07.50-signed.apk',
  releaseNotes: 'BLOFY PLAYER 50 — جسر فصل قناة التحديث الخارجي. التفعيل والبوابة يبقيان على Vercel كما هما، بينما فحص تحديث النسخة الخارجية يستخدم Railway. لم يتم تغيير Media3 أو FFmpeg أو fallback أو مسارات ومحركات التشغيل أو الثيم.',
  minSupportedVersionCode: 1,
  stage: 'public'
};

let state;
let writeChain = Promise.resolve();

function cleanStage(value, fallback = 'draft') {
  const stage = String(value || '').trim().toLowerCase();
  return RELEASE_STAGES.includes(stage) ? stage : fallback;
}

function cleanRelease(raw, fallbackStage = 'draft') {
  const versionCode = Number(raw.versionCode);
  const minSupportedVersionCode = Number(raw.minSupportedVersionCode ?? 1);
  const versionName = String(raw.versionName || '').trim();
  const releaseNotes = String(raw.releaseNotes || '').trim();
  const parsed = new URL(String(raw.downloadUrl || '').trim());
  if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error('invalid_version_code');
  if (!Number.isInteger(minSupportedVersionCode) || minSupportedVersionCode < 1 || minSupportedVersionCode > versionCode) throw new Error('invalid_min_version');
  if (!versionName || versionName.length > 80) throw new Error('invalid_version_name');
  if (releaseNotes.length > 4000) throw new Error('release_notes_too_long');
  if (parsed.protocol !== 'https:') throw new Error('download_url_must_be_https');
  if (!/\.apk$/i.test(parsed.pathname)) throw new Error('download_url_must_point_to_apk');
  return {
    versionCode,
    versionName,
    downloadUrl: parsed.toString(),
    releaseNotes,
    minSupportedVersionCode,
    stage: cleanStage(raw.stage, fallbackStage)
  };
}

function initialState() {
  return { activeVersionCode: DEFAULT_RELEASE.versionCode, releases: [cleanRelease(DEFAULT_RELEASE, 'public')] };
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

function seedRc0750Once() {
  const existing = state.releases.find((r) => r.versionCode === RC0750_RELEASE.versionCode);
  if (existing) {
    // Existing production installations predate the staged release flow. Preserve them as public
    // instead of unexpectedly hiding a release that customers already received.
    if (existing.stage !== 'public') existing.stage = 'public';
    return false;
  }
  state.releases.push(cleanRelease(RC0750_RELEASE, 'public'));
  state.releases.sort((a, b) => b.versionCode - a.versionCode);
  state.activeVersionCode = RC0750_RELEASE.versionCode;
  return true;
}

export async function initReleaseStore() {
  let needsSave = false;
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, 'utf8'));
    const requested = Number(raw.activeVersionCode);
    const releases = Array.isArray(raw.releases)
      ? raw.releases.map((item) => cleanRelease(item, 'public'))
      : [];
    if (!releases.length) throw new Error('empty_release_store');

    // Releases stored before the staged workflow were already eligible for production. Migrate
    // those rows to public exactly once rather than interpreting them as new Draft builds.
    if (raw.releases?.some((item) => !item.stage)) needsSave = true;

    let active = releases.find((r) => r.versionCode === requested && r.stage === 'public');
    if (!active) {
      active = releases.find((r) => r.stage === 'public') || releases[0];
      if (active.stage !== 'public') active.stage = 'public';
      needsSave = true;
    }
    state = {
      activeVersionCode: active.versionCode,
      releases: releases.sort((a, b) => b.versionCode - a.versionCode)
    };
  } catch {
    state = initialState();
    needsSave = true;
  }

  if (seedRc0750Once()) needsSave = true;
  if (needsSave) await save();
}

export function getActiveRelease() {
  const active = state.releases.find((r) => r.versionCode === state.activeVersionCode && r.stage === 'public');
  if (active) return { ...active };
  const fallback = state.releases.find((r) => r.stage === 'public');
  if (!fallback) throw new Error('no_public_release');
  return { ...fallback };
}

export function listReleases() {
  return state.releases.map((r) => ({ ...r }));
}

export async function upsertRelease(raw) {
  const requestedCode = Number(raw.versionCode);
  const existing = state.releases.find((r) => r.versionCode === requestedCode);
  const release = cleanRelease({ ...raw, stage: existing?.stage || 'draft' }, existing?.stage || 'draft');
  state.releases = state.releases.filter((r) => r.versionCode !== release.versionCode);
  state.releases.push(release);
  state.releases.sort((a, b) => b.versionCode - a.versionCode);
  await save();
  return { ...release };
}

export async function promoteRelease(versionCode) {
  const code = Number(versionCode);
  const release = state.releases.find((r) => r.versionCode === code);
  if (!release) throw new Error('release_not_found');
  if (release.stage === 'draft') release.stage = 'qa';
  else if (release.stage === 'qa') release.stage = 'public';
  else throw new Error('release_already_public');
  await save();
  return { ...release };
}

export async function activateRelease(versionCode) {
  const code = Number(versionCode);
  const release = state.releases.find((r) => r.versionCode === code);
  if (!release) throw new Error('release_not_found');
  if (release.stage !== 'public') throw new Error('release_must_be_public_before_activation');
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
