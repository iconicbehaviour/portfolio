/**
 * POST /api/twin — the Digital Twin.
 *
 *   { mode: "chat",  question, history?: [{role, text}], turn?: number }
 *   { mode: "match", requisition }
 *
 * Answers only from the knowledge base (netlify/functions/twin-kb.json, built from the portfolio by
 * scripts/build-kb.mjs). See netlify/lib/twin-core.mjs for how that is enforced.
 *
 * Env: ANTHROPIC_API_KEY (required), TWIN_MODEL (default claude-haiku-5-5), ANTHROPIC_BASE_URL (tests only).
 * Without a key it answers 503 and the page falls back to its static Q&A.
 */
import kb from './twin-kb.json' with { type: 'json' };
import twinConfig from '../../twin/config.json' with { type: 'json' };
import {
  LIMITS,
  MIN_TOP_SCORE,
  MATCH_SYSTEM,
  SYSTEM,
  answerTool,
  buildIndex,
  callModel,
  chatMessages,
  clean,
  isSmallTalk,
  matchMessages,
  matchTool,
  rateLimited,
  retrieve,
  routedTopic,
  scrub,
  validateAnswer,
  validateMatch,
} from '../lib/twin-core.mjs';

const index = buildIndex(kb.docs);
const handoff = (reason) => ({ reason, email: twinConfig.email, bookingUrl: twinConfig.bookingUrl ?? null });

const cors = (req) => {
  const origin = req.headers.get('origin');
  const ok = origin && (twinConfig.allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    ...(ok ? { 'access-control-allow-origin': origin } : {}),
    vary: 'origin',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  };
};

const json = (req, status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(req) } });

// Best-effort log of what the twin could not answer. Question text only, no identity. Never blocks a reply.
async function logEvent(entry) {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('twin-log');
    await store.setJSON(`${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`, entry);
  } catch {
    /* logging is optional (not available locally) */
  }
}

const INTRO = {
  kind: 'intro',
  answer:
    "I'm NJ's digital twin. I can tell you about her work, projects and background, and I answer only from what is on this portfolio. You can ask me a question, or use “Match a job description” to see which of her past work relates to a role.",
  sources: [],
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(ip)) return json(req, 429, { error: 'rate_limited' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: 'bad_json' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.TWIN_MODEL || 'claude-haiku-5-5';
  const baseUrl = process.env.ANTHROPIC_BASE_URL || undefined;
  const mode = body?.mode === 'match' ? 'match' : 'chat';

  // ---------- requisition match ----------
  if (mode === 'match') {
    const requisition = clean(body.requisition, LIMITS.requisition);
    if (requisition.length < 40) return json(req, 400, { error: 'requisition_too_short' });
    const hits = retrieve(index, requisition, { k: 12, perRoute: 3 });
    if (!hits.length) return json(req, 200, { ok: true, kind: 'match', match: { items: [], gaps: [] }, handoff: handoff('match') });
    if (!apiKey) return json(req, 503, { error: 'not_configured' });
    try {
      const out = await callModel({ apiKey, baseUrl, model, system: MATCH_SYSTEM, messages: matchMessages({ requisition, hits }), tool: matchTool, maxTokens: 1200 });
      const { matches, gaps } = validateMatch(out, hits);
      return json(req, 200, { ok: true, kind: 'match', match: { items: matches, gaps }, handoff: handoff('match') });
    } catch (e) {
      console.error('twin match failed:', e?.message);
      return json(req, 502, { error: 'model_unavailable' });
    }
  }

  // ---------- chat ----------
  const question = clean(body.question, LIMITS.question);
  if (!question) return json(req, 400, { error: 'empty_question' });
  const turn = Number.isFinite(body.turn) ? Math.max(1, Math.floor(body.turn)) : 1;
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-LIMITS.history)
    .map((m) => ({ role: m?.role === 'user' ? 'user' : 'twin', text: clean(m?.text, LIMITS.historyItem) }))
    .filter((m) => m.text);

  if (isSmallTalk(question)) return json(req, 200, { ok: true, ...INTRO, handoff: null });

  // Not the twin's to answer. Say so, route to NJ, and keep no text of the question.
  const routed = routedTopic(question);
  if (routed) {
    logEvent({ t: Date.now(), kind: 'routed', topic: routed });
    return json(req, 200, {
      ok: true,
      kind: 'routed',
      answer: `That one is mine to answer in person, not the twin's (${routed}). The quickest way is to talk to me directly.`,
      sources: [],
      handoff: handoff('routed'),
    });
  }

  // A short follow-up ("and what did you do there?") is searched together with the previous question.
  const prevQ = [...history].reverse().find((m) => m.role === 'user')?.text ?? '';
  const query = question.split(' ').length < 6 && prevQ ? `${prevQ} ${question}` : question;
  const hits = retrieve(index, query, { k: 6, perRoute: 3 });

  const unknown = () => {
    logEvent({ t: Date.now(), kind: 'unanswered', q: scrub(question).slice(0, 300) });
    return json(req, 200, {
      ok: true,
      kind: 'unknown',
      answer: "I don't have that in what I know, and I'd rather not guess. NJ can answer it directly.",
      sources: [],
      handoff: handoff('unknown'),
    });
  };

  if (!hits.length || hits[0].score < MIN_TOP_SCORE) return unknown();
  if (!apiKey) return json(req, 503, { error: 'not_configured' });

  try {
    const out = await callModel({ apiKey, baseUrl, model, system: SYSTEM, messages: chatMessages({ question, history, hits }), tool: answerTool });
    const v = validateAnswer(out, hits, question);
    if (!v.ok) return unknown();
    return json(req, 200, {
      ok: true,
      kind: 'answer',
      answer: v.answer,
      sources: v.sources,
      handoff: turn >= 3 && turn % 3 === 0 ? handoff('probing') : null,
    });
  } catch (e) {
    console.error('twin chat failed:', e?.message);
    return json(req, 502, { error: 'model_unavailable' });
  }
};

export const config = { path: '/api/twin' };
