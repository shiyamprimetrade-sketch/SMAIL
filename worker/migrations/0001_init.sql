CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_threads_last
ON threads(last_message_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id_header TEXT,
  in_reply_to TEXT,
  refs TEXT,
  from_name TEXT,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  bcc_addrs TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT,
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox','sent','drafts','archive','spam','trash')),
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  delivery_status TEXT,
  resend_email_id TEXT,
  spam_score REAL NOT NULL DEFAULT 0,
  raw_size INTEGER,
  received_at INTEGER,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_msg_folder
ON messages(folder, COALESCE(received_at, sent_at, created_at) DESC);

CREATE INDEX idx_msg_thread
ON messages(thread_id);

CREATE UNIQUE INDEX idx_msg_hdr
ON messages(message_id_header)
WHERE message_id_header IS NOT NULL;

CREATE INDEX idx_msg_unread
ON messages(folder, is_read);

CREATE INDEX idx_msg_resend
ON messages(resend_email_id)
WHERE resend_email_id IS NOT NULL;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_id TEXT,
  is_inline INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL
);

CREATE INDEX idx_att_msg
ON attachments(message_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  fcm_token TEXT NOT NULL UNIQUE,
  label TEXT,
  last_seen INTEGER NOT NULL
);

CREATE TABLE contacts (
  email TEXT PRIMARY KEY,
  name TEXT,
  last_used INTEGER NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  device_id TEXT,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX idx_login_ip
ON login_attempts(ip, at);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, from_addr, from_name, text_body,
  content='messages', content_rowid='rowid'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(
    rowid, subject, from_addr, from_name, text_body
  )
  VALUES (
    new.rowid, new.subject, new.from_addr,
    new.from_name, new.text_body
  );
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(
    messages_fts, rowid, subject,
    from_addr, from_name, text_body
  )
  VALUES (
    'delete', old.rowid, old.subject,
    old.from_addr, old.from_name, old.text_body
  );
END;

CREATE TRIGGER messages_au
AFTER UPDATE OF subject, text_body, from_addr, from_name
ON messages BEGIN
  INSERT INTO messages_fts(
    messages_fts, rowid, subject,
    from_addr, from_name, text_body
  )
  VALUES (
    'delete', old.rowid, old.subject,
    old.from_addr, old.from_name, old.text_body
  );

  INSERT INTO messages_fts(
    rowid, subject, from_addr, from_name, text_body
  )
  VALUES (
    new.rowid, new.subject, new.from_addr,
    new.from_name, new.text_body
  );
END;
