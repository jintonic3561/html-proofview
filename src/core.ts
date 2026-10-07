// Pure logic: extract text nodes from HTML (with source offsets), diff them
// against a base version, render annotated HTML, and compute source edits.
// No dependency on the vscode API so it can be tested with plain Node.

import { parse } from 'parse5';
import { decodeHTML } from 'entities';
import { diffArrays } from 'diff';

// ---------------------------------------------------------------- extraction

export interface TextNode {
  /** decoded text value of the whole node */
  value: string;
  /** source offsets of the whole node (raw, entity-encoded) */
  start: number;
  end: number;
  /** source offsets of the core (node minus leading/trailing ASCII whitespace) */
  coreStart: number;
  coreEnd: number;
  /** whitespace-significant context (<pre>, <textarea>, <listing>) */
  pre: boolean;
  /** comparable text: core with whitespace collapsed (unless pre) */
  norm: string;
  /** whether we may wrap this node in a <span> and edit it */
  editable: boolean;
  /** enclosing elements (outermost first, excluding html/head/body) */
  ancestors: { start: number; end: number }[];
  /** tag path, e.g. "main>ul>li" — used to pair nodes in the same structure */
  path: string;
  /** source range deleted when the text is cleared (may cover enclosing elements) */
  clear: { start: number; end: number };
}

const SKIP_TAGS = new Set([
  'script', 'style', 'template', 'noscript', 'title', 'textarea',
  'option', 'optgroup', 'select', 'iframe', 'noframes', 'xmp', 'plaintext',
  'head',
]);
const PRE_TAGS = new Set(['pre', 'listing']);
// Elements removed together with their text when it is cleared: inline
// wrappers, text blocks and the lists holding them. Layout containers
// (div, section, td, ...) are never removed so the page structure stays put.
const CLEAR_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i',
  'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'blockquote', 'figcaption', 'caption',
  'address', 'pre', 'ul', 'ol', 'dl', 'menu',
]);
const HTML_NS = 'http://www.w3.org/1999/xhtml';

const WS = /[ \t\n\r\f]/;
const isWs = (c: string) => WS.test(c);

export function collapse(s: string): string {
  return s.replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');
}

interface Parsed {
  nodes: TextNode[];
  /** where to inject <head> content */
  headInsert: number;
}

/** Whether `el` holds anything besides `child`, whitespace and comments. */
function hasOtherContent(el: any, child: any): boolean {
  return el.childNodes.some((c: any) =>
    c !== child && c.nodeName !== '#comment' && !(c.nodeName === '#text' && !c.value.trim()));
}

/** Widen [start, end) to the whole line when nothing else shares it. */
function wholeLine(html: string, start: number, end: number): { start: number; end: number } {
  let s = start, e = end;
  while (s > 0 && (html[s - 1] === ' ' || html[s - 1] === '\t')) s--;
  while (e < html.length && (html[e] === ' ' || html[e] === '\t')) e++;
  if (s > 0 && html[s - 1] !== '\n') return { start, end };
  if (html.startsWith('\r\n', e)) return { start: s, end: e + 2 };
  if (html[e] === '\n') return { start: s, end: e + 1 };
  if (e === html.length) return { start: s, end: e };
  return { start, end };
}

/**
 * What to delete when text node `t` is cleared: the outermost enclosing
 * element left with no other content, or the text itself.
 */
function clearRange(html: string, t: any, core: { start: number; end: number }): { start: number; end: number } {
  let child = t, el = t.parentNode;
  let target: any = null;
  while (el?.tagName && CLEAR_TAGS.has(el.tagName) && el.sourceCodeLocation?.endTag && !hasOtherContent(el, child)) {
    target = el;
    child = el;
    el = el.parentNode;
  }
  if (target) return wholeLine(html, target.sourceCodeLocation.startOffset, target.sourceCodeLocation.endOffset);
  const loc = t.sourceCodeLocation;
  // Sole text of a kept element (td, div, ...): drop its whitespace too.
  // Mixed content: keep the surrounding whitespace that separates siblings.
  return t.parentNode && !hasOtherContent(t.parentNode, t) ? { start: loc.startOffset, end: loc.endOffset } : core;
}

export function extract(html: string): Parsed {
  const doc: any = parse(html, { sourceCodeLocationInfo: true });
  const nodes: TextNode[] = [];
  let headInsert = 0;

  const htmlEl = doc.childNodes.find((n: any) => n.nodeName === 'html');
  const headEl = htmlEl?.childNodes.find((n: any) => n.nodeName === 'head');
  const doctype = doc.childNodes.find((n: any) => n.nodeName === '#documentType');
  if (headEl?.sourceCodeLocation?.startTag) headInsert = headEl.sourceCodeLocation.startTag.endOffset;
  else if (htmlEl?.sourceCodeLocation?.startTag) headInsert = htmlEl.sourceCodeLocation.startTag.endOffset;
  else if (doctype?.sourceCodeLocation) headInsert = doctype.sourceCodeLocation.endOffset;

  const walk = (node: any, pre: boolean, anc: { start: number; end: number }[], path: string) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text') {
        const loc = child.sourceCodeLocation;
        if (!loc) continue;
        const value: string = child.value;
        if (!value.trim()) continue;
        const raw = html.slice(loc.startOffset, loc.endOffset);
        let a = 0, b = raw.length;
        while (a < b && isWs(raw[a])) a++;
        while (b > a && isWs(raw[b - 1])) b--;
        // A text node whose source contains '<' was stitched together by the
        // parser (e.g. around an ignored tag); we cannot map it safely.
        const editable = !raw.includes('<');
        const core = { start: loc.startOffset + a, end: loc.startOffset + b };
        nodes.push({
          value,
          start: loc.startOffset,
          end: loc.endOffset,
          coreStart: core.start,
          coreEnd: core.end,
          pre,
          norm: pre ? value.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '') : collapse(value),
          editable,
          ancestors: anc,
          path,
          clear: clearRange(html, child, core),
        });
      } else if (child.tagName) {
        if (child.namespaceURI && child.namespaceURI !== HTML_NS) continue; // svg / math
        if (SKIP_TAGS.has(child.tagName)) continue;
        const loc = child.sourceCodeLocation;
        const next = loc && !['html', 'body'].includes(child.tagName)
          ? [...anc, { start: loc.startOffset, end: loc.endOffset }]
          : anc;
        walk(child.content ?? child, pre || PRE_TAGS.has(child.tagName), next, path + '>' + child.tagName);
      }
    }
  };
  walk(doc, false, [], '');
  nodes.sort((x, y) => x.start - y.start);
  return { nodes, headInsert };
}

// ---------------------------------------------------------------- tokenizing

const segmenter: any =
  typeof (Intl as any).Segmenter === 'function'
    ? new (Intl as any).Segmenter('ja', { granularity: 'word' })
    : null;

/** Word-ish tokens; CJK text is split into words by Intl.Segmenter. */
export function tokenize(s: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(s), (x: any) => x.segment as string);
  return s.match(/\s+|[A-Za-z0-9_]+|./gsu) ?? [];
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  let same = 0;
  for (const part of diffArrays(tokenize(a), tokenize(b))) if (!part.added && !part.removed) same += part.value.join('').length;
  let sameChars = 0;
  if (a.length * b.length < 250000)
    for (const part of diffArrays([...a], [...b])) if (!part.added && !part.removed) sameChars += part.value.length;
  return (2 * Math.max(same, sameChars * 0.8)) / (a.length + b.length || 1);
}

// ---------------------------------------------------------------- diffing

export type Change =
  | { kind: 'same'; cur: number }
  | { kind: 'added'; cur: number }
  | { kind: 'modified'; cur: number; base: number }
  | { kind: 'removed'; base: number; before: number | null; after: number | null };

export interface DiffResult {
  changes: Change[];
  stats: { added: number; removed: number; modified: number };
}

export function diffNodes(base: TextNode[], cur: TextNode[]): DiffResult {
  const parts = diffArrays(base.map((n) => n.norm), cur.map((n) => n.norm));
  const changes: Change[] = [];
  let bi = 0, ci = 0;
  let pendRemoved: number[] = [];
  let pendAdded: number[] = [];

  const flush = () => {
    if (!pendRemoved.length && !pendAdded.length) return;
    // Monotonic alignment maximising similarity (small DP per hunk).
    const R = pendRemoved, A = pendAdded;
    const n = R.length, m = A.length;
    // A lone replacement (1 removed, 1 added) is always treated as a modification.
    const TH = n === 1 && m === 1 ? 0 : 0.3;
    // Nodes in the same element structure are paired even if the wording changed a lot.
    const sim: number[][] = R.map((r) => A.map((a) => {
      const v = similarity(base[r].norm, cur[a].norm);
      return base[r].path === cur[a].path ? Math.max(v, 0.31) : v;
    }));
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) {
        let best = Math.max(dp[i + 1][j], dp[i][j + 1]);
        if (sim[i][j] >= TH) best = Math.max(best, sim[i][j] + dp[i + 1][j + 1]);
        dp[i][j] = best;
      }
    const ops: Change[] = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && sim[i][j] >= TH && dp[i][j] === sim[i][j] + dp[i + 1][j + 1]) {
        ops.push({ kind: 'modified', base: R[i], cur: A[j] });
        i++; j++;
      } else if (i < n && (j >= m || dp[i][j] === dp[i + 1][j])) {
        ops.push({ kind: 'removed', base: R[i], before: null, after: null });
        i++;
      } else {
        ops.push({ kind: 'added', cur: A[j] });
        j++;
      }
    }
    changes.push(...ops);
    pendRemoved = [];
    pendAdded = [];
  };

  for (const part of parts) {
    const len = part.value.length;
    if (part.removed) { for (let k = 0; k < len; k++) pendRemoved.push(bi++); }
    else if (part.added) { for (let k = 0; k < len; k++) pendAdded.push(ci++); }
    else {
      flush();
      for (let k = 0; k < len; k++) { changes.push({ kind: 'same', cur: ci++ }); bi++; }
    }
  }
  flush();

  // Anchor removed nodes to their neighbours in the current document.
  let prevCur: number | null = null;
  const pendingRemoved: Extract<Change, { kind: 'removed' }>[] = [];
  for (const c of changes) {
    if (c.kind === 'removed') { c.after = prevCur; pendingRemoved.push(c); }
    else {
      for (const r of pendingRemoved) r.before = c.cur;
      pendingRemoved.length = 0;
      prevCur = c.cur;
    }
  }

  const stats = { added: 0, removed: 0, modified: 0 };
  for (const c of changes) if (c.kind !== 'same') stats[c.kind]++;
  return { changes, stats };
}

// ---------------------------------------------------------------- rendering

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

function inlineDiff(oldText: string, newText: string): string {
  let out = '';
  for (const p of diffArrays(tokenize(oldText), tokenize(newText))) {
    const t = escapeText(p.value.join(''));
    if (p.added) out += `<ins class="hd-ins">${t}</ins>`;
    else if (p.removed) out += `<del class="hd-del">${t}</del>`;
    else out += t;
  }
  return out;
}

export interface RenderOptions {
  /** extra markup injected right after <head> (CSP, base, css) */
  head: string;
  /** extra markup appended at the end (script) */
  tail: string;
}

export interface RenderResult {
  html: string;
  stats: DiffResult['stats'];
  /** node id -> source offsets, for mapping edits back */
  nodes: TextNode[];
}

export function render(curHtml: string, baseHtml: string | null, opts: RenderOptions): RenderResult {
  const cur = extract(curHtml);
  const base = baseHtml === null ? cur : extract(baseHtml);
  const { changes, stats } = diffNodes(base.nodes, cur.nodes);

  type Ins = { at: number; end: number; html: string; order: number };
  const edits: Ins[] = [];
  let order = 0;

  for (const c of changes) {
    if (c.kind === 'removed') {
      const b = base.nodes[c.base];
      // Lift the marker out to the outermost element boundary between the
      // neighbouring text nodes, so a deleted paragraph doesn't land inside
      // the next list item / paragraph.
      let at: number;
      let block = false;
      if (c.before !== null) {
        const nx = cur.nodes[c.before];
        const lo = c.after !== null ? cur.nodes[c.after].end : cur.headInsert;
        const lift = nx.ancestors.find((a) => a.start >= lo);
        at = lift ? lift.start : nx.coreStart;
        block = !!lift;
      } else if (c.after !== null) {
        const pv = cur.nodes[c.after];
        const lift = pv.ancestors.find((a) => a.end >= pv.end);
        at = lift ? lift.end : pv.coreEnd;
        block = !!lift;
      } else at = cur.headInsert;
      const cls = `hd-removed hd-change${block ? ' hd-block' : ''}`;
      const html = `<del class="${cls}" title="削除された文言">${escapeText(b.norm)}</del>`;
      edits.push({ at, end: at, html, order: order++ });
      continue;
    }
    const n = cur.nodes[c.cur];
    if (!n.editable) continue;
    const raw = curHtml.slice(n.coreStart, n.coreEnd);
    let inner: string;
    let cls = 'hd-text';
    if (c.kind === 'same') inner = raw;
    else if (c.kind === 'added') { inner = `<ins class="hd-ins">${raw}</ins>`; cls += ' hd-added hd-change'; }
    else { inner = inlineDiff(base.nodes[c.base].norm, n.norm); cls += ' hd-modified hd-change'; }
    const title = c.kind === 'modified' ? ` data-hd-old="${escapeAttr(base.nodes[c.base].norm)}"` : '';
    edits.push({
      at: n.coreStart,
      end: n.coreEnd,
      html: `<span class="${cls}" data-hd-id="${c.cur}"${title}>${inner}</span>`,
      order: order++,
    });
  }

  edits.push({ at: cur.headInsert, end: cur.headInsert, html: opts.head, order: -1 });

  // Assemble front to back. At equal offsets, pure insertions come before replacements.
  const isRepl = (e: Ins) => (e.end > e.at ? 1 : 0);
  edits.sort((x, y) => x.at - y.at || isRepl(x) - isRepl(y) || x.order - y.order);
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    out += curHtml.slice(cursor, e.at) + e.html;
    cursor = e.end;
  }
  out += curHtml.slice(cursor) + opts.tail;
  return { html: out, stats, nodes: cur.nodes };
}

// ---------------------------------------------------------------- editing

interface Unit { rawStart: number; rawEnd: number; text: string }

/** Split a raw (entity-encoded) slice into units that map decoded text back to source. */
function units(raw: string, offset: number, pre: boolean): Unit[] {
  const out: Unit[] = [];
  const re = /&(?:#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)|[ \t\n\r\f]+|[\s\S]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const s = m[0];
    let text: string;
    if (s[0] === '&' && s.length > 1) text = decodeHTML(s);
    else if (!pre && isWs(s[0])) text = ' ';
    else text = s;
    out.push({ rawStart: offset + m.index, rawEnd: offset + m.index + s.length, text });
  }
  return out;
}

export interface SourceEdit { start: number; end: number; text: string }

/**
 * Compute the minimal source replacement that turns node `n` into `newText`.
 * Only the changed middle is rewritten, so entities and line breaks elsewhere
 * in the node survive. Clearing the text removes the elements it leaves empty.
 */
export function editForNode(html: string, n: TextNode, newText: string): SourceEdit | null {
  const target = n.pre ? newText : collapse(newText);
  if (!target.trim()) return { start: n.clear.start, end: n.clear.end, text: '' };
  const us = units(html.slice(n.coreStart, n.coreEnd), n.coreStart, n.pre);
  const current = us.map((u) => u.text).join('');
  if (current === target) return null;

  // common prefix (in whole units)
  let p = 0, pos = 0;
  while (p < us.length && target.startsWith(us[p].text, pos)) { pos += us[p].text.length; p++; }
  // common suffix (in whole units, not overlapping the prefix)
  let s = 0, tail = target.length;
  while (s < us.length - p && tail - us[us.length - 1 - s].text.length >= pos &&
         target.endsWith(us[us.length - 1 - s].text, tail)) {
    tail -= us[us.length - 1 - s].text.length; s++;
  }
  const middle = target.slice(pos, tail);
  const start = p < us.length ? us[p].rawStart : n.coreEnd;
  const end = us.length - s > p ? us[us.length - 1 - s].rawEnd : start;
  return { start, end, text: escapeText(middle) };
}
