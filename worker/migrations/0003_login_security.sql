ALTER TABLE login_attempts
ADD COLUMN attempt_id TEXT;

CREATE UNIQUE INDEX idx_login_attempt_id
ON login_attempts(attempt_id);

CREATE TABLE login_blocks (
    ip TEXT PRIMARY KEY,
    blocked_until INTEGER NOT NULL
);
