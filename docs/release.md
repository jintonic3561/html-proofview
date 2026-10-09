# リリース手順

配布先は 2 つ。どちらも `vX.Y.Z` タグの push を起点に CI（`.github/workflows/release.yml`）が作る。手元から `vsce publish` はしない。

- GitHub Releases … `.vsix` を添付。Marketplace を使わない人向け（`code --install-extension html-proofview-X.Y.Z.vsix`）
- VS Code Marketplace … publisher は `package.json` の `publisher`。Actions の Variables に `AZURE_CLIENT_ID` があるときだけ publish する
- （任意）Open VSX … Secrets に `OVSX_PAT` があるときだけ publish する。VSCodium / Cursor などの利用者向け

## 誰が何をするか

| 作業 | コントリビュータ | 管理者 |
| --- | --- | --- |
| 変更を PR で出す | ○ | ○ |
| `.vsix` を作って動作を確かめる（手元、または PR の CI の artifact `vsix`） | ○ | ○ |
| PR をマージする | × | ○ |
| バージョンを上げてタグを push する（= リリース） | × | ○ |
| Marketplace・Azure・GitHub の設定（publisher、Entra ID、environment、Variables / Secrets） | × | ○ |

コントリビュータができるのは PR を出して確かめるところまで。CHANGELOG とバージョンはリリース時に管理者がまとめるので、PR では触らなくていい。

## リリースの流れ（管理者）

バージョンを上げるコミットも PR で入れ、マージ後の main にタグを打つ。

```bash
# 1. ブランチを切り、CHANGELOG.md に "## X.Y.Z - YYYY-MM-DD" の節を書く（この節がリリースノートになる）
git switch -c release/vX.Y.Z
# 2. package.json / package-lock.json の version を上げる（タグはまだ打たない）
npm version X.Y.Z --no-git-tag-version
git commit -am "vX.Y.Z"
# 3. PR を作り、bypass でマージする
git push -u origin release/vX.Y.Z
gh pr create --fill && gh pr merge --admin --rebase --delete-branch
# 4. マージ後の main にタグを打って push。タグが release ワークフローを起動する
git switch main && git pull
git tag vX.Y.Z && git push origin vX.Y.Z
```

- タグと `package.json` の version が一致しないとワークフローは止まる
- 進捗は `gh run watch` か Actions タブ。Marketplace への反映は数分〜十数分
- Marketplace だけ失敗したら、直してからその run の `marketplace` job だけ re-run する（release job は Release 作成済みなので再実行しない）

## main の保護ルール

ルールセット「main: PR 経由のみ」（Settings → Rules）の要点。設定は git 管理外なのでここに書く。

- main への直接 push・force push・削除は誰もできない（管理者も）。変更は必ず PR で入れる
- マージには code owner（`.github/CODEOWNERS`）の承認 1 件が要る。承認後に push があれば承認は無効になる
- 管理者だけが PR のマージで bypass できる。自分の PR はレビューなしでマージできる。bypass は明示したときだけ効く: `gh pr merge --admin`、Web UI では「Merge without waiting for requirements」

## Marketplace への publish の仕組み（管理者）

`marketplace` job は PAT を使わず、GitHub OIDC で Entra ID のアプリ登録に入って `vsce publish --azure-credential` する。次の 3 つが噛み合って動くので、どれかを変えたら残りも合わせる。

- Entra ID のアプリ登録の federated credential … subject は environment `marketplace`（`repo:<owner>/<repo>:environment:marketplace`）
- GitHub の environment `marketplace` … デプロイ元を `v*` タグに限る。資格情報を取れるのはここを通る job だけ
- Marketplace の publisher のメンバー … アプリ登録を Contributor で入れる。入れる ID は job の「Marketplace から見たこの資格情報の ID」ステップに出る

`AZURE_CLIENT_ID` / `AZURE_TENANT_ID` は秘密ではないので Variables に置く。PAT と違って期限切れはない。

## 手元で .vsix を確かめる

```bash
npm run package                                   # html-proofview-X.Y.Z.vsix
code --install-extension html-proofview-X.Y.Z.vsix
```

`.vsix` に入るものは `.vscodeignore` で決まる。`npx vsce ls` で一覧できる。

## 対応する VS Code の最低バージョンを上げるとき

`package.json` の `engines.vscode` と `devDependencies` の `@types/vscode` を同じ値にそろえる。片方だけ上げると `vsce package` が拒否する。Dependabot は `@types/vscode` を更新対象から除外してある。
