/**
 * GET /api/twin-log — NJ's view of what the twin could not answer (newest first).
 * Requires `Authorization: Bearer <TWIN_ADMIN_TOKEN>`. Without that env var set, it is disabled.
 * Entries hold the question text only (emails and phone numbers scrubbed) and no identity.
 * Delete one with DELETE /api/twin-log?key=<key>.
 */
import { getStore } from '@netlify/blobs';

const json = (status, body) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  const token = process.env.TWIN_ADMIN_TOKEN;
  if (!token) return json(404, { error: 'disabled' });
  if (req.headers.get('authorization') !== `Bearer ${token}`) return json(401, { error: 'unauthorized' });

  const store = getStore('twin-log');
  const url = new URL(req.url);

  if (req.method === 'DELETE') {
    const key = url.searchParams.get('key');
    if (!key) return json(400, { error: 'key_required' });
    await store.delete(key);
    return json(200, { ok: true });
  }

  const { blobs } = await store.list();
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 200);
  const entries = await Promise.all(keys.map(async (key) => ({ key, ...(await store.get(key, { type: 'json' })) })));
  const counts = entries.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
  return json(200, { counts, entries });
};

export const config = { path: '/api/twin-log' };
