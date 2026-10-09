#!/usr/bin/env node
// .vsix に入れる README（Marketplace と VS Code の拡張ページに出る）を README.md から作る。
// 開発者向けの節は GitHub の README にだけ残す。`npm run package` が呼ぶ。
'use strict';
const fs = require('node:fs');

const DROP = ['開発'];
const OUT = 'dist/marketplace-readme.md';

const src = fs.readFileSync('README.md', 'utf8');
const sections = src.split(/^(?=## )/m);
for (const h of DROP) {
  if (!sections.some((s) => s.startsWith(`## ${h}\n`))) {
    throw new Error(`README.md に「## ${h}」が無い。見出しを変えたら scripts/marketplace-readme.cjs の DROP も直す`);
  }
}
const out = sections.filter((s) => !DROP.some((h) => s.startsWith(`## ${h}\n`))).join('');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync(OUT, out);
