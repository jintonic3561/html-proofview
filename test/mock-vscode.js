// Minimal vscode API mock for exercising extension.ts glue logic.
const fs = require('fs');
const listeners = { change: [], save: [], config: [] };
const ev = (k) => (fn) => { listeners[k].push(fn); return { dispose() {} }; };
class Uri {
  constructor(scheme, p) { this.scheme = scheme; this.fsPath = p; this.path = p; }
  static file(p) { return new Uri('file', p); }
  static joinPath(u, ...s) { return new Uri(u.scheme, require('path').join(u.fsPath, ...s)); }
  toString() { return this.scheme + '://' + this.fsPath; }
}
function makeDoc(file) {
  let text = fs.readFileSync(file, 'utf8');
  const doc = {
    uri: Uri.file(file), version: 1,
    getText: () => text,
    positionAt: (o) => ({ offset: o }),
    save: async () => { fs.writeFileSync(file, text); listeners.save.forEach((f) => f(doc)); return true; },
    _set(t) { text = t; doc.version++; listeners.change.forEach((f) => f({ document: doc })); },
  };
  return doc;
}
const state = { panel: null, warnings: [], doc: null, selection: null, config: { baseRef: 'HEAD', autoSave: true } };
module.exports = {
  __state: state, __makeDoc: makeDoc,
  Uri,
  ViewColumn: { Beside: -2, One: 1 },
  TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
  ConfigurationTarget: { Workspace: 2 },
  Range: class { constructor(a, b) { this.start = a; this.end = b; } },
  Selection: class { constructor(a, b) { this.start = a; this.end = b; } },
  WorkspaceEdit: class { constructor() { this.ops = []; } replace(u, r, t) { this.ops.push({ r, t }); } },
  window: {
    activeTextEditor: undefined,
    createWebviewPanel() {
      const p = {
        html: '', handlers: [], disposeFns: [], revealed: 0,
        webview: {
          cspSource: 'vscode-resource:',
          asWebviewUri: (u) => ({ toString: () => 'https://file+.vscode-resource' + u.fsPath }),
          onDidReceiveMessage: (fn) => { p.handlers.push(fn); return { dispose() {} }; },
          set html(v) { p.html = v; p.renders = (p.renders || 0) + 1; }, get html() { return p.html; },
        },
        onDidDispose: (fn) => { p.disposeFns.push(fn); return { dispose() {} }; },
        reveal() { p.revealed++; },
        send: (m) => Promise.all(p.handlers.map((h) => h(m))),
      };
      state.panel = p; return p;
    },
    showWarningMessage: (m) => { state.warnings.push(m); },
    showInformationMessage: (m) => { state.warnings.push(m); },
    showTextDocument: async () => ({ set selection(s) { state.selection = s; }, revealRange() {} }),
    showInputBox: async () => 'HEAD',
  },
  workspace: {
    workspaceFolders: [],
    onDidChangeTextDocument: ev('change'), onDidSaveTextDocument: ev('save'), onDidChangeConfiguration: ev('config'),
    getConfiguration: () => ({ get: (k) => state.config[k], update: async () => {} }),
    openTextDocument: async () => state.doc,
    applyEdit: async (we) => {
      const d = state.doc; let t = d.getText();
      for (const { r, t: s } of we.ops.sort((a, b) => b.r.start.offset - a.r.start.offset))
        t = t.slice(0, r.start.offset) + s + t.slice(r.end.offset);
      d._set(t); return true;
    },
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
  },
  commands: {
    _c: {}, registerCommand(id, fn) { this._c[id] = fn; return { dispose() {} }; },
    executeCommand(id, ...a) { return this._c[id](...a); },
  },
};
