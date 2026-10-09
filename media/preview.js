// Injected into the rendered page inside the webview.
(function () {
  'use strict';
  // The extension acquires the API in <head> before any page script can.
  // Outside VS Code (scripts/shot.cjs) there is no API: log instead of posting.
  let api = window.__hd_vscode;
  delete window.__hd_vscode;
  if (!api && typeof acquireVsCodeApi === 'function') {
    try { api = acquireVsCodeApi(); } catch (_) { /* a page script took it first */ }
  }
  const vscode = api || { postMessage: (m) => console.log('postMessage', m), getState: () => null, setState: () => {} };

  const stateEl = document.getElementById('__hd_state');
  const S = stateEl ? JSON.parse(stateEl.textContent) : { stats: { added: 0, removed: 0, modified: 0 }, baseLabel: '', version: 0 };
  const saved = vscode.getState() || {};
  const persist = (patch) => { Object.assign(saved, patch); vscode.setState(saved); };

  // ------------------------------------------------------------ scroll restore
  if (saved.scrollY) {
    const y = saved.scrollY, x = saved.scrollX || 0;
    window.scrollTo(x, y);
    window.addEventListener('load', () => window.scrollTo(x, y));
  }
  let st;
  window.addEventListener('scroll', () => {
    clearTimeout(st);
    st = setTimeout(() => persist({ scrollY: window.scrollY, scrollX: window.scrollX }), 100);
  }, { passive: true });

  if (saved.off) document.documentElement.classList.add('hd-off');

  // ------------------------------------------------------------ no navigation
  document.addEventListener('submit', (e) => e.preventDefault(), true);

  // ------------------------------------------------------------ editing
  let editing = null; // { el, html, text }

  // ------------------------------------------------------------ locked text
  // The extension wraps every text node it can edit in .hd-text. Visible text
  // outside those spans cannot be mapped back to the source: SVG/MathML labels,
  // form controls, text the parser stitched together and anything the page's
  // own scripts wrote. Mark it so it looks different and is not clickable.
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const NO_TEXT = new Set(['script', 'style', 'noscript', 'template', 'title', 'desc', 'iframe', 'noframes']);
  const LOCK_TITLE = 'ソースに対応づけられない文言（スクリプトが生成・SVG・フォーム部品など）のため、ここでは編集できません';
  const pageRoot = document.body || document.documentElement;

  // Returns the element marked for text node `t`, or null when it is fine.
  // `mutated` is true for text that appeared or changed after the page loaded.
  function lockFor(t, mutated) {
    if (!t.data.trim()) return null;
    const parent = t.parentElement;
    if (!parent || parent === pageRoot || NO_TEXT.has(parent.localName) || parent.closest('.hd-removed')) return null;
    const stat = parent.closest('.hd-text');
    let el;
    if (stat) {
      if (!mutated) return null;
      // The page's script rewrote text we handed out for editing.
      stat.classList.remove('hd-text');
      stat.removeAttribute('title');
      el = stat;
    } else {
      // Foreign content (svg, math): mark the whole figure, not every label.
      el = parent;
      while (el.parentElement && el.parentElement !== pageRoot && el.parentElement.namespaceURI !== XHTML) el = el.parentElement;
    }
    el.classList.add('hd-locked');
    if (el.namespaceURI === XHTML && !el.hasAttribute('title')) el.setAttribute('title', LOCK_TITLE);
    return el;
  }

  function lockTree(root, mutated) {
    let n = 0;
    if (root.nodeType === 3) return lockFor(root, mutated) ? 1 : 0;
    if (root.nodeType !== 1) return 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (lockFor(t, mutated)) n++;
    return n;
  }

  let lockTimer;
  const mo = new MutationObserver((records) => {
    let n = 0;
    for (const r of records) {
      if (editing && editing.el.contains(r.target)) continue; // the user typing
      if (r.type === 'characterData') n += lockTree(r.target, true);
      else r.addedNodes.forEach((a) => { n += lockTree(a, true); });
    }
    if (n) { clearTimeout(lockTimer); lockTimer = setTimeout(updateLocked, 100); }
  });
  // Our own DOM writes must not count as page mutations.
  const quiet = (fn) => { fn(); mo.takeRecords(); };

  lockTree(pageRoot, false);
  mo.observe(pageRoot, { childList: true, characterData: true, subtree: true });

  const currentText = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('.hd-del').forEach((d) => d.remove());
    return c.textContent;
  };

  function startEdit(el, x, y) {
    if (editing) commit();
    const text = currentText(el);
    editing = { el, html: el.innerHTML, text };
    el.textContent = text;
    el.classList.add('hd-editing');
    try { el.contentEditable = 'plaintext-only'; } catch (_) { el.contentEditable = 'true'; }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = false;
    el.focus();
    // Put the caret where the user clicked.
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (range && el.contains(range.startContainer)) sel.addRange(range);
    else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r); }
  }

  function finish() {
    const { el } = editing;
    mo.takeRecords(); // drop the records of the user's typing
    editing = null; // clear first: removing contenteditable fires focusout synchronously
    el.removeAttribute('contenteditable');
    el.classList.remove('hd-editing');
    return el;
  }

  function restoreMarkup(el, html) {
    quiet(() => { el.innerHTML = html; });
    // Find ranges inside the element collapsed when editing replaced its text.
    if (find.q) findAt(saved.find.pos, saved.find.on);
  }

  function cancel() {
    if (!editing) return;
    const html = editing.html;
    restoreMarkup(finish(), html);
  }

  function commit() {
    if (!editing) return;
    const { el, html, text } = editing;
    const next = el.innerText.replace(/\n+$/, '');
    finish();
    if (window.getSelection) window.getSelection().removeAllRanges();
    if (next === text) { restoreMarkup(el, html); return; }
    el.classList.add('hd-pending');
    vscode.postMessage({ type: 'edit', id: Number(el.dataset.hdId), text: next, version: S.version });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#__hd_toolbar')) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (a) e.preventDefault(); // never navigate away inside the preview
    const el = e.target.closest && e.target.closest('.hd-text');
    if (!el) return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      vscode.postMessage({ type: 'reveal', id: Number(el.dataset.hdId) });
      return;
    }
    if (editing && editing.el === el) return;
    startEdit(el, e.clientX, e.clientY);
  }, true);

  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const isMod = (e, key) => !e.altKey && !e.shiftKey && (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
    e.key.toLowerCase() === key;
  // Handled here, so VS Code (which gets the keys forwarded from the webview) must not act on them as well.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // IME conversion in progress
    if (isMod(e, 'f')) { stop(e); openFind(); return; }
    if (e.key === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) { stop(e); findNext(e.shiftKey ? -1 : 1); return; }
    if (editing) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      return;
    }
    // Inside the toolbar's shadow root e.target is the host, not the input.
    const t = e.composedPath()[0];
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape' && !findEl.hidden) { e.preventDefault(); closeFind(); }
    else if (e.key === 'n' || (e.key === 'F7' && !e.shiftKey)) { e.preventDefault(); go(1); }
    else if (e.key === 'p' || (e.key === 'F7' && e.shiftKey)) { e.preventDefault(); go(-1); }
    else if (e.key === 'd') { e.preventDefault(); toggleDiff(); }
  }, true);

  document.addEventListener('focusout', (e) => {
    if (editing && e.target === editing.el) commit();
  }, true);

  // Keep pasted content plain and on one line.
  // VS Code desktop swallows Ctrl+V and replays it as execCommand('paste'),
  // so this handler runs inside an execCommand and Chromium refuses the nested
  // insertText; fall back to inserting through the selection.
  document.addEventListener('paste', (e) => {
    if (!editing) return;
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
    if (!t || document.execCommand('insertText', false, t)) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !editing.el.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const node = document.createTextNode(t);
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }, true);

  // Tooltips with the previous wording.
  document.querySelectorAll('.hd-modified[data-hd-old]').forEach((el) => {
    el.title = '変更前: ' + el.dataset.hdOld + '\n（クリックで編集 / Ctrl・⌘+クリックでソースへ）';
  });
  document.querySelectorAll('.hd-text:not(.hd-modified)').forEach((el) => {
    el.title = 'クリックで編集 / Ctrl・⌘+クリックでソースへ';
  });

  // ------------------------------------------------------------ navigation
  const changes = () => Array.from(document.querySelectorAll('.hd-change'));
  let idx = saved.idx ?? -1;

  function go(dir) {
    const list = changes();
    if (!list.length) return;
    idx = (idx + dir + list.length) % list.length;
    persist({ idx });
    const el = list[idx];
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('hd-flash'); void el.offsetWidth; el.classList.add('hd-flash');
    updatePos();
  }

  function toggleDiff() {
    const off = document.documentElement.classList.toggle('hd-off');
    persist({ off });
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', String(!off));
    if (find.q) findKeep(); // deleted text appears or disappears
  }

  // ------------------------------------------------------------ toolbar (shadow DOM, isolated from page CSS)
  const host = document.createElement('div');
  host.id = '__hd_toolbar';
  const root = host.attachShadow({ mode: 'open' });
  const { added, removed, modified } = S.stats;
  const total = added + removed + modified;
  const lockedCount = () => document.querySelectorAll('.hd-locked').length;
  const locked = lockedCount();
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; top: 10px; right: 10px; z-index: 2147483647;
              display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
      .bar, .find { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328;
             background: rgba(255,255,255,.96); border: 1px solid #d0d7de; border-radius: 8px;
             box-shadow: 0 4px 16px rgba(0,0,0,.12); display: flex; align-items: center; gap: 6px;
             padding: 5px 6px 5px 10px; user-select: none; }
      .find { padding: 4px 6px; gap: 4px; }
      .find[hidden] { display: none; }
      input { font: inherit; color: inherit; background: transparent; width: 15em; padding: 2px 6px;
              border: 1px solid #d0d7de; border-radius: 5px; outline: none; }
      input:focus { border-color: #0969da; box-shadow: 0 0 0 1px #0969da; }
      .none input { border-color: #cf222e; box-shadow: 0 0 0 1px #cf222e; }
      .fpos { color: #57606a; min-width: 4.2em; text-align: center; font-variant-numeric: tabular-nums; }
      svg { display: block; width: 13px; height: 17px; }
      .base { color: #57606a; max-width: 16em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
      .base:hover { text-decoration: underline; }
      .n { font-variant-numeric: tabular-nums; font-weight: 600; }
      .a { color: #1a7f37; } .m { color: #9a6700; } .r { color: #cf222e; } .l { color: #57606a; }
      .sep { width: 1px; align-self: stretch; background: #d0d7de; }
      button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 5px; color: #1f2328; }
      button:hover { background: #eaeef2; }
      button[aria-pressed="true"] { background: #ddf4ff; color: #0969da; }
      button:disabled { opacity: .35; cursor: default; background: none; }
      .pos { color: #57606a; min-width: 3.2em; text-align: center; font-variant-numeric: tabular-nums; }
      .min .hide { display: none; }
      @media (prefers-color-scheme: dark) {
        .bar, .find { color: #e6edf3; background: rgba(22,27,34,.96); border-color: #30363d; }
        input { border-color: #30363d; }
        input:focus { border-color: #58a6ff; box-shadow: 0 0 0 1px #58a6ff; }
        .none input { border-color: #f85149; box-shadow: 0 0 0 1px #f85149; }
        .base, .pos, .l, .fpos { color: #8b949e; } .sep { background: #30363d; }
        button { color: #e6edf3; } button:hover { background: #30363d; }
        button[aria-pressed="true"] { background: #1f3a5f; color: #58a6ff; }
        .a { color: #3fb950; } .m { color: #d29922; } .r { color: #f85149; }
      }
    </style>
    <div class="bar ${saved.min ? 'min' : ''}">
      <span class="hide base" title="比較元を変更">比較元: ${escapeHtml(S.baseLabel)}</span>
      <span class="hide sep"></span>
      <span class="n a" title="追加">+${added}</span>
      <span class="n m" title="変更">~${modified}</span>
      <span class="n r" title="削除">−${removed}</span>
      <span class="n l" title="編集できない箇所（スクリプトが生成・SVG・フォーム部品など）" ${locked ? '' : 'hidden'}>⊘${locked}</span>
      <span class="hide sep"></span>
      <button class="hide prev" title="前の変更 (p / Shift+F7)" ${total ? '' : 'disabled'}>▲</button>
      <span class="hide pos"></span>
      <button class="hide next" title="次の変更 (n / F7)" ${total ? '' : 'disabled'}>▼</button>
      <button class="hide toggle" title="差分表示の切り替え (d)" aria-pressed="${!saved.off}">差分</button>
      <button class="hide refresh" title="gitから比較元を再読み込み">⟳</button>
      <button class="hide search" title="検索 (Ctrl・⌘+F)" aria-label="検索"><svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M10.3 10.3 14.2 14.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <button class="collapse" title="折りたたむ">${saved.min ? '◂' : '▸'}</button>
    </div>
    <div class="find" hidden>
      <input type="text" placeholder="検索" aria-label="検索" spellcheck="false">
      <span class="fpos"></span>
      <button class="fprev" title="前の一致 (Shift+Enter / Shift+F3)">▲</button>
      <button class="fnext" title="次の一致 (Enter / F3)">▼</button>
      <button class="fclose" title="閉じる (Esc)">✕</button>
    </div>`;
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const $ = (s) => root.querySelector(s);
  const toggleBtn = $('.toggle');
  const posEl = $('.pos');
  const lockEl = $('.l');
  function updateLocked() { const k = lockedCount(); lockEl.textContent = '⊘' + k; lockEl.hidden = !k; }
  function updatePos() { posEl.textContent = total ? `${idx < 0 ? '–' : idx + 1}/${changes().length}` : '差分なし'; }
  $('.prev').onclick = () => go(-1);
  $('.next').onclick = () => go(1);
  toggleBtn.onclick = toggleDiff;
  $('.refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
  $('.base').onclick = () => vscode.postMessage({ type: 'setBase' });
  $('.collapse').onclick = () => {
    const bar = $('.bar');
    const min = bar.classList.toggle('min');
    $('.collapse').textContent = min ? '◂' : '▸';
    persist({ min });
  };
  updatePos();

  // ------------------------------------------------------------ find
  // Matches are painted with the CSS Custom Highlight API, so the page's DOM
  // (and the lock observer) never sees them.
  const findEl = $('.find');
  const input = $('.find input');
  const fposEl = $('.fpos');
  const HL = window.CSS && CSS.highlights && window.Highlight ? CSS.highlights : null;
  const SKIP = new Set([...NO_TEXT, 'textarea', 'select']);
  // `cur` is the selected match. It is -1 when nothing is selected (e.g. an edit
  // removed the selected match); `next` is then the match the next step lands on.
  const find = { q: '', ranges: [], starts: [], cur: -1, next: 0 };
  const lower = (c) => { const l = c.toLowerCase(); return l.length === 1 ? l : c; };
  const query = () => (input.value.trim() ? input.value.replace(/\s+/g, ' ').replace(/[^]/g, lower) : '');

  // The visible text as one string, whitespace collapsed and case folded, with
  // '\n' between blocks so that no match spans two blocks.
  // Character i comes from offset offs[i] of text node nodes[i].
  function pageText() {
    const styles = new Map();
    const style = (el) => { let s = styles.get(el); if (!s) styles.set(el, s = getComputedStyle(el)); return s; };
    const inline = (el) => /^(inline|contents)$/.test(style(el).display);
    const chars = [], nodes = [], offs = [];
    let block = null, brk = false;
    // Hidden subtrees include deleted text while the diff is off.
    const w = document.createTreeWalker(pageRoot, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.nodeType === 1 && (n === host || SKIP.has(n.localName) || style(n).display === 'none')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 1) { if (n.localName === 'br' || !inline(n)) brk = true; continue; }
      let b = n.parentElement;
      while (b !== pageRoot && inline(b)) b = b.parentElement;
      if (b !== block) { block = b; brk = true; }
      if (style(n.parentElement).visibility !== 'visible') continue;
      for (let i = 0; i < n.data.length; i++) {
        let c = n.data[i];
        if (/\s/.test(c)) {
          if (brk || !chars.length || chars[chars.length - 1] === ' ') continue;
          c = ' ';
        } else if (brk) {
          if (chars[chars.length - 1] === ' ') { chars.pop(); nodes.pop(); offs.pop(); }
          if (chars.length) { chars.push('\n'); nodes.push(null); offs.push(0); }
          brk = false;
        }
        chars.push(lower(c)); nodes.push(n); offs.push(i);
      }
    }
    return { s: chars.join(''), nodes, offs };
  }

  function search() {
    find.ranges = []; find.starts = [];
    const q = find.q;
    if (!q) return;
    const { s, nodes, offs } = pageText();
    for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + q.length)) {
      const j = i + q.length - 1, r = document.createRange();
      r.setStart(nodes[i], offs[i]);
      r.setEnd(nodes[j], offs[j] + 1);
      find.ranges.push(r); find.starts.push(i);
    }
  }

  // Make match k the next stop, and select it when `on`. k may be the match count (past the last).
  function place(k, on) {
    const n = find.ranges.length;
    find.next = k;
    find.cur = on && k < n ? k : -1;
    // Positions in the page text survive a rerender as long as nothing before them changed.
    persist({ find: { text: input.value, pos: k < n ? find.starts[k] : Number.MAX_SAFE_INTEGER, on: find.cur >= 0 } });
    findEl.classList.toggle('none', !!find.q && !n);
    fposEl.textContent = !find.q ? '' : n ? `${find.cur >= 0 ? find.cur + 1 : '–'}/${n}` : '結果なし';
    if (!HL) return;
    const all = new Highlight(), cur = new Highlight();
    find.ranges.forEach((r) => all.add(r));
    if (find.cur >= 0) cur.add(find.ranges[find.cur]);
    cur.priority = 1;
    HL.set('hd-find', all);
    HL.set('hd-find-current', cur);
  }

  // New query: start from the first match not above the viewport, like a browser.
  function findFromView() {
    find.q = query();
    search();
    const k = find.ranges.findIndex((r) => r.getBoundingClientRect().bottom >= 0);
    place(k < 0 ? 0 : k, true);
    if (find.cur >= 0) reveal(find.ranges[find.cur]);
  }

  // Same page after a rerender: pick up at the saved position.
  function findAt(pos, on) {
    search();
    const k = find.starts.findIndex((p) => p >= pos);
    place(k < 0 ? find.ranges.length : k, on && find.starts[k] === pos);
  }

  // Same DOM, different visibility: keep the selected match if it is still shown.
  function findKeep() {
    const prev = find.ranges[find.cur >= 0 ? find.cur : find.next];
    const on = find.cur >= 0;
    search();
    if (!prev) { place(0, false); return; }
    const cmp = (r) => r.compareBoundaryPoints(Range.START_TO_START, prev);
    const k = find.ranges.findIndex((r) => cmp(r) >= 0);
    place(k < 0 ? find.ranges.length : k, on && k >= 0 && cmp(find.ranges[k]) === 0);
  }

  function step(dir) {
    const n = find.ranges.length;
    if (!n) return;
    const k = find.cur >= 0 ? find.cur + dir : find.next - (dir < 0 ? 1 : 0);
    place((k + n) % n, true);
    reveal(find.ranges[find.cur]);
  }

  function reveal(r) {
    const inView = (b) => b.top >= 0 && b.bottom <= window.innerHeight;
    if (inView(r.getBoundingClientRect())) return;
    r.startContainer.parentElement.scrollIntoView({ block: 'center' });
    // A long text node can still leave the match outside the viewport.
    const b = r.getBoundingClientRect();
    if (!inView(b)) window.scrollBy(0, b.top - window.innerHeight / 2);
  }

  function openFind() {
    // Seed the query with the selected text, as VS Code does.
    const sel = root.activeElement === input ? '' : String(window.getSelection()).trim();
    if (sel && sel.length <= 200 && !sel.includes('\n')) input.value = sel;
    findEl.hidden = false;
    input.focus();
    input.select();
    if (query() !== find.q) findFromView();
  }

  function closeFind() {
    findEl.hidden = true;
    find.q = '';
    find.ranges = []; find.starts = [];
    place(0, false);
    persist({ find: null });
    if (root.activeElement === input) input.blur();
  }

  let qt;
  // Enter in the box or F3: run a query still waiting for the debounce, else step.
  function findNext(dir) {
    clearTimeout(qt);
    if (findEl.hidden) openFind();
    else if (query() !== find.q) findFromView();
    else step(dir);
  }

  const onInput = () => { clearTimeout(qt); qt = setTimeout(findFromView, 120); };
  input.addEventListener('input', (e) => { if (!e.isComposing) onInput(); });
  input.addEventListener('compositionend', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('.search').onclick = openFind;
  $('.fprev').onclick = () => step(-1);
  $('.fnext').onclick = () => step(1);
  $('.fclose').onclick = closeFind;

  if (saved.find) {
    findEl.hidden = false;
    input.value = saved.find.text;
    find.q = query();
    findAt(saved.find.pos, saved.find.on);
  }
  (document.body || document.documentElement).appendChild(host);
})();
