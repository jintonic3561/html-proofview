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
  console.log('preview OK');
})().catch((e) => { console.error(e); process.exit(1); });
