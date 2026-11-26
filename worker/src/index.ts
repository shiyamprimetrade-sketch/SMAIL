import type { AppEnv } from './env';
import { auth } from './routes/auth';
import { Hono } from 'hono';
const app = new Hono<AppEnv>();
app.get('/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});
app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404));
app.onError((_error, c) => c.json({ error: 'internal_error', message: 'Internal server error' }, 500));
app.route('/auth', auth);

export default app;
