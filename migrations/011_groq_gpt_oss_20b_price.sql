-- Initial Groq GPT-OSS 20B price.
-- Source: official Groq model pricing and prompt-caching documentation,
-- checked 2026-10-15. Input is $0.075/M and output is $0.30/M. Groq states
-- cached input receives a 50% discount; the exact persisted rate is $0.0375/M
-- (the model page displays this value rounded to $0.037/M).
INSERT INTO ai_model_prices(
  provider, model, pricing_version,
  input_price_per_million, cached_input_price_per_million,
  output_price_per_million, effective_from, effective_to
) VALUES (
  'groq', 'openai/gpt-oss-20b', 'groq-openai-gpt-oss-20b-2026-10-15',
  0.075, 0.0375, 0.30, '2026-10-15T00:00:00Z', NULL
)
ON CONFLICT (provider, model, effective_from) DO NOTHING;
