import { render, extract, editForNode } from '../src/core';
import assert from 'node:assert';

const base = `<!DOCTYPE html>
<html><head><title>T</title><style>p{color:red}</style></head>
<body>
  <h1>製品のご案内</h1>
  <p>この製品は
     とても便利です。&copy; 2025</p>
  <p>削除される段落</p>
  <ul><li>項目A</li><li>項目B</li></ul>
  <p>Hello <b>world</b>!</p>
</body></html>`;
const cur = base
  .replace('とても便利です。', 'かなり便利です。')
  .replace('  <p>削除される段落</p>\n', '')
  .replace('<li>項目B</li>', '<li>項目B</li><li>項目C（新規）</li>')
  .replace('Hello', 'Hi');

const r = render(cur, base, { head: '<!--HEAD-->', tail: '<!--TAIL-->' });
assert.deepStrictEqual(r.stats, { added: 1, removed: 1, modified: 2 });

// edit: change one word, keep entity and line break
const { nodes } = extract(cur);
const n = nodes.find((x) => x.norm.startsWith('この製品'))!;
const e = editForNode(cur, n, 'この製品は かなり快適です。© 2025')!;
const edited = cur.slice(0, e.start) + e.text + cur.slice(e.end);
assert.ok(edited.includes('&copy; 2025'));
assert.ok(edited.includes('この製品は\n     かなり快適です。'));

// CRLF offsets
const crlf = '<p>a\r\nb &amp; c</p>\r\n<p>x</p>';
const nn = extract(crlf).nodes;
const e2 = editForNode(crlf, nn[0], 'a b & d')!;
assert.strictEqual(crlf.slice(0, e2.start) + e2.text + crlf.slice(e2.end), '<p>a\r\nb &amp; d</p>\r\n<p>x</p>');
// no base (untracked)
assert.deepStrictEqual(render(cur, null, { head: '', tail: '' }).stats, { added: 0, removed: 0, modified: 0 });

// clearing a text removes the elements it leaves empty
const clear = (src: string, text: string) => {
  const node = extract(src).nodes.find((x) => x.norm === text)!;
  const ed = editForNode(src, node, '  ')!;
  return src.slice(0, ed.start) + ed.text + src.slice(ed.end);
};
const list = '<ul>\n  <li>A</li>\n  <li>B</li>\n</ul>';
assert.strictEqual(clear(list, 'B'), '<ul>\n  <li>A</li>\n</ul>');
assert.strictEqual(clear(list.replace(/\n/g, '\r\n'), 'A'), '<ul>\r\n  <li>B</li>\r\n</ul>');
assert.strictEqual(clear('<ul><li>A</li><li>B</li></ul>', 'A'), '<ul><li>B</li></ul>');
// nested wrappers and a list left empty go too, the layout container stays
assert.strictEqual(clear('<div class="card">\n  <ul>\n    <li><a href="/x">only</a></li>\n  </ul>\n</div>', 'only'),
  '<div class="card">\n</div>');
assert.strictEqual(clear('<section>\n  <h2>\n    見出し\n  </h2>\n  <p>本文</p>\n</section>', '見出し'),
  '<section>\n  <p>本文</p>\n</section>');
// mixed content: only the emptied wrapper / text goes
assert.strictEqual(clear('<p>Hello <b>world</b>!</p>', 'world'), '<p>Hello !</p>');
assert.strictEqual(clear('<p>Hello <b>world</b>!</p>', 'Hello'), '<p> <b>world</b>!</p>');
assert.strictEqual(clear('<p>前<br>後</p>', '前'), '<p><br>後</p>');
// kept elements: table cells and layout containers just lose their text
assert.strictEqual(clear('<table><tr>\n  <td>\n    x\n  </td>\n</tr></table>', 'x'), '<table><tr>\n  <td></td>\n</tr></table>');
assert.strictEqual(clear('<div>\n  x\n</div>', 'x'), '<div></div>');
// a comment doesn't count as content; an image does
assert.strictEqual(clear('<p><!-- note -->x</p>', 'x'), '');
assert.strictEqual(clear('<p><img src="a.png">x</p>', 'x'), '<p><img src="a.png"></p>');
// no end tag in the source: leave the element alone
assert.strictEqual(clear('<ul><li>A<li>B</ul>', 'A'), '<ul><li><li>B</ul>');
console.log('core OK');
