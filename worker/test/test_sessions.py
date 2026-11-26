import sqlite3
import unittest
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOW = 1800000000
TTL = 2592000


class SessionSecurityTests(unittest.TestCase):

    def setUp(self):
        self.db = sqlite3.connect(":memory:")

        for migration in sorted(
            (ROOT / "migrations").glob("*.sql")
        ):
            self.db.executescript(
                migration.read_text()
            )

    def tearDown(self):
        self.db.close()

    def create(self, token_id="old",
               session="session-a",
               expires=NOW + TTL):

        digest = hashlib.sha256(
            token_id.encode()
        ).hexdigest()

        self.db.execute("""
            INSERT INTO refresh_tokens
            (id, token_hash, device_id,
             expires_at, revoked)
            VALUES (?, ?, ?, ?, 0)
        """, (
            token_id, digest, session, expires
        ))

        self.db.commit()
        return digest

    def rotate(self, old_id, next_id):
        digest = hashlib.sha256(
            next_id.encode()
        ).hexdigest()

        with self.db:
            updated = self.db.execute("""
                UPDATE refresh_tokens
                SET revoked = 1, replaced_by = ?
                WHERE id = ?
                  AND revoked = 0
                  AND expires_at > ?
            """, (next_id, old_id, NOW))

            inserted = self.db.execute("""
                INSERT INTO refresh_tokens
                (id, token_hash, device_id,
                 expires_at, revoked)
                SELECT ?, ?, device_id, ?, 0
                FROM refresh_tokens
                WHERE id = ?
                  AND revoked = 1
                  AND replaced_by = ?
            """, (
                next_id, digest,
                NOW + TTL, old_id, next_id
            ))

            self.db.execute("""
                UPDATE refresh_tokens
                SET revoked = 1
                WHERE revoked = 0
                  AND EXISTS (
                    SELECT 1 FROM refresh_tokens
                    WHERE id = ?
                      AND revoked = 1
                      AND (
                        replaced_by IS NULL
                        OR replaced_by <> ?
                      )
                  )
            """, (old_id, next_id))

        return updated.rowcount, inserted.rowcount

    def active(self, session=None):
        sql = """
            SELECT COUNT(*) FROM refresh_tokens
            WHERE revoked = 0
              AND expires_at > ?
        """
        params = [NOW]

        if session is not None:
            sql += " AND device_id = ?"
            params.append(session)

        return self.db.execute(
            sql, params
        ).fetchone()[0]

    def test_migrations(self):
        columns = {
            row[1] for row in self.db.execute(
                "PRAGMA table_info(refresh_tokens)"
            )
        }
        self.assertIn("replaced_by", columns)

    def test_security_indexes(self):
        indexes = {
            row[1] for row in self.db.execute(
                "PRAGMA index_list(refresh_tokens)"
            )
        }

        self.assertTrue({
            "idx_refresh_token_hash",
            "idx_refresh_session",
            "idx_refresh_expiry"
        }.issubset(indexes))

    def test_session_creation(self):
        self.create()
        self.assertEqual(self.active(), 1)

    def test_hash_storage(self):
        digest = self.create()

        stored = self.db.execute("""
            SELECT token_hash
            FROM refresh_tokens
            WHERE id = 'old'
        """).fetchone()[0]

        self.assertEqual(stored, digest)
        self.assertNotEqual(stored, "old")
        self.assertEqual(len(stored), 64)

    def test_duplicate_hash_rejected(self):
        digest = self.create()

        with self.assertRaises(
            sqlite3.IntegrityError
        ):
            self.db.execute("""
                INSERT INTO refresh_tokens
                (id, token_hash, expires_at)
                VALUES (?, ?, ?)
            """, ("duplicate", digest, NOW + TTL))

    def test_successful_rotation(self):
        self.create()

        self.assertEqual(
            self.rotate("old", "new"), (1, 1)
        )

        self.assertEqual(self.active(), 1)

    def test_old_token_revoked(self):
        self.create()
        self.rotate("old", "new")

        revoked = self.db.execute("""
            SELECT revoked FROM refresh_tokens
            WHERE id = 'old'
        """).fetchone()[0]

        self.assertEqual(revoked, 1)

    def test_session_identity_preserved(self):
        self.create()
        self.rotate("old", "new")

        self.assertEqual(
            self.active("session-a"), 1
        )

    def test_replacement_recorded(self):
        self.create()
        self.rotate("old", "new")

        replacement = self.db.execute("""
            SELECT replaced_by FROM refresh_tokens
            WHERE id = 'old'
        """).fetchone()[0]

        self.assertEqual(replacement, "new")

    def test_replay_revokes_all_sessions(self):
        self.create()
        self.create("other", "session-b")

        self.rotate("old", "new")

        self.assertEqual(self.active(), 2)

        self.assertEqual(
            self.rotate("old", "replay"), (0, 0)
        )

        self.assertEqual(self.active(), 0)

    def test_second_rotation_cannot_succeed(self):
        self.create()

        self.assertEqual(
            self.rotate("old", "first"), (1, 1)
        )

        self.assertEqual(
            self.rotate("old", "second"), (0, 0)
        )

    def test_expired_token_cannot_rotate(self):
        self.create(expires=NOW)

        self.assertEqual(
            self.rotate("old", "new"), (0, 0)
        )

        self.assertEqual(self.active(), 0)

    def test_unknown_token_cannot_rotate(self):
        self.create()

        self.assertEqual(
            self.rotate("unknown", "new"), (0, 0)
        )

        self.assertEqual(self.active(), 1)

    def test_logout_revokes_session(self):
        digest = self.create()
        self.create("other", "session-b")

        self.rotate("old", "new")

        self.db.execute("""
            UPDATE refresh_tokens
            SET revoked = 1
            WHERE revoked = 0
              AND device_id IN (
                SELECT device_id
                FROM refresh_tokens
                WHERE token_hash = ?
              )
        """, (digest,))

        self.assertEqual(
            self.active("session-a"), 0
        )

        self.assertEqual(
            self.active("session-b"), 1
        )

    def test_global_revocation(self):
        self.create()
        self.create("other", "session-b")

        self.db.execute("""
            UPDATE refresh_tokens
            SET revoked = 1
            WHERE revoked = 0
        """)

        self.assertEqual(self.active(), 0)

    def test_database_integrity(self):
        self.create()
        self.rotate("old", "new")

        result = self.db.execute(
            "PRAGMA integrity_check"
        ).fetchone()[0]

        self.assertEqual(result, "ok")


if __name__ == "__main__":
    unittest.main(verbosity=2)
