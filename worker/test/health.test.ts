import { describe, it, expect } from 'vitest';
import app from '../src/index';
describe('Milestone 1', () => {
  it('returns the health contract', async () => {
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects unknown routes', async () => {
    const response = await app.request('/messages');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error:'not_found',message:'Route not found'});
  });
});
