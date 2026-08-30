CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  activation_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trial','active','expired','blocked')),
  trial_started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  last_app_version TEXT,
  last_platform TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_expires_at ON devices(expires_at);

CREATE TABLE IF NOT EXISTS playback_diagnostics (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  content_kind TEXT NOT NULL,
  redacted_url TEXT,
  ttff_ms BIGINT,
  buffering_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playback_diag_device_created ON playback_diagnostics(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_diag_provider_created ON playback_diagnostics(provider_key, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_profiles (
  provider_key TEXT PRIMARY KEY,
  live_format TEXT CHECK (live_format IN ('ts','m3u8')),
  preferred_transport TEXT CHECK (preferred_transport IN ('cronet','http')),
  preferred_engine TEXT CHECK (preferred_engine IN ('media3','vlc')),
  allow_cross_protocol_redirects BOOLEAN,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
