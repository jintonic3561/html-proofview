import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
const vscode: any = require('vscode');
const ext = require('../src/extension');
const file = process.argv[2];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const S = vscode.__state;
  S.doc = vscode.__makeDoc(file);
  ext.activate({ subscriptions: [], extensionUri: vscode.Uri.file('/ext') });
  await vscode.commands.executeCommand('htmlProofView.open', vscode.Uri.file(file));
  await sleep(300);
  const p = S.panel;
  const stateOf = () => JSON.parse(p.html.match(/id="__hd_state">(.*?)<\/script>/)[1]);
  const st = stateOf();
  assert.deepStrictEqual(st.stats, { added: 0, removed: 0, modified: 1 });
  assert.strictEqual(st.baseLabel, 'HEAD');
  assert.ok(p.html.includes("script-src 'nonce-"));
  assert.ok(p.html.includes('<base href="https://file+.vscode-resource'));
  // find id of the h1
  const id = Number(p.html.match(/data-hd-id="(\d+)"[^>]*>毎日の/)![1]);
  await p.send({ type: 'edit', id, text: '毎日の仕事を、ぐっと速く。', version: S.doc.version });
  assert.ok(S.doc.getText().includes('<h1>毎日の仕事を、ぐっと速く。</h1>'));
  await sleep(400);
  assert.ok(p.renders >= 2, 'rerendered');
  // stale version is rejected
  await p.send({ type: 'edit', id, text: 'x', version: 1 });
  assert.strictEqual(S.warnings.length, 1);
  // reveal
  await p.send({ type: 'reveal', id });
  const at = S.doc.getText().indexOf('毎日の仕事を、ぐっと速く。');
  assert.deepStrictEqual([S.selection.start.offset, S.selection.end.offset], [at, at + '毎日の仕事を、ぐっと速く。'.length]);
  // save -> base reload
  const before = p.renders; await S.doc.save(); await sleep(300);
  assert.ok(p.renders > before);
  // opening again reuses the panel
  await vscode.commands.executeCommand('htmlProofView.open', vscode.Uri.file(file));
  assert.strictEqual(p.revealed, 1);
  // INDEX: changes vanish from the diff once they are staged
  S.config.baseRef = 'INDEX';
  await p.send({ type: 'refresh' });
  assert.strictEqual(stateOf().stats.modified, 1, 'unstaged change is shown');
  assert.strictEqual(stateOf().baseLabel, 'ステージ（add済み）');
  execFileSync('git', ['add', path.basename(file)], { cwd: path.dirname(file) });
  await p.send({ type: 'refresh' });
  assert.deepStrictEqual(stateOf().stats, { added: 0, removed: 0, modified: 0 }, 'staged change is hidden');
  // HEAD still shows the staged change
  S.config.baseRef = 'HEAD';
  await p.send({ type: 'refresh' });
  assert.strictEqual(stateOf().stats.modified, 1);
  // untracked file vs INDEX: everything is new
  S.config.baseRef = 'INDEX';
  execFileSync('git', ['rm', '-q', '--cached', path.basename(file)], { cwd: path.dirname(file) });
  await p.send({ type: 'refresh' });
  assert.match(stateOf().baseLabel, /存在しない/);
  console.log('extension glue OK');
})().catch((e) => { console.error(e); process.exit(1); });
