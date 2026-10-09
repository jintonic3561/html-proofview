// Runs the webview script (media/preview.js) in jsdom against a page rendered
// by core, with the page's own scripts enabled, and checks which text ends up
// locked (not editable) and which stays editable.
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { render } from '../src/core';

const previewJs = fs.readFileSync(path.join(__dirname, '..', 'media', 'preview.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 150));

const base = `<!DOCTYPE html>
<html><head><title>T</title></head>
<body>
  <h1>見出し</h1>
  <p id="static">静的な<b>文言</b>です</p>
  <p id="edit">編集する</p>
  <p>消える段落</p>
  <svg viewBox="0 0 10 10"><title>図</title><text x="1" y="5">図のラベル<tspan>続き</tspan></text></svg>
  <button class="f">全部 <span class="c"></span></button>
  <div id="late"></div>
  <textarea>入力欄</textarea>
  <select><option>選択肢</option></select>
  <noscript>非対応</noscript>
  <script>document.querySelector('.c').textContent = '12';</script>
</body></html>`;
const cur = base.replace('  <p>消える段落</p>\n', '');

(async () => {
  const r = render(cur, base, { head: '', tail: '' });
  assert.deepStrictEqual(r.stats, { added: 0, removed: 1, modified: 0 });
  const html = r.html +
    `<script type="application/json" id="__hd_state">${JSON.stringify({ stats: r.stats, baseLabel: 'HEAD', version: 1 })}</script>` +
    `<script>${previewJs}</script>`;
  const msgs: any[] = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w: any) {
      w.acquireVsCodeApi = () => ({ postMessage: (m: any) => msgs.push(m), getState: () => null, setState() {} });
      // jsdom has no innerText; the webview reads it on commit
      Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    },
  });
  const w: any = dom.window;
  const d = w.document;
  const locked = () => Array.from(d.querySelectorAll('.hd-locked')).map((e: any) => e.localName).sort();
  const lockEl = d.getElementById('__hd_toolbar').shadowRoot.querySelector('.l');

  // ---- initial pass: script-written, svg (as a whole), form controls
  assert.deepStrictEqual(locked(), ['option', 'span', 'svg', 'textarea']);
  assert.ok(!d.querySelector('text.hd-locked') && !d.querySelector('tspan.hd-locked'), 'labels are not marked one by one');
  const LOCK_TITLE = 'ソースに対応づけられない文言（スクリプトが生成・SVG・フォーム部品など）のため、ここでは編集できません';
  assert.strictEqual(d.querySelector('.c').title, LOCK_TITLE);
  assert.ok(!d.querySelector('svg').hasAttribute('title'), 'no title attribute on svg');
  assert.ok(!d.body.classList.contains('hd-locked'));
  assert.ok(!d.querySelector('noscript').classList.contains('hd-locked'));
  assert.ok(!d.querySelector('.hd-removed').classList.contains('hd-locked'), 'deleted-text marker is not locked');
  assert.strictEqual(d.querySelectorAll('.hd-text').length, 6);
  assert.strictEqual(lockEl.textContent, '⊘4');
  assert.strictEqual(lockEl.hidden, false);

  // ---- text written by a script after load
  d.getElementById('late').textContent = '後から';
  await tick();
  assert.ok(d.getElementById('late').classList.contains('hd-locked'));
  assert.strictEqual(lockEl.textContent, '⊘5');

  // ---- a script rewrites static text: the element loses its editable spans
  d.getElementById('static').textContent = '上書き';
  await tick();
  assert.ok(d.getElementById('static').classList.contains('hd-locked'));
  assert.strictEqual(d.querySelectorAll('.hd-text').length, 3);

  // ---- a script writes into one of our spans directly
  const h1span = d.querySelector('h1 .hd-text');
  h1span.textContent = '書き換え';
  await tick();
  assert.ok(h1span.classList.contains('hd-locked') && !h1span.classList.contains('hd-text'));
  assert.strictEqual(h1span.title, LOCK_TITLE, 'the editing hint is replaced');
  assert.strictEqual(lockEl.textContent, '⊘7');

  // ---- our own editing flow does not count as a page mutation
  const span = d.querySelector('#edit .hd-text');
  const click = (el: any) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
  const key = (el: any, k: string) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  click(span);
  assert.ok(span.classList.contains('hd-editing'));
  span.firstChild.data = '編集する2'; // typing
  await tick();
  assert.ok(span.classList.contains('hd-text') && !span.classList.contains('hd-locked'), 'editing is not locking');
  key(span, 'Escape');
  await tick();
  assert.ok(!span.classList.contains('hd-editing') && span.classList.contains('hd-text') && !span.classList.contains('hd-locked'));
  assert.strictEqual(span.textContent, '編集する');
  // commit with no change restores the markup quietly
  click(span); key(span, 'Enter'); await tick();
  assert.ok(span.classList.contains('hd-text') && !span.classList.contains('hd-locked'));
  assert.strictEqual(msgs.length, 0);
  // commit with a change posts the edit
  click(span); span.firstChild.data = '編集した'; key(span, 'Enter'); await tick();
  // the message object comes from the jsdom realm, so compare by value
  assert.deepStrictEqual(JSON.parse(JSON.stringify(msgs)), [{ type: 'edit', id: Number(span.dataset.hdId), text: '編集した', version: 1 }]);
  assert.ok(!span.classList.contains('hd-locked'));
  assert.strictEqual(lockEl.textContent, '⊘7');

  // ---- a page with nothing locked hides the counter
  const plain = render('<!DOCTYPE html><html><body><p>a</p></body></html>', null, { head: '', tail: '' });
  const dom2 = new JSDOM(plain.html + `<script>${previewJs}</script>`, { runScripts: 'dangerously', pretendToBeVisual: true });
  const d2: any = dom2.window.document;
  assert.strictEqual(d2.getElementById('__hd_toolbar').shadowRoot.querySelector('.l').hidden, true);

  await findInPage();
  console.log('preview OK');
})().catch((e) => { console.error(e); process.exit(1); });

// Boots the webview script on a rendered page with the real preview.css (it hides
// deleted text while the diff is off). `state` is what vscode.getState() returns.
function boot(source: string, base: string | null, state: any = null) {
  const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'preview.css'), 'utf8');
  // jsdom computes no display for inline elements
  const r = render(source, base, { head: `<style>b, span, ins, del { display: inline }</style><style>${css}</style>`, tail: '' });
  const st = { saved: state };
  const dom = new JSDOM(r.html +
    `<script type="application/json" id="__hd_state">${JSON.stringify({ stats: r.stats, baseLabel: 'HEAD', version: 1 })}</script>` +
    `<script>${previewJs}</script>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w: any) {
      w.acquireVsCodeApi = () => ({
        postMessage() {},
        getState: () => st.saved,
        setState: (s: any) => { st.saved = s; },
      });
      Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
      // no layout in jsdom: every match is in view
      w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0 });
      w.CSS = { highlights: new Map() };
      w.Highlight = class extends Set { priority = 0; };
    },
  });
  const w: any = dom.window;
  const d = w.document;
  const bar = d.getElementById('__hd_toolbar').shadowRoot;
  const input = bar.querySelector('.find input');
  return {
    w, d, bar, input,
    state: () => JSON.parse(JSON.stringify(st.saved)),
    pos: () => bar.querySelector('.fpos').textContent,
    all: () => Array.from(w.CSS.highlights.get('hd-find') || []).map((r: any) => r.toString()),
    cur: () => Array.from(w.CSS.highlights.get('hd-find-current') || [])[0] as any,
    key: (el: any, key: string, o: any = {}) => {
      const e = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...o });
      el.dispatchEvent(e);
      return e;
    },
    type: async (text: string) => {
      input.value = text;
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      await tick();
    },
  };
}

async function findInPage() {
  const base = `<!DOCTYPE html>
<html><head><title>料金</title></head>
<body>
  <h1>料金プラン</h1>
  <p id="p">月額<b>料金</b>は安い。料金の詳細</p>
  <p>消える料金の段落</p>
  <p>ここは料</p><p>金額</p>
  <p hidden>料金（非表示）</p>
  <p>Price
     LIST</p>
  <p id="last">最後の料金</p>
</body></html>`;
  const cur = base.replace('  <p>消える料金の段落</p>\n', '');

  // ---- Ctrl+F opens the find box; typing searches the visible text
  const v = boot(cur, base);
  assert.ok(v.bar.querySelector('.find').hidden);
  assert.ok(v.key(v.d.body, 'f', { ctrlKey: true }).defaultPrevented);
  assert.ok(!v.bar.querySelector('.find').hidden);
  assert.strictEqual(v.bar.activeElement, v.input);
  await v.type('料金');
  // the deleted paragraph is shown while the diff is on; hidden text, title and text across blocks are not
  assert.deepStrictEqual(v.all(), ['料金', '料金', '料金', '料金', '料金']);
  assert.strictEqual(v.pos(), '1/5');
  assert.ok(v.d.querySelector('h1').contains(v.cur().startContainer));

  // ---- Enter / Shift+Enter / F3 step through the matches and wrap
  v.key(v.input, 'Enter');
  assert.strictEqual(v.pos(), '2/5');
  assert.ok(v.d.querySelector('#p b').contains(v.cur().startContainer));
  v.key(v.input, 'Enter', { shiftKey: true });
  v.key(v.input, 'Enter', { shiftKey: true });
  assert.strictEqual(v.pos(), '5/5');
  assert.ok(v.d.getElementById('last').contains(v.cur().startContainer));
  v.key(v.d.body, 'F3');
  assert.strictEqual(v.pos(), '1/5');
  // single-key shortcuts do not fire while typing in the box
  assert.ok(!v.key(v.input, 'n').defaultPrevented && !v.key(v.input, 'd').defaultPrevented);
  assert.ok(!v.d.documentElement.classList.contains('hd-off'));

  // ---- across inline elements, case and whitespace insensitive, never across blocks
  await v.type('額料金は');
  assert.deepStrictEqual(v.all(), ['額料金は']);
  await v.type('price list');
  assert.deepStrictEqual(v.all(), ['Price\n     LIST']);
  // Enter right after typing runs the new query instead of stepping through the old matches
  v.input.value = '料金の';
  v.input.dispatchEvent(new v.w.Event('input'));
  v.key(v.input, 'Enter');
  assert.deepStrictEqual(v.all(), ['料金の', '料金の']);
  assert.strictEqual(v.pos(), '1/2');
  await v.type('料金額');
  assert.deepStrictEqual(v.all(), []);
  assert.strictEqual(v.pos(), '結果なし');
  assert.ok(v.bar.querySelector('.find').classList.contains('none'));

  // ---- turning the diff off hides the deleted match and keeps the selected one
  await v.type('料金');
  v.key(v.input, 'Enter'); v.key(v.input, 'Enter');
  assert.strictEqual(v.cur().toString(), '料金');
  assert.strictEqual(v.cur().startContainer.data, 'は安い。料金の詳細');
  v.key(v.d.body, 'd');
  assert.strictEqual(v.pos(), '3/4');
  v.key(v.d.body, 'd');
  assert.strictEqual(v.pos(), '3/5');
  // the selected match is the deleted one: after it is hidden, the next step lands on the one after it
  v.key(v.input, 'Enter');
  assert.ok(v.cur().startContainer.parentElement.closest('.hd-removed'));
  v.key(v.d.body, 'd');
  assert.strictEqual(v.pos(), '–/4');
  v.key(v.d.body, 'F3');
  assert.strictEqual(v.pos(), '4/4');
  assert.ok(v.d.getElementById('last').contains(v.cur().startContainer));
  v.key(v.d.body, 'd');

  // ---- the find box survives a rerender at the same match
  v.key(v.input, 'Enter', { shiftKey: true }); v.key(v.input, 'Enter', { shiftKey: true });
  assert.strictEqual(v.pos(), '3/5');
  const saved = v.state();
  const v2 = boot(cur, base, saved);
  assert.ok(!v2.bar.querySelector('.find').hidden);
  assert.strictEqual(v2.input.value, '料金');
  assert.strictEqual(v2.pos(), '3/5');
  assert.strictEqual(v2.cur().startContainer.data, 'は安い。料金の詳細');
  // ...and when an edit removed the selected match, the next step lands on the one after it
  const v3 = boot(cur.replace('料金の詳細', '価格の詳細'), cur.replace('料金の詳細', '価格の詳細'), saved);
  assert.strictEqual(v3.pos(), '–/3');
  v3.key(v3.d.body, 'F3');
  assert.ok(v3.d.getElementById('last').contains(v3.cur().startContainer));

  // ---- Escape closes the box and clears the highlights
  v.key(v.input, 'Escape');
  assert.ok(v.bar.querySelector('.find').hidden);
  assert.deepStrictEqual(v.all(), []);
  assert.strictEqual(v.state().find, null);

  // ---- Ctrl+F seeds the query with the selected text
  const sel = v.w.getSelection();
  const r = v.d.createRange();
  const h1Text = v.d.querySelector('h1 .hd-text').firstChild;
  r.setStart(h1Text, 2); r.setEnd(h1Text, 5);
  sel.removeAllRanges(); sel.addRange(r);
  v.key(v.d.body, 'f', { ctrlKey: true });
  assert.strictEqual(v.input.value, 'プラン');
  assert.strictEqual(v.pos(), '1/1');
}
