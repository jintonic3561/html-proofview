#!/usr/bin/env node
// HTML ファイルを拡張と同じ方法で描画し（test/harness.ts）、Chromium でスクリーンショットを撮る。
// webview スクリプト（media/preview.js）の見た目を目視確認するための開発用ツール。
//
//   node scripts/shot.cjs <file.html> [--base HEAD|INDEX|<ref>|none] [--out .temp/shot.png] [--width 1280]
//
// 比較元の既定は HEAD（拡張の既定 INDEX と違う。ステージと比べるなら --base INDEX）。
// Chromium と playwright-core は devcontainer（Dockerfile の dev ステージ）が持つ。VS Code の
// webview ではないので acquireVsCodeApi は無く、編集の送信は console に出るだけ。
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const base = opt('--base', 'HEAD');
const width = Number(opt('--width', '1280'));
const root = path.resolve(__dirname, '..');
const temp = path.join(root, '.temp');
const out = path.resolve(opt('--out', path.join(temp, 'shot.png')));
const file = args[0];
if (!file) {
  console.error('usage: node scripts/shot.cjs <file.html> [--base HEAD|INDEX|<ref>|none] [--out png] [--width n]');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('playwright-core が見つからない。devcontainer 内で実行して（NODE_PATH 経由で解決する）');
  process.exit(1);
}

fs.mkdirSync(temp, { recursive: true });
const harness = path.join(temp, 'harness.js');
const html = path.join(temp, 'shot.html');
execFileSync('npx', ['esbuild', 'test/harness.ts', '--bundle', '--platform=node', `--outfile=${harness}`, '--log-level=warning'],
  { cwd: root, stdio: 'inherit' });
const stats = execFileSync('node', [harness, 'render', path.resolve(file), html], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, HD_MEDIA: path.join(root, 'media'), HD_BASE: base },
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + html, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`stats ${stats.trim()}`);
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
