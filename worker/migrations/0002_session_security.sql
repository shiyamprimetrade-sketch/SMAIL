CREATE UNIQUE INDEX idx_refresh_token_hash
ON refresh_tokens(token_hash);

CREATE INDEX idx_refresh_session
ON refresh_tokens(device_id, revoked, expires_at);

CREATE INDEX idx_refresh_expiry
ON refresh_tokens(expires_at);

ALTER TABLE refresh_tokens
ADD COLUMN replaced_by TEXT;
