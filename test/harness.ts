// Renders a file the same way the extension does, for browser testing.
import { render, extract, editForNode } from '../src/core';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
const [cmd, file, a, b] = process.argv.slice(2);
const dir = path.dirname(file);
const src = fs.readFileSync(file, 'utf8');
if (cmd === 'render') {
  const base = execFileSync('git', ['show', `HEAD:./${path.basename(file)}`], { cwd: dir, encoding: 'utf8' });
  const media = process.env.HD_MEDIA!;
  const r = render(src, base, {
    head: `<base href="file://${dir}/"><link rel="stylesheet" href="file://${media}/preview.css">`,
    tail: '',
  });
  const out = r.html + `<script type="application/json" id="__hd_state">${JSON.stringify({ stats: r.stats, baseLabel: 'HEAD', version: 1 })}</script><script src="file://${media}/preview.js"></script>`;
  fs.writeFileSync(a, out);
  console.log(JSON.stringify(r.stats));
} else if (cmd === 'edit') {
  const n = extract(src).nodes[Number(a)];
  const e = editForNode(src, n, b)!;
  fs.writeFileSync(file, src.slice(0, e.start) + e.text + src.slice(e.end));
  console.log(JSON.stringify(e));
}
