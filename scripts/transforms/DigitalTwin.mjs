/**
 * Transform for the Digital Twin artboard.
 *
 * The design expresses its chat with {{holes}}, <sc-for> and event bindings, which are design-runtime
 * constructs. This turns them into static Astro markup plus a small client script, and extracts the
 * Q&A content (greeting, questions, answers, fallback, bubble styles) from the design's script into
 * src/data/digital-twin.json — as data, by pattern matching. The design script is never executed.
 *
 * It fails loudly if the design changes shape, so a human/agent can update this file.
 */
const must = (cond, msg) => {
  if (!cond) throw new Error(`DigitalTwin transform: ${msg}`);
};

const strLiteral = (script, name) => {
  const m = script.match(new RegExp(`var ${name} = ("(?:[^"\\\\]|\\\\.)*");`));
  must(m, `could not find var ${name} in the design script`);
  return JSON.parse(m[1]);
};

export default function transform({ body, script }) {
  // ---- content as data ----
  const greeting = strLiteral(script, 'GREETING');
  const fallback = strLiteral(script, 'FALLBACK');
  const twin = strLiteral(script, 'twinBubble');
  const me = strLiteral(script, 'meBubble');
  const row = strLiteral(script, 'row');

  const qaMatch = script.match(/var QA = (\[[\s\S]*?\]);\s*var FALLBACK/);
  must(qaMatch, 'could not find var QA = [...] in the design script');
  let qa;
  try {
    qa = JSON.parse(qaMatch[1].replace(/([{,]\s*)(q|keys|a)\s*:/g, '$1"$2":'));
  } catch (e) {
    throw new Error(`DigitalTwin transform: QA is no longer plain data (${e.message}). Update the transform.`);
  }
  must(Array.isArray(qa) && qa.every((x) => x.q && x.a && Array.isArray(x.keys)), 'QA entries must have q, a and keys');

  const data = { greeting, fallback, qa, styles: { row, twin, me } };

  // ---- markup ----
  let out = body;
  const replacementsExtra = {};
  const swap = (re, to, what) => {
    must(re.test(out), `could not find ${what}`);
    out = out.replace(re, to);
  };

  swap(/onClick="\{\{reset\}\}"/, 'id="twin-clear"', 'the Clear button binding');
  swap(/<div role="log"/, '<div id="twin-log" role="log"', 'the conversation log');
  swap(/<sc-for list="\{\{messages\}\}"[\s\S]*?<\/sc-for>/, '@@GREETING@@', 'the messages loop');

  const sugg = out.match(/<sc-for list="\{\{suggestions\}\}"[\s\S]*?>([\s\S]*?)<\/sc-for>/);
  must(sugg, 'could not find the suggestions loop');
  const button = sugg[1]
    .replace('onClick="{{s.ask}}"', 'data-twin-q=@@Q_ATTR@@')
    .replace('{{s.q}}', '@@Q_TEXT@@')
    .trim();
  must(!/\{\{/.test(button), 'unexpected binding in the suggestion button');
  out = out.replace(/<sc-for list="\{\{suggestions\}\}"[\s\S]*?<\/sc-for>/, '@@SUGGESTIONS@@');

  swap(/onSubmit="\{\{send\}\}"/, 'id="twin-form"', 'the form submit binding');
  swap(/ value="\{\{draft\}\}" onChange="\{\{onDraft\}\}"/, ' autocomplete="off"', 'the input bindings');

  // Live-twin additions (hand-written, so they survive a redesign): the "match a job description" control,
  // and the notice about what is logged. Styled with the same inline tokens the design uses.
  swap(/<form id="twin-form"/, '@@MATCH@@<form id="twin-form"', 'the form, to add the match control before it');
  swap(/<\/form>/, '</form>@@NOTICE@@', 'the end of the form, to add the privacy notice after it');

  const chip = 'min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid #e6e6e6; background: #fafafa; color: #111111; font: inherit; font-size: 13px; cursor: pointer';
  const matchMarkup = `<div style="display: flex; flex-direction: column; gap: 8px">
<div><button type="button" id="twin-match-toggle" aria-expanded="false" aria-controls="twin-match" style="${chip}">Match a job description</button></div>
<form id="twin-match" hidden style="flex-direction: column; gap: 8px; padding: 12px; border: 1px solid #e6e6e6; border-radius: 10px; background: #fafafa">
<label for="twin-req" style="font-size: 11px; line-height: 14px; color: #595959">Paste a job description or a few requirements. I'll point to what I've done that relates. I don't score fit.</label>
<textarea id="twin-req" rows="5" maxlength="6000" style="padding: 12px; border-radius: 10px; border: 1px solid #e6e6e6; font: inherit; font-size: 14px; color: #111111; background: #ffffff; box-sizing: border-box; width: 100%; resize: vertical"></textarea>
<div><button type="submit" id="twin-match-go" style="min-height: 40px; padding: 0 18px; border-radius: 999px; border: none; background: #111111; color: #ffffff; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer">Show related work</button></div>
</form>
</div>
`;
  const noticeMarkup = `<p id="twin-notice" style="margin: 0; font-size: 11px; line-height: 16px; color: #595959">I answer only from my portfolio. Questions I can't answer are saved without your name so I can improve. Please don't include personal details. Job descriptions you paste are not saved.</p>`;
  replacementsExtra['@@MATCH@@'] = matchMarkup;
  replacementsExtra['@@NOTICE@@'] = noticeMarkup;

  const suggestionsMarkup =
    '{qa.map((x) => (' + button.replace('@@Q_ATTR@@', '{x.q}').replace('@@Q_TEXT@@', '{x.q}') + '))}';

  const replacements = {
    ...replacementsExtra,
    '@@GREETING@@': '<div style={styles.row + "flex-start"}><div style={styles.twin}>{greeting}</div></div>',
    '@@SUGGESTIONS@@': suggestionsMarkup,
  };

  const frontmatter = `import data from '../data/digital-twin.json';
const { greeting, qa, styles } = data;
`;

  const tail = `<script>
  import data from '../data/digital-twin.json';

  const { greeting, qa, fallback, styles } = data;
  // The live twin runs as a Netlify function. On a host without it (or if it is down) the page falls back
  // to the static Q&A below, so the twin never goes blank.
  const API = (import.meta.env.PUBLIC_TWIN_API as string | undefined) || '/api/twin';
  const BASE = import.meta.env.BASE_URL.replace(/\\/?$/, '/');

  const log = document.getElementById('twin-log');
  const form = document.getElementById('twin-form');
  const input = document.getElementById('twin-input') as HTMLInputElement | null;
  const clear = document.getElementById('twin-clear');
  const matchToggle = document.getElementById('twin-match-toggle');
  const matchForm = document.getElementById('twin-match');
  const matchInput = document.getElementById('twin-req') as HTMLTextAreaElement | null;

  type Source = { label: string; route: string; anchor: string | null };
  type Handoff = { reason: string; email: string; bookingUrl: string | null };
  type Reply = {
    kind: string; answer?: string; sources?: Source[]; handoff?: Handoff | null;
    match?: { items: { requirement: string; evidence: string; sources: Source[] }[]; gaps: string[] };
  };

  let history: { role: 'user' | 'twin'; text: string }[] = [];
  let turn = 0;
  let lastQuestion = '';
  let busy = false;

  function staticAnswer(text: string): string {
    const t = text.toLowerCase();
    for (const item of qa) if (t === item.q.toLowerCase()) return item.a;
    // whole words only, so "now" does not match inside "know"
    const words = new Set(t.split(/[^a-z0-9]+/).flatMap((w) => [w, w.replace(/s$/, '')]));
    for (const item of qa) for (const k of item.keys) if (k.includes(' ') ? t.includes(k) : words.has(k)) return item.a;
    return fallback;
  }

  function el(tag: string, style: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function bubble(from: 'me' | 'twin', text: string): HTMLElement {
    const row = el('div', styles.row + (from === 'me' ? 'flex-end' : 'flex-start'));
    const b = el('div', from === 'me' ? styles.me : styles.twin, text);
    row.appendChild(b);
    log?.appendChild(row);
    if (log) log.scrollTop = log.scrollHeight;
    return b;
  }

  const MUTED = 'font-size: 12px; line-height: 18px; color: #595959';
  const LINK = 'color: #111111; text-decoration: underline; text-underline-offset: 2px';

  function sourceHref(s: Source): string | null {
    if (!/^[a-z0-9\\-\\/]*$/.test(s.route ?? '') || (s.anchor && !/^[\\w-]+$/.test(s.anchor))) return null;
    return BASE + s.route + (s.anchor ? '#' + s.anchor : '');
  }

  function sourceLinks(sources: Source[] | undefined): HTMLElement | null {
    const links = (sources ?? []).map((s) => ({ s, href: sourceHref(s) })).filter((x) => x.href);
    if (!links.length) return null;
    const wrap = el('div', MUTED + '; margin-top: 8px');
    wrap.append('From: ');
    links.forEach((x, i) => {
      if (i) wrap.append(' · ');
      const a = el('a', LINK, x.s.label) as HTMLAnchorElement;
      a.href = x.href as string;
      wrap.appendChild(a);
    });
    return wrap;
  }

  function handoffBlock(h: Handoff): HTMLElement {
    const copy: Record<string, string> = {
      unknown: 'The real me can answer this directly.',
      routed: 'Let’s talk about it directly.',
      probing: 'If you’d like to go deeper, I’m glad to talk.',
      match: 'Want to talk through the fit?',
    };
    const wrap = el('div', 'margin-top: 12px; padding-top: 12px; border-top: 1px solid #e6e6e6; display: flex; flex-direction: column; gap: 8px');
    wrap.appendChild(el('div', MUTED, copy[h.reason] ?? copy.probing));
    const row = el('div', 'display: flex; flex-wrap: wrap; gap: 8px');
    const btn = 'display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 500; text-decoration: none; ';
    if (h.bookingUrl && /^https:\\/\\//.test(h.bookingUrl)) {
      const a = el('a', btn + 'background: #111111; color: #ffffff', 'Book a call') as HTMLAnchorElement;
      a.href = h.bookingUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
    }
    const subject = encodeURIComponent('Following up from your portfolio');
    const body = encodeURIComponent('Hi NJ,\\n\\n' + (lastQuestion ? 'I was on your portfolio and asked your digital twin: “' + lastQuestion + '”\\n\\n' : '') );
    const mail = el('a', btn + (h.bookingUrl ? 'border: 1px solid #e6e6e6; color: #111111' : 'background: #111111; color: #ffffff'), 'Email me') as HTMLAnchorElement;
    mail.href = 'mailto:' + h.email + '?subject=' + subject + '&body=' + body;
    row.appendChild(mail);
    wrap.appendChild(row);
    return wrap;
  }

  async function call(payload: object): Promise<Reply> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
      if (res.status === 429) return { kind: 'busy' };
      if (!res.ok) throw new Error('twin unavailable: ' + res.status);
      return (await res.json()) as Reply;
    } finally {
      clearTimeout(timer);
    }
  }

  function renderReply(b: HTMLElement, r: Reply) {
    b.textContent = r.answer ?? '';
    const src = sourceLinks(r.sources);
    if (src) b.appendChild(src);
    if (r.handoff) b.appendChild(handoffBlock(r.handoff));
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function ask(text: string) {
    const clean = (text || '').trim();
    if (!clean || busy) return;
    busy = true;
    bubble('me', clean);
    const b = bubble('twin', 'Thinking…');
    turn += 1;
    lastQuestion = clean;
    try {
      const r = await call({ mode: 'chat', question: clean, history: history.slice(-6), turn });
      if (r.kind === 'busy') {
        b.textContent = 'I’m getting a lot of questions right now. Please try again in a few minutes, or email me directly.';
        b.appendChild(handoffBlock({ reason: 'routed', email: 'niranjana@nyu.edu', bookingUrl: null }));
      } else {
        renderReply(b, r);
        history.push({ role: 'user', text: clean }, { role: 'twin', text: r.answer ?? '' });
      }
    } catch {
      b.textContent = staticAnswer(clean); // live twin unreachable: the design's own Q&A
      history.push({ role: 'user', text: clean }, { role: 'twin', text: b.textContent });
    } finally {
      busy = false;
    }
  }

  async function match(req: string) {
    const clean = req.trim();
    if (clean.length < 40 || busy) {
      if (clean.length < 40) bubble('twin', 'Paste a bit more of the job description (a few requirements is enough) and I’ll show what relates.');
      return;
    }
    busy = true;
    bubble('me', 'Match this job description: “' + clean.slice(0, 90).replace(/\\s+/g, ' ') + (clean.length > 90 ? '…' : '') + '”');
    const b = bubble('twin', 'Looking through my work…');
    lastQuestion = '';
    try {
      const r = await call({ mode: 'match', requisition: clean });
      if (r.kind === 'busy') {
        b.textContent = 'I’m getting a lot of requests right now. Please try again in a few minutes, or email me directly.';
      } else {
        const items = r.match?.items ?? [];
        const gaps = r.match?.gaps ?? [];
        b.textContent = items.length
          ? 'Here is what I’ve done that relates to this role. I don’t score fit; you decide.'
          : 'Nothing in my portfolio clearly relates to this description. I’d rather say so than stretch.';
        items.forEach((it) => {
          const card = el('div', 'margin-top: 12px; padding-top: 12px; border-top: 1px solid #e6e6e6');
          card.appendChild(el('div', 'font-weight: 600', it.requirement));
          card.appendChild(el('div', 'margin-top: 2px', it.evidence));
          const src = sourceLinks(it.sources);
          if (src) card.appendChild(src);
          b.appendChild(card);
        });
        if (gaps.length) {
          const g = el('div', 'margin-top: 12px; padding-top: 12px; border-top: 1px solid #e6e6e6');
          g.appendChild(el('div', 'font-weight: 600', 'Not something my portfolio shows'));
          const ul = el('ul', 'margin: 4px 0 0; padding-left: 18px');
          gaps.forEach((x) => ul.appendChild(el('li', '', x)));
          g.appendChild(ul);
          b.appendChild(g);
        }
        b.appendChild(handoffBlock(r.handoff ?? { reason: 'match', email: 'niranjana@nyu.edu', bookingUrl: null }));
      }
    } catch {
      b.textContent = 'Matching needs the live twin, which isn’t reachable right now. You can still email me and I’ll go through the role with you.';
      b.appendChild(handoffBlock({ reason: 'routed', email: 'niranjana@nyu.edu', bookingUrl: null }));
    } finally {
      busy = false;
      if (log) log.scrollTop = log.scrollHeight;
    }
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input) return;
    const v = input.value;
    input.value = '';
    void ask(v);
  });

  document.querySelectorAll<HTMLElement>('[data-twin-q]').forEach((btn) => {
    btn.addEventListener('click', () => void ask(btn.dataset.twinQ || ''));
  });

  matchToggle?.addEventListener('click', () => {
    if (!matchForm) return;
    const open = matchForm.hasAttribute('hidden');
    if (open) {
      matchForm.removeAttribute('hidden');
      matchForm.style.display = 'flex';
      matchInput?.focus();
    } else {
      matchForm.setAttribute('hidden', '');
      matchForm.style.display = '';
    }
    matchToggle.setAttribute('aria-expanded', String(open));
  });

  matchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!matchInput) return;
    const v = matchInput.value;
    void match(v).then(() => {
      if (v.trim().length >= 40) matchInput.value = '';
    });
  });

  clear?.addEventListener('click', () => {
    log?.replaceChildren();
    bubble('twin', greeting);
    history = [];
    turn = 0;
    lastQuestion = '';
    if (input) input.value = '';
  });
</script>
`;

  return {
    body: out,
    replacements,
    frontmatter,
    tail,
    files: { 'src/data/digital-twin.json': JSON.stringify(data, null, 2) + '\n' },
  };
}
