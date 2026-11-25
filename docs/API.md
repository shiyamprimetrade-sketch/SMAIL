# SMAIL API

Base URL: https://api.slickk.online

Only GET /health is implemented in Milestone 1. All other endpoints below are planned, not available.

### 7.3 REST API Contract
All request/response bodies are JSON (except binary attachment downloads). Errors return `{ "error": "code", "message": "text" }` with appropriate HTTP status codes (`400`, `401`, `403`, `404`, `413`, `429`, `500`). Lists use cursor pagination: `?limit=30&cursor=<opaque>` and return `{ items, nextCursor }`.

| Method & Path | Purpose | Request | Response |
| :--- | :--- | :--- | :--- |
| `GET /health` | Liveness check | none | `{ ok: true }` |
| `POST /auth/login` | Log in | `{ password, deviceLabel }` | `{ accessToken, refreshToken, expiresIn }` |
| `POST /auth/refresh` | Rotate tokens | `{ refreshToken }` | `{ accessToken, refreshToken, expiresIn }` |
| `POST /auth/logout` | Revoke token | `{ refreshToken }` | `{ ok: true }` |
| `GET /messages` | List a folder | query: `folder, limit, cursor, unread, starred` | `{ items: MessageSummary[], nextCursor }` |
| `GET /messages/:id` | Full message | none | `Message` with attachments metadata |
| `GET /threads/:id` | All messages in conversation (oldest first) | none | `{ thread, messages: Message[] }` |
| `POST /messages/send` | Send mail | `{ to[], cc[], bcc[], subject, text, html?, inReplyTo?, threadId?, draftId?, attachments[] }` | `{ id, threadId, status }` |
| `POST /messages/draft` | Create or update draft | same as send, plus optional `id` | `{ id, threadId }` |
| `PATCH /messages/:id` | Change state | `{ folder?, isRead?, isStarred? }` | `{ ok: true }` |
| `POST /messages/bulk` | Bulk state change | `{ ids[], folder?, isRead?, isStarred? }` | `{ ok: true, count }` |
| `DELETE /messages/:id` | Move to trash, or permanently erase if already in trash | none | `{ ok: true }` |
| `GET /search` | Full-text search | query: `q, limit, cursor` | `{ items: MessageSummary[], nextCursor }` |
| `GET /attachments/:id` | Download attachment | none | Raw bytes with `Content-Type` & `Content-Disposition` |
| `GET /counts` | Unread count per folder | none | `{ inbox, sent, drafts, starred, archive, spam, trash }` |
| `GET /sync` | Incremental sync since timestamp | query: `since` (ms) | `{ messages: MessageSummary[], deletedIds[], serverTime }` |
| `GET /settings` & `PUT /settings` | Signature, display name, notifications | `{ signature, displayName, notificationsEnabled }` | same object |
| `POST /devices` | Register FCM token | `{ fcmToken, label }` | `{ ok: true }` |
| `GET /contacts` | Autocomplete | query: `q` | `{ items: { email, name }[] }` |
| `POST /webhooks/resend` | Delivery events | Resend payload (verified by signature) | `{ ok: true }` |

**Type Definition:**
`MessageSummary = { id, threadId, fromName, fromAddr, subject, snippet, folder, isRead, isStarred, hasAttachments, date, direction }`
