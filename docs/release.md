# リリース手順

配布先は 2 つ。どちらも `vX.Y.Z` タグの push を起点に CI（`.github/workflows/release.yml`）が作る。手元から `vsce publish` はしない。

- GitHub Releases … `.vsix` を添付。Marketplace を使わない人向け（`code --install-extension html-proofview-X.Y.Z.vsix`）
- VS Code Marketplace … publisher `tonic` の `html-proofview`。PAT は使わず、Entra ID のアプリ登録に GitHub OIDC で入って publish する。Actions の Variables に `AZURE_CLIENT_ID` があるときだけ動く
- （任意）Open VSX … Secrets に `OVSX_PAT` があるときだけ publish する。VSCodium / Cursor などの利用者向け

## Marketplace への publish の仕組み

workflow の `marketplace` job が担当する。依存しているのは次の 3 つで、どれかを変えたら残りも合わせる。

- Entra ID のアプリ登録の federated credential … subject が environment `marketplace`（`repo:jintonic3561/html-proofview:environment:marketplace`）
- GitHub の environment `marketplace` … デプロイ元を `v*` タグに限っている。資格情報を取れるのはここを通る job だけ
- Marketplace の publisher `tonic` のメンバー … このアプリ登録を Contributor で入れてある。ID は job の「Marketplace から見たこの資格情報の ID」ステップに出る

Actions の Variables に `AZURE_CLIENT_ID` / `AZURE_TENANT_ID`。秘密ではないので Secrets ではなく Variables に置く。PAT と違って期限切れはない。

## main の保護ルール

リポジトリのルールセット「main: PR 経由のみ」（Settings → Rules）で main を守っている。git 管理外なので要点をここに書く。

- main への直接 push・force push・削除は誰もできない（admin も）。変更は必ず PR で入れる
- PR のマージには code owner（`.github/CODEOWNERS` = tonic）の承認 1 件が要る。承認後に push があれば承認は無効になる
- admin（tonic）は PR のマージについてだけルールを bypass できる。つまり自分の PR はレビューなしでマージでき、他人の PR は tonic が承認しない限りマージできない。bypass は明示したときだけ効く: `gh pr merge` は `--admin` を付ける（無いと「base branch policy prohibits the merge」で止まる）、Web UI では「Merge without waiting for requirements」を選ぶ

理由: 公開後は外部からの PR や Dependabot の PR が来る。main を「tonic が見たものだけ」に保ちつつ、一人で回すときの手間は増やさない。

## 毎回: バージョンを上げて PR → マージ → タグを push

バージョンを上げるコミットも PR で入れ、マージ後の main にタグを打つ。

```bash
# 1. ブランチを切り、CHANGELOG.md に "## X.Y.Z - YYYY-MM-DD" の節を書く（この節がリリースノートになる）
git switch -c release/vX.Y.Z
# 2. package.json / package-lock.json の version を上げる（タグはまだ打たない）
npm version X.Y.Z --no-git-tag-version
git commit -am "vX.Y.Z"
# 3. PR を作ってマージする。--admin で bypass を使う（自分の PR はレビューなしでマージできる）
git push -u origin release/vX.Y.Z
gh pr create --fill && gh pr merge --admin --rebase --delete-branch
# 4. マージ後の main にタグを打って push。タグが release ワークフローを起動する
git switch main && git pull
git tag vX.Y.Z && git push origin vX.Y.Z
```

ワークフローはタグと `package.json` の version が一致しないと止まる。タグは、version を上げたコミットを含む main に打つ。

進捗は `gh run watch` か Actions タブ。終わると Releases に `.vsix` が付き、Marketplace は数分〜十数分で反映される（初回は審査で遅れることがある）。

Marketplace だけ失敗したら、直してから Actions でその run の `marketplace` job だけ re-run する（GitHub Release は作成済みなので release job は再実行しない）。

## 手元で .vsix を確かめる

```bash
npm run package                                   # html-proofview-X.Y.Z.vsix
code --install-extension html-proofview-X.Y.Z.vsix
```

`.vsix` に入るものは `.vscodeignore` で決まる。`npx vsce ls` で一覧できる。

## 対応する VS Code の最低バージョンを上げるとき

`package.json` の `engines.vscode` と `devDependencies` の `@types/vscode` を同じ値にそろえる。片方だけ上げると `vsce package` が拒否する。Dependabot は `@types/vscode` を更新対象から除外してある。
