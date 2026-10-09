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

  function cancel() {
    if (!editing) return;
    const html = editing.html;
    const el = finish();
    quiet(() => { el.innerHTML = html; });
  }

  function commit() {
    if (!editing) return;
    const { el, html, text } = editing;
    const next = el.innerText.replace(/\n+$/, '');
    finish();
    if (window.getSelection) window.getSelection().removeAllRanges();
    if (next === text) { quiet(() => { el.innerHTML = html; }); return; }
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

  document.addEventListener('keydown', (e) => {
    if (editing) {
      if (e.isComposing || e.keyCode === 229) return; // IME conversion in progress
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      return;
    }
    if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    if (e.key === 'n' || (e.key === 'F7' && !e.shiftKey)) { e.preventDefault(); go(1); }
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
      :host { all: initial; position: fixed; top: 10px; right: 10px; z-index: 2147483647; }
      .bar { font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328;
             background: rgba(255,255,255,.96); border: 1px solid #d0d7de; border-radius: 8px;
             box-shadow: 0 4px 16px rgba(0,0,0,.12); display: flex; align-items: center; gap: 6px;
             padding: 5px 6px 5px 10px; user-select: none; }
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
        .bar { color: #e6edf3; background: rgba(22,27,34,.96); border-color: #30363d; }
        .base, .pos, .l { color: #8b949e; } .sep { background: #30363d; }
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
      <button class="collapse" title="折りたたむ">${saved.min ? '◂' : '▸'}</button>
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
  (document.body || document.documentElement).appendChild(host);
})();
