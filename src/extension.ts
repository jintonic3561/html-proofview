import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { render, editForNode, TextNode } from './core';

const VIEW_TYPE = 'htmlProofView.preview';

interface BaseInfo { text: string | null; label: string }

// Special baseRef: compare with the staged content, so `git add` clears reviewed changes from the diff.
const INDEX_REF = 'INDEX';
const isIndex = (ref: string) => ref.toUpperCase() === INDEX_REF;

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message));
      else resolve(stdout);
    });
  });
}

async function loadBase(uri: vscode.Uri, ref: string): Promise<BaseInfo> {
  if (uri.scheme !== 'file') return { text: null, label: 'ローカルファイルではありません' };
  const dir = path.dirname(uri.fsPath);
  const index = isIndex(ref);
  const label = index ? 'ステージ（add済み）' : ref;
  try {
    const text = await git(['show', `${index ? '' : ref}:./${path.basename(uri.fsPath)}`], dir);
    return { text, label };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/not a git repository/i.test(msg)) return { text: null, label: 'gitリポジトリ外' };
    // For the index, git reports an untracked path as an unknown revision.
    if (/does not exist|exists on disk, but not in/i.test(msg) || (index && /unknown revision/i.test(msg))) return { text: '', label: `${label} に存在しない（全て新規）` };
    if (/invalid object name|unknown revision|bad revision/i.test(msg)) return { text: null, label: `ref「${ref}」が見つからない` };
    if (/ENOENT/.test(msg)) return { text: null, label: 'gitコマンドが見つからない' };
    return { text: null, label: `取得失敗: ${msg.split('\n')[0]}` };
  }
}

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

class Preview {
  private static readonly panels = new Map<string, Preview>();
  private readonly disposables: vscode.Disposable[] = [];
  private base: BaseInfo = { text: null, label: '読み込み中…' };
  private nodes: TextNode[] = [];
  private renderedVersion = -1;
  private timer: NodeJS.Timeout | undefined;

  static show(ctx: vscode.ExtensionContext, doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const existing = Preview.panels.get(key);
    if (existing) { existing.panel.reveal(vscode.ViewColumn.Beside); return; }
    Preview.panels.set(key, new Preview(ctx, doc));
  }

  static refreshAllBases() {
    for (const p of Preview.panels.values()) void p.reloadBase();
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly ctx: vscode.ExtensionContext, private doc: vscode.TextDocument) {
    const roots: vscode.Uri[] = [vscode.Uri.joinPath(ctx.extensionUri, 'media')];
    if (doc.uri.scheme === 'file') roots.push(vscode.Uri.file(path.dirname(doc.uri.fsPath)));
    for (const f of vscode.workspace.workspaceFolders ?? []) roots.push(f.uri);

    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      `ProofView: ${path.basename(doc.uri.path)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: roots, retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png');

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m), null, this.disposables);
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === this.doc.uri.toString()) { this.doc = e.document; this.schedule(); }
    }, null, this.disposables);
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.toString() === this.doc.uri.toString()) void this.reloadBase();
    }, null, this.disposables);
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('htmlProofView')) void this.reloadBase();
    }, null, this.disposables);

    void this.reloadBase();
  }

  private ref(): string {
    return vscode.workspace.getConfiguration('htmlProofView', this.doc.uri).get<string>('baseRef') || INDEX_REF;
  }

  async reloadBase() {
    this.base = await loadBase(this.doc.uri, this.ref());
    this.update();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 250);
  }

  private update() {
    const webview = this.panel.webview;
    const n = nonce();
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f));
    const baseHref = this.doc.uri.scheme === 'file'
      ? webview.asWebviewUri(vscode.Uri.file(path.dirname(this.doc.uri.fsPath) + path.sep)).toString()
      : '';
    const allowPageScripts = vscode.workspace.getConfiguration('htmlProofView', this.doc.uri).get<boolean>('allowPageScripts');
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `media-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} https: 'unsafe-inline'`,
      allowPageScripts
        ? `script-src ${webview.cspSource} https: 'unsafe-inline'`
        : `script-src 'nonce-${n}'`,
    ].join('; ');

    const source = this.doc.getText();
    const state = { baseLabel: this.base.label, version: this.doc.version, file: path.basename(this.doc.uri.path) };
    const head =
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      (baseHref ? `<base href="${baseHref}">` : '') +
      // Take the VS Code API before any page script can.
      `<script nonce="${n}">window.__hd_vscode=acquireVsCodeApi();</script>` +
      `<link rel="stylesheet" href="${media('preview.css')}">`;
    let result;
    try {
      result = render(source, this.base.text, {
        head,
        tail: '',
      });
    } catch (e: any) {
      this.panel.webview.html = `<body><pre>HTMLの解析に失敗: ${String(e?.message ?? e)}</pre></body>`;
      return;
    }
    const tail =
      `<script type="application/json" id="__hd_state">${JSON.stringify({ ...state, stats: result.stats }).replace(/</g, '\\u003c')}</script>` +
      `<script nonce="${n}" src="${media('preview.js')}"></script>`;
    this.nodes = result.nodes;
    this.renderedVersion = this.doc.version;
    this.panel.webview.html = result.html + tail;
  }

  private async onMessage(m: any) {
    switch (m?.type) {
      case 'edit': {
        if (m.version !== this.renderedVersion || this.doc.version !== this.renderedVersion) {
          vscode.window.showWarningMessage('HTML ProofView: ソースが更新されていたので編集を反映しませんでした。もう一度編集して。');
          this.update();
          return;
        }
        const node = this.nodes[m.id];
        if (!node) return;
        const source = this.doc.getText();
        const e = editForNode(source, node, String(m.text));
        if (!e) { this.update(); return; }
        const we = new vscode.WorkspaceEdit();
        we.replace(this.doc.uri, new vscode.Range(this.doc.positionAt(e.start), this.doc.positionAt(e.end)), e.text);
        await vscode.workspace.applyEdit(we);
        if (vscode.workspace.getConfiguration('htmlProofView', this.doc.uri).get<boolean>('autoSave')) await this.doc.save();
        break;
      }
      case 'reveal': {
        const node = this.nodes[m.id];
        if (!node) return;
        const editor = await vscode.window.showTextDocument(this.doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
        const range = new vscode.Range(this.doc.positionAt(node.coreStart), this.doc.positionAt(node.coreEnd));
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        break;
      }
      case 'refresh':
        await this.reloadBase();
        break;
      case 'setBase':
        await vscode.commands.executeCommand('htmlProofView.setBaseRef');
        break;
    }
  }

  private dispose() {
    Preview.panels.delete(this.doc.uri.toString());
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('htmlProofView.open', async (uri?: vscode.Uri) => {
      let doc: vscode.TextDocument | undefined;
      if (uri instanceof vscode.Uri) doc = await vscode.workspace.openTextDocument(uri);
      else doc = vscode.window.activeTextEditor?.document;
      if (!doc) { vscode.window.showInformationMessage('HTMLファイルを開いてから実行して。'); return; }
      Preview.show(ctx, doc);
    }),
    vscode.commands.registerCommand('htmlProofView.setBaseRef', async () => {
      const cfg = vscode.workspace.getConfiguration('htmlProofView');
      const cur = cfg.get<string>('baseRef') || INDEX_REF;
      const ref = await vscode.window.showInputBox({
        title: '比較元のgit ref',
        prompt: 'INDEX（git add した内容。addした変更は差分から消える）, HEAD, HEAD~1, main, v1.2.0, コミットハッシュなど',
        value: cur,
      });
      if (ref === undefined) return;
      await cfg.update('baseRef', ref.trim() || INDEX_REF, vscode.ConfigurationTarget.Workspace);
    }),
  );

  // Pick up commits / checkouts made outside of the editor.
  const watcher = vscode.workspace.createFileSystemWatcher('**/.git/{HEAD,index,refs/**}');
  let t: NodeJS.Timeout | undefined;
  const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => Preview.refreshAllBases(), 500); };
  watcher.onDidChange(bump); watcher.onDidCreate(bump); watcher.onDidDelete(bump);
  ctx.subscriptions.push(watcher);
}

export function deactivate() {}
