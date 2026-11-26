import sqlite3
import unittest
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "0001_init.sql"
)


class SchemaTests(unittest.TestCase):

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(
            MIGRATION.read_text(encoding="utf-8")
        )

    def tearDown(self):
        self.db.close()

    def insert_message(self):
        self.db.execute(
            """INSERT INTO threads
            (id, last_message_at)
            VALUES ('t1', 1000)"""
        )
        self.db.execute(
            """INSERT INTO messages
            (id, thread_id, message_id_header,
             from_addr, subject, text_body,
             direction, created_at, updated_at)
            VALUES
            ('m1', 't1', '<m1@test.invalid>',
             'sender@test.invalid', 'Hello',
             'SMAIL verification', 'in', 1000, 1000)"""
        )

    def test_tables(self):
        expected = {
            "settings", "threads", "messages",
            "attachments", "devices", "contacts",
            "refresh_tokens", "login_attempts",
            "messages_fts"
        }
        actual = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table'"
            )
        }
        self.assertTrue(expected.issubset(actual))

    def test_indexes(self):
        expected = {
            "idx_threads_last", "idx_msg_folder",
            "idx_msg_thread", "idx_msg_hdr",
            "idx_msg_unread", "idx_msg_resend",
            "idx_att_msg", "idx_login_ip"
        }
        actual = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='index'"
            )
        }
        self.assertTrue(expected.issubset(actual))

    def test_triggers(self):
        actual = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='trigger'"
            )
        }
        self.assertEqual(actual, {
            "messages_ai",
            "messages_ad",
            "messages_au"
        })

    def test_settings(self):
        self.db.execute(
            "INSERT INTO settings VALUES (?, ?)",
            ("theme", "dark")
        )
        result = self.db.execute(
            "SELECT value FROM settings WHERE key=?",
            ("theme",)
        ).fetchone()
        self.assertEqual(result[0], "dark")

    def test_foreign_key(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO messages
                (id, thread_id, from_addr, direction,
                 created_at, updated_at)
                VALUES ('m2', 'missing', 'test',
                        'in', 1000, 1000)"""
            )

    def test_invalid_folder(self):
        self.insert_message()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE messages SET folder='invalid'"
            )

    def test_invalid_direction(self):
        self.insert_message()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE messages SET direction='invalid'"
            )

    def test_duplicate_message_id(self):
        self.insert_message()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO messages
                (id, thread_id, message_id_header,
                 from_addr, direction,
                 created_at, updated_at)
                VALUES ('m2', 't1', '<m1@test.invalid>',
                        'test', 'in', 1000, 1000)"""
            )

    def test_fts_insert(self):
        self.insert_message()
        count = self.db.execute(
            "SELECT COUNT(*) FROM messages_fts "
            "WHERE messages_fts MATCH 'verification'"
        ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_fts_update(self):
        self.insert_message()
        self.db.execute(
            "UPDATE messages SET text_body='updated'"
        )
        for term, expected in [
            ("verification", 0), ("updated", 1)
        ]:
            count = self.db.execute(
                "SELECT COUNT(*) FROM messages_fts "
                "WHERE messages_fts MATCH ?", (term,)
            ).fetchone()[0]
            self.assertEqual(count, expected)

    def test_fts_sender_update(self):
        self.insert_message()
        self.db.execute(
            "UPDATE messages SET from_name='Alice'"
        )
        count = self.db.execute(
            "SELECT COUNT(*) FROM messages_fts "
            "WHERE messages_fts MATCH 'Alice'"
        ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_fts_delete(self):
        self.insert_message()
        self.db.execute("DELETE FROM messages")
        count = self.db.execute(
            "SELECT COUNT(*) FROM messages_fts "
            "WHERE messages_fts MATCH 'verification'"
        ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_cascade_delete(self):
        self.insert_message()
        self.db.execute(
            """INSERT INTO attachments
            (id, message_id, filename, mime, size, data)
            VALUES ('a1', 'm1', 'test.txt',
                    'text/plain', 1, X'41')"""
        )
        self.db.execute("DELETE FROM threads")
        for table in ("messages", "attachments"):
            count = self.db.execute(
                f"SELECT COUNT(*) FROM {table}"
            ).fetchone()[0]
            self.assertEqual(count, 0)

    def test_database_integrity(self):
        result = self.db.execute(
            "PRAGMA integrity_check"
        ).fetchone()[0]
        self.assertEqual(result, "ok")


if __name__ == "__main__":
    unittest.main(verbosity=2)
