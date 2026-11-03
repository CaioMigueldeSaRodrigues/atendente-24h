-- When the customer was first told they talk to a virtual assistant (and where the privacy notice is). Null until then.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS privacy_notice_at TEXT;
