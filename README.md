# HTML ProofView

[![ci](https://github.com/jintonic3561/html-proofview/actions/workflows/ci.yml/badge.svg)](https://github.com/jintonic3561/html-proofview/actions/workflows/ci.yml)

HTMLをレンダリングした見た目のまま、**文言の変更だけ**をgitの比較元（既定はステージ＝`git add` した内容）と比べて表示し、プレビュー上で直接書き換えられるVS Code拡張です。

> **HTML ProofView** is a VS Code extension for proofreading the copy of HTML pages. It renders the page as-is, highlights word-level text changes against a git ref (the index by default, so `git add` clears what you have already reviewed), and lets you fix the wording in place. The UI is in Japanese.

- 既定ではステージと比べるので、確認し終えた変更を `git add` すると差分から消えます。修正しながら、どこまでレビューしたかが分かります。コミットと比べたいときは比較元を `HEAD` などに変えます。
- 変更箇所は語単位で表示します（削除は赤の取り消し線、追加は緑）。日本語は `Intl.Segmenter` で単語に区切るので、「作業→仕事」のような差分も読みやすく出ます。
- 丸ごと削除された文言は、削除された位置に赤いブロックで表示します。
- 文言をクリックするとその場で編集できます。Enterで確定、Escでキャンセル、Shift+Enterは使いません（1行入力）。
- 確定すると元のHTMLソースの**変わった部分だけ**を書き換えます。`&copy;` などのエンティティや、ソース上の改行・インデントはそのまま残ります。
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

## 仕様と制限

- 比較の対象は `<body>` 内の表示テキストです。`<title>`、`<script>`、`<style>`、`<textarea>`、`<option>`、SVG内のテキスト、属性値（`alt`, `placeholder` など）は対象外です。このうち画面に見えるもの（SVG、フォーム部品）はグレーの点線で囲み、編集できないことが分かるようにします。SVGは図ごとに囲みます。
- テキストは「要素で区切られたかたまり」ごとに比べます。`<p>Hello <b>world</b></p>` なら、`Hello ` と `world` は別々のかたまりとして扱います。
- 空白は、ブラウザと同じく連続した空白を1つにまとめて比べます（`<pre>` の中は除く）。
- CSSや画像は相対パスでそのまま読み込みます。外部のhttps上のCSS、フォント、画像も読み込みます。
- ページ自身のJSは既定で実行します。JSが書いた文言は表示されますが、ソースに対応づけられないので編集できません（グレーの点線）。JSが静的な文言を書き換えた場合も、その箇所は編集できなくなります。ページ全体をJSで描画するページでは、ほぼ全部がグレーになります。
- テンプレートエンジンの構文（`{{ }}` や `<%= %>` など）は、そのまま文字として表示されます。
- 信頼されていないワークスペース（制限モード）では無効です。比較元の取得にワークスペース内で `git` を実行するためです。
- 仮想ワークスペース（GitHub Repositories など、ファイルがローカルにない環境）では `git` を実行できないので、差分なしのプレビューと編集だけ使えます。
- ページのJSを実行する前提や、脆弱性の報告先は [SECURITY.md](SECURITY.md) にあります。

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
