import concurrent.futures
import sqlite3
import tempfile
import threading
import unittest
import uuid

from pathlib import Path


MIGRATIONS = (
    Path(__file__).resolve().parents[1]
    / "migrations"
)

NOW = 1800000000000


def connect(path):
    db = sqlite3.connect(
        path,
        timeout=15,
        isolation_level=None,
    )

    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 15000")

    return db


def deliver(
    db,
    message_id,
    thread_id,
    fail_attachment=False,
):
    record_id = str(uuid.uuid4())

    db.execute("BEGIN IMMEDIATE")

    try:
        db.execute("""
            INSERT INTO threads (
                id,
                subject,
                last_message_at,
                message_count
            )
            VALUES (?, 'invoice', ?, 0)
            ON CONFLICT(id) DO NOTHING
        """, (thread_id, NOW))

        db.execute("""
            INSERT INTO messages (
                id,
                thread_id,
                message_id_header,
                from_addr,
                subject,
                direction,
                created_at,
                updated_at
            )
            VALUES (
                ?, ?, ?,
                'sender@example.com',
                'Invoice',
                'in',
                ?, ?
            )
        """, (
            record_id,
            thread_id,
            message_id,
            NOW,
            NOW,
        ))

        db.execute("""
            INSERT INTO attachments (
                id,
                message_id,
                filename,
                mime,
                size,
                data
            )
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()),
            record_id,
            "invoice.txt",
            "text/plain",
            4,
            None if fail_attachment else b"test",
        ))

        db.execute("""
            UPDATE threads
            SET
                message_count = message_count + 1,
                last_message_at = MAX(
                    last_message_at, ?
                )
            WHERE id = ?
        """, (NOW, thread_id))

        db.execute("COMMIT")

        return "stored"

    except sqlite3.IntegrityError:
        db.execute("ROLLBACK")

        if message_id is not None:
            existing = db.execute("""
                SELECT id
                FROM messages
                WHERE message_id_header = ?
            """, (message_id,)).fetchone()

            if existing:
                return "duplicate"

        raise

    except Exception:
        db.execute("ROLLBACK")
        raise


class DeliveryAtomicityTests(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()

        self.path = str(
            Path(self.temp.name) / "smail.sqlite"
        )

        self.db = connect(self.path)

        self.db.execute("PRAGMA journal_mode = WAL")

        for migration in sorted(
            MIGRATIONS.glob("*.sql")
        ):
            self.db.executescript(
                migration.read_text()
            )

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def count(self, table):
        allowed = {
            "threads",
            "messages",
            "attachments",
        }

        assert table in allowed

        return self.db.execute(
            f"SELECT COUNT(*) FROM {table}"
        ).fetchone()[0]

    def thread_count(self, thread_id):
        return self.db.execute("""
            SELECT message_count
            FROM threads
            WHERE id = ?
        """, (thread_id,)).fetchone()[0]

    def test_first_delivery(self):
        self.assertEqual(
            deliver(
                self.db,
                "<first@example.com>",
                "thread-1",
            ),
            "stored",
        )

        self.assertEqual(
            self.count("messages"), 1
        )

    def test_repeated_delivery(self):
        for _ in range(5):
            deliver(
                self.db,
                "<repeat@example.com>",
                "thread-1",
            )

        self.assertEqual(
            self.count("messages"), 1
        )

    def test_duplicate_attachment_protection(self):
        for _ in range(5):
            deliver(
                self.db,
                "<attachment@example.com>",
                "thread-1",
            )

        self.assertEqual(
            self.count("attachments"), 1
        )

    def test_duplicate_thread_count(self):
        for _ in range(5):
            deliver(
                self.db,
                "<count@example.com>",
                "thread-1",
            )

        self.assertEqual(
            self.thread_count("thread-1"), 1
        )

    def test_duplicate_different_thread(self):
        deliver(
            self.db,
            "<same@example.com>",
            "thread-1",
        )

        result = deliver(
            self.db,
            "<same@example.com>",
            "thread-2",
        )

        self.assertEqual(result, "duplicate")

        self.assertEqual(
            self.count("threads"), 1
        )

    def test_distinct_messages_same_thread(self):
        for i in range(5):
            deliver(
                self.db,
                f"<message-{i}@example.com>",
                "thread-1",
            )

        self.assertEqual(
            self.count("messages"), 5
        )

        self.assertEqual(
            self.thread_count("thread-1"), 5
        )

    def test_missing_message_ids(self):
        deliver(self.db, None, "thread-1")
        deliver(self.db, None, "thread-1")

        self.assertEqual(
            self.count("messages"), 2
        )

    def test_message_id_case_preservation(self):
        deliver(
            self.db,
            "<ABC@example.com>",
            "thread-1",
        )

        deliver(
            self.db,
            "<abc@example.com>",
            "thread-1",
        )

        self.assertEqual(
            self.count("messages"), 2
        )

    def test_attachment_failure_rolls_back(self):
        with self.assertRaises(
            sqlite3.IntegrityError
        ):
            deliver(
                self.db,
                "<failure@example.com>",
                "thread-1",
                fail_attachment=True,
            )

        self.assertEqual(
            self.count("threads"), 0
        )

        self.assertEqual(
            self.count("messages"), 0
        )

        self.assertEqual(
            self.count("attachments"), 0
        )

    def test_retry_after_rollback(self):
        with self.assertRaises(
            sqlite3.IntegrityError
        ):
            deliver(
                self.db,
                "<retry@example.com>",
                "thread-1",
                fail_attachment=True,
            )

        self.assertEqual(
            deliver(
                self.db,
                "<retry@example.com>",
                "thread-1",
            ),
            "stored",
        )

    def test_existing_thread_rollback(self):
        deliver(
            self.db,
            "<original@example.com>",
            "thread-1",
        )

        with self.assertRaises(
            sqlite3.IntegrityError
        ):
            deliver(
                self.db,
                "<failure@example.com>",
                "thread-1",
                fail_attachment=True,
            )

        self.assertEqual(
            self.thread_count("thread-1"), 1
        )

        self.assertEqual(
            self.count("messages"), 1
        )

    def test_concurrent_duplicate_delivery(self):
        workers = 12

        barrier = threading.Barrier(workers)

        def task(i):
            db = connect(self.path)

            try:
                barrier.wait(timeout=15)

                return deliver(
                    db,
                    "<concurrent@example.com>",
                    f"thread-{i}",
                )
            finally:
                db.close()

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=workers
        ) as pool:
            results = list(
                pool.map(task, range(workers))
            )

        self.assertEqual(
            results.count("stored"), 1
        )

        self.assertEqual(
            results.count("duplicate"),
            workers - 1,
        )

        self.assertEqual(
            self.count("messages"), 1
        )

        self.assertEqual(
            self.count("threads"), 1
        )

        self.assertEqual(
            self.count("attachments"), 1
        )

    def test_concurrent_distinct_deliveries(self):
        workers = 12

        barrier = threading.Barrier(workers)

        def task(i):
            db = connect(self.path)

            try:
                barrier.wait(timeout=15)

                return deliver(
                    db,
                    f"<distinct-{i}@example.com>",
                    "thread-shared",
                )
            finally:
                db.close()

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=workers
        ) as pool:
            results = list(
                pool.map(task, range(workers))
            )

        self.assertEqual(
            results.count("stored"), workers
        )

        self.assertEqual(
            self.count("messages"), workers
        )

        self.assertEqual(
            self.count("attachments"), workers
        )

        self.assertEqual(
            self.count("threads"), 1
        )

        self.assertEqual(
            self.thread_count("thread-shared"),
            workers,
        )


if __name__ == "__main__":
    unittest.main()
