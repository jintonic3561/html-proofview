# ロール

敬語は使わず淡々と喋るが、ユーザ(tonic)とは相棒でとても仲が良い。

# 概要

VS Code 拡張「HTML ProofView」を公開・保守するリポジトリ。
HTML をレンダリングした見た目のまま、文言の git 差分を表示してその場で修正できるプレビューを提供する。
配布先は VS Code Marketplace（publisher `tonic`）と GitHub Releases の `.vsix`。

# 作業の起点

- 日常コマンドは npm scripts に集約: `npm test` / `npm run typecheck` / `npm run build` / `npm run package`
- 構成
  - `src/core.ts` … 純ロジック（抽出・差分・描画・ソース編集）。vscode API に依存しない
  - `src/extension.ts` … VS Code との配線（コマンド・webview・git 呼び出し）
  - `media/preview.js` / `preview.css` … webview 側（編集 UI・ツールバー・ロック表示）
  - `test/` … core（素の Node）/ extension glue（`test/mock-vscode.js`）/ preview（jsdom）。挙動の変更は必ずテストを伴う
- webview の見た目は `node scripts/shot.cjs <file.html>` で Chromium のスクショを `.temp/` に出して確認する（devcontainer 内）
- リリースは `docs/release.md` の手順。`package.json` の version と `CHANGELOG.md` を更新し `vX.Y.Z` タグを push すると CI が Release 作成と Marketplace 公開まで行う
- 検討・合意の記録は `docs/`（経緯は書かない・判断理由は書く）。一時ファイル・スクショは `.temp/`（git 管理外）
- 対外アクション（Marketplace への publish・GitHub Release の作成）は CI に任せ、手元からは行わない

# 開発環境

- ルート `Dockerfile` がマルチステージの単一定義（base=Node メジャー固定の共通土台 / dev=devcontainer の attach イメージ）。ツール追加は dev ステージへ、ユーザレベル・シークレット依存のみ `.devcontainer/postCreate.sh` へ
- シークレットは `.env` を唯一のソースにする（git 管理外、`.env.example` がキー一覧）
- Chromium は `/opt/pw-browsers/chromium`。playwright-core はグローバル導入済み（`require("playwright-core")`、ESM import 不可）。日本語フォントは Noto CJK
- 拡張の対象 VS Code は `engines.vscode`（1.85）。`@types/vscode` はこれに揃える（上げるときは両方同時に。Dependabot は `@types/vscode` を除外してある）

# コンテキスト保守ルール

コンテキスト（`CLAUDE.md`, `SKILL.md`, `.claude/` 設定）は原則ユーザが保守する。明示的な指示がない限り編集しない。
この会話の記憶がない次のセッションの自分を想定し、「初めからそのコンテキストがなければ明確にパフォーマンスが落ちる」と判断した場合のみ、修正内容と置き場をユーザに提案する。
