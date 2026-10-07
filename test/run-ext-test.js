// Builds a throwaway git repo and runs the extension glue test against the vscode mock.
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-'));
const git = (...a) => execFileSync('git', a, { cwd: dir });
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
const f = path.join(dir, 'index.html');
fs.writeFileSync(f, '<!DOCTYPE html><html><head></head><body>\n    <h1>毎日の作業を、もっと速く。</h1>\n</body></html>');
git('add', '-A'); git('commit', '-qm', 'base');
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('作業', '仕事'));
execFileSync('npx', ['esbuild', 'test/extension.test.ts', '--bundle', '--platform=node',
  '--alias:vscode=./test/mock-vscode.js', '--outfile=dist/ext.test.js', '--log-level=warning'], { stdio: 'inherit' });
execFileSync('node', ['dist/ext.test.js', f], { stdio: 'inherit' });
fs.rmSync(dir, { recursive: true, force: true });
