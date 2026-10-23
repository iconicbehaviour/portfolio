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

  const suggestionsMarkup =
    '{qa.map((x) => (' + button.replace('@@Q_ATTR@@', '{x.q}').replace('@@Q_TEXT@@', '{x.q}') + '))}';

  const replacements = {
    '@@GREETING@@': '<div style={styles.row + "flex-start"}><div style={styles.twin}>{greeting}</div></div>',
    '@@SUGGESTIONS@@': suggestionsMarkup,
  };

  const frontmatter = `import data from '../data/digital-twin.json';
const { greeting, qa, styles } = data;
`;

  const tail = `<script>
  import data from '../data/digital-twin.json';

  const { greeting, qa, fallback, styles } = data;
  const log = document.getElementById('twin-log');
  const form = document.getElementById('twin-form');
  const input = document.getElementById('twin-input') as HTMLInputElement | null;
  const clear = document.getElementById('twin-clear');

  function answer(text: string): string {
    const t = text.toLowerCase();
    for (const item of qa) if (t === item.q.toLowerCase()) return item.a;
    for (const item of qa) for (const k of item.keys) if (t.includes(k)) return item.a;
    return fallback;
  }

  function add(from: 'me' | 'twin', text: string) {
    if (!log) return;
    const row = document.createElement('div');
    row.setAttribute('style', styles.row + (from === 'me' ? 'flex-end' : 'flex-start'));
    const bubble = document.createElement('div');
    bubble.setAttribute('style', from === 'me' ? styles.me : styles.twin);
    bubble.textContent = text;
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function ask(text: string) {
    const clean = (text || '').trim();
    if (!clean) return;
    add('me', clean);
    add('twin', answer(clean));
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input) return;
    ask(input.value);
    input.value = '';
  });

  document.querySelectorAll<HTMLElement>('[data-twin-q]').forEach((b) => {
    b.addEventListener('click', () => ask(b.dataset.twinQ || ''));
  });

  clear?.addEventListener('click', () => {
    log?.replaceChildren();
    add('twin', greeting);
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
