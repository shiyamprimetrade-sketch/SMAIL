ALTER TABLE refresh_tokens
ADD COLUMN device_label TEXT NOT NULL
DEFAULT 'Unknown device'
CHECK (
  length(device_label) BETWEEN 1 AND 128
);
