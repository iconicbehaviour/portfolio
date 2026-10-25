/**
 * Transform for the Inflection artboard.
 *
 * The case study shows example personalization-token syntax as sample copy, e.g.
 *   {{column('first_name')}}, your team visited pricing {{token('pricing_visits_30d')}} times
 * Those double braces are literal text meant for the reader, not design-runtime bindings.
 * The converter refuses {{ }} by default (it would mean a real binding), so this swaps each one for a
 * placeholder and puts it back as escaped literal text after the converter has escaped braces.
 *
 * Guard: it still fails if the artboard gains real dynamic constructs (<sc-for>, <sc-if>, <dc-import>).
 */
export default function transform({ body, script }) {
  if (/<sc-for|<sc-if|<dc-import|<x-import/.test(body)) {
    throw new Error('Inflection transform: real dynamic constructs found; this artboard needs a fuller transform.');
  }
  if (/this\.state|setState|onClick=|onChange=|onSubmit=/.test(body + script)) {
    throw new Error('Inflection transform: interactivity found; this artboard needs a fuller transform.');
  }

  const replacements = {};
  let n = 0;
  const out = body.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
    const token = `@@LITERAL_${n++}@@`;
    const text = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    replacements[token] = `&#123;&#123;${text}&#125;&#125;`;
    return token;
  });

  return { body: out, replacements };
}
