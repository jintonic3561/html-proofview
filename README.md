# HTML ProofView

[![ci](https://github.com/jintonic3561/html-proofview/actions/workflows/ci.yml/badge.svg)](https://github.com/jintonic3561/html-proofview/actions/workflows/ci.yml)

HTMLをレンダリングした見た目のまま、**文言の変更だけ**をgitの比較元（既定はステージ＝`git add` した内容）と比べて表示し、プレビュー上で直接書き換えられるVS Code拡張です。

> **HTML ProofView** is a VS Code extension for proofreading the copy of HTML pages. It renders the page as-is, highlights word-level text changes against a git ref (the index by default, so `git add` clears what you have already reviewed), and lets you fix the wording in place. The UI is in Japanese.

- 既定ではステージと比べるので、確認し終えた変更を `git add` すると差分から消えます。修正しながら、どこまでレビューしたかが分かります。コミットと比べたいときは比較元を `HEAD` などに変えます。
- 変更箇所は語単位で表示します（削除は赤の取り消し線、追加は緑）。
- 文言をクリックするとその場で編集できます。Enterで確定、Escでキャンセルします。
- 文言を全部消して確定すると、それで空になる要素（`p`・`li`・見出し・`b` や `a` などのインライン要素・空になったリスト）もソースの行ごと消します。`div`・`section`・`td` などの枠になる要素は残して、文言だけ消します。
- Ctrl+クリック（macは⌘+クリック）で、その文言のソース位置にジャンプします。
- ソースに対応づけられない文言（SVG内のラベル、`textarea`・`option` の中身、ページ自身のJSが書いた文言）はグレーの点線で囲んで表示します。見えますが編集はできません。件数はツールバーの `⊘` に出ます。

## インストール

- VS Code の拡張ビューで「HTML ProofView」を検索するか、[Marketplace](https://marketplace.visualstudio.com/items?itemName=tonic.html-proofview) からインストールします。
- Marketplace を使わない場合は [Releases](https://github.com/jintonic3561/html-proofview/releases) の `.vsix` をダウンロードして次のコマンドでインストールします。

```bash
code --install-extension html-proofview-X.Y.Z.vsix
```

比較元の取得に `git` コマンドを使うので、`git` が PATH にあり、対象のHTMLがgitリポジトリの中にあることが前提です（リポジトリ外でも、差分なしのプレビューと編集は使えます）。

## 使い方

1. HTMLファイルを開きます。
2. エディタ右上の差分アイコンを押すか、`Ctrl+Shift+V`（macは `⌘⇧V`）を押すか、コマンドパレットで「HTML ProofView: プレビューを開く」を実行します。
3. 横にプレビューが開きます。右上のツールバーの見方は次のとおりです。
   - `+追加 ~変更 −削除` は件数です。`⊘` は編集できない箇所の数です（ある場合だけ出ます）。
   - ▲▼ で変更箇所を移動します（キーは `n` / `p`、または `F7` / `Shift+F7`）。
   - 「差分」ボタン（`d` キー）で差分表示を切り替えます。オフにすると完成形の見た目になります。
   - ⟳ でgitから比較元を読み直します。
   - 「比較元」を押すと比較するrefを変更できます。`INDEX` でステージと比べます。

プレビューで編集した内容は、エディタ上のドキュメントに未保存の変更として入ります。Ctrl+Zで戻せます。保存すると比較元を読み直します。`git add`、コミット、チェックアウトも自動で検知します。

## 設定

| 設定 | 既定値 | 説明 |
|---|---|---|
| `htmlProofView.baseRef` | `INDEX` | 比較元。`INDEX` はステージ（`git add` した内容）。ほかに `HEAD`, `main`, `HEAD~1`, `origin/main`, タグ, ハッシュなど |
| `htmlProofView.autoSave` | `false` | プレビューで編集したら自動保存する |
| `htmlProofView.allowPageScripts` | `true` | ページ自身の `<script>` を実行する。オフにするとJSが生成する文言は表示されない |

## 開発

VS Code で「Reopen in Container」すると、Node 22・git・gh・Chromium が揃った devcontainer が立ち上がり、`npm ci` とテストまで走ります。ホストで直接開発する場合は Node 22 以上と git があれば動きます。

```bash
npm ci
npm test                 # コアロジック・拡張の配線（vscodeモック）・webview（jsdom）のテスト
npm run typecheck
npm run build            # dist/extension.js を生成
npm run package          # .vsix を作る
node scripts/shot.cjs path/to/page.html   # 描画結果を Chromium で撮って .temp/shot.png に出す（devcontainer内）
```

F5 を押すと拡張開発ホストで試せます（devcontainer 内でも使えます）。リリースの手順は [docs/release.md](docs/release.md)、変更履歴は [CHANGELOG.md](CHANGELOG.md) にあります。

## ライセンス

[MIT](LICENSE)
