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

ALTER TABLE devices ADD COLUMN IF NOT EXISTS auth_failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_auth_failure_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS auth_locked_until TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS previous_activation_code_proof TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS activation_rotated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_devices_auth_locked_until ON devices(auth_locked_until)
  WHERE auth_locked_until IS NOT NULL;

-- Customer records initialize with the shared schema, after their devices parent table.
-- Startup waits for this schema before accepting requests through any HTTP hook.
CREATE TABLE IF NOT EXISTS device_customers (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  source TEXT NOT NULL DEFAULT 'zid',
  last_order_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_customers_email ON device_customers(customer_email);
CREATE INDEX IF NOT EXISTS idx_device_customers_phone ON device_customers(customer_phone);

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

-- Profile-owned cloud backup. This deliberately stores only UX state (watchlist,
-- hidden categories, Home row order and future profile settings), never provider
-- credentials or playback URLs. Revision enables conflict-safe sync.
CREATE TABLE IF NOT EXISTS profile_cloud_snapshots (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(device_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_cloud_updated
  ON profile_cloud_snapshots(device_id, updated_at DESC);

-- Pair & Restore uses a short-lived one-time code. Only its SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS cloud_pair_codes (
  code_hash TEXT PRIMARY KEY,
  source_device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  source_profile_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_pair_codes_expiry
  ON cloud_pair_codes(expires_at) WHERE consumed_at IS NULL;

-- Commercial subscription layer. Payment providers plug into this ledger; app/device
-- activation remains provider-agnostic and is only granted after a verified paid order.
CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices > 0 AND max_devices <= 50),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'SAR',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_orders (
  id UUID PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL REFERENCES subscription_plans(plan_key),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  payment_provider TEXT,
  provider_reference TEXT,
  coupon_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscription_orders_device ON subscription_orders(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_status ON subscription_orders(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_orders_provider_ref
  ON subscription_orders(payment_provider, provider_reference)
  WHERE payment_provider IS NOT NULL AND provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_subscriptions (
  id UUID PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL REFERENCES subscription_plans(plan_key),
  order_id UUID REFERENCES subscription_orders(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active','expired','cancelled','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_subscriptions_device ON device_subscriptions(device_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_subscriptions_active ON device_subscriptions(device_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  payment_provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('received','applied','ignored','failed')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_provider_event
  ON payment_events(payment_provider, provider_event_id);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value BIGINT NOT NULL CHECK (discount_value > 0),
  currency TEXT,
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES coupons(code),
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES subscription_orders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(code, order_id)
);
