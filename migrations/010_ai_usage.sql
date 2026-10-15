CREATE TABLE IF NOT EXISTS ai_model_prices (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  pricing_version TEXT NOT NULL,
  input_price_per_million NUMERIC(20,10) NOT NULL CHECK (input_price_per_million >= 0),
  cached_input_price_per_million NUMERIC(20,10) NOT NULL CHECK (cached_input_price_per_million >= 0),
  output_price_per_million NUMERIC(20,10) NOT NULL CHECK (output_price_per_million >= 0),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model, effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS ai_model_prices_lookup_idx
  ON ai_model_prices(provider, model, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES automotive_businesses(id),
  conversation_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0 AND cached_input_tokens <= input_tokens),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  queue_time_ms INTEGER CHECK (queue_time_ms IS NULL OR queue_time_ms >= 0),
  prompt_time_ms INTEGER CHECK (prompt_time_ms IS NULL OR prompt_time_ms >= 0),
  completion_time_ms INTEGER CHECK (completion_time_ms IS NULL OR completion_time_ms >= 0),
  total_time_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_time_ms >= 0),
  cost_usd NUMERIC(20,10),
  fx_rate NUMERIC(20,10),
  cost_brl NUMERIC(20,10),
  billable_brl NUMERIC(20,10),
  pricing_version TEXT,
  status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK (status IN ('SUCCEEDED', 'FAILED')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
  CHECK (status = 'SUCCEEDED' OR error_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ai_usage_events_business_created_idx
  ON ai_usage_events(business_id, created_at, id);

CREATE INDEX IF NOT EXISTS ai_usage_events_business_conversation_idx
  ON ai_usage_events(business_id, conversation_id, created_at, id);

CREATE INDEX IF NOT EXISTS ai_usage_events_provider_model_created_idx
  ON ai_usage_events(provider, model, created_at);
