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

-- Existing installations are upgraded in place; these counters enforce a
-- database-backed lockout across service restarts and multiple instances.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS auth_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_auth_failure_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS auth_locked_until TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS previous_activation_code_proof TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS activation_rotated_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS data_deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_devices_auth_locked_until ON devices(auth_locked_until)
  WHERE auth_locked_until IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS device_playlists (
  id UUID PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('xtream','m3u')),
  base_url_enc TEXT NOT NULL,
  username_enc TEXT,
  password_enc TEXT,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_playlists_device ON device_playlists(device_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_playlists_one_active ON device_playlists(device_id) WHERE active = TRUE;

CREATE OR REPLACE FUNCTION blofy_revoke_changed_device_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status='blocked' AND OLD.status IS DISTINCT FROM NEW.status)
     OR OLD.activation_code IS DISTINCT FROM NEW.activation_code THEN
    NEW.session_version := GREATEST(NEW.session_version, OLD.session_version + 1);
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='blofy_device_session_revocation' AND tgrelid='devices'::regclass) THEN
    CREATE TRIGGER blofy_device_session_revocation BEFORE UPDATE ON devices
      FOR EACH ROW EXECUTE FUNCTION blofy_revoke_changed_device_sessions();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS device_trial_claims (
  scope_hash TEXT PRIMARY KEY,
  first_device_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS license_recovery_keys (
  key_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  target_device_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_recovery_active ON license_recovery_keys(device_id) WHERE consumed_at IS NULL;
CREATE TABLE IF NOT EXISTS profile_cloud_snapshots (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(device_id,profile_id)
);
CREATE TABLE IF NOT EXISTS cloud_pair_codes (
  code_hash TEXT PRIMARY KEY,
  source_device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  source_profile_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
