# リリース手順

配布先は 2 つ。どちらも `vX.Y.Z` タグの push を起点に CI（`.github/workflows/release.yml`）が作る。手元から `vsce publish` はしない。

- GitHub Releases … `.vsix` を添付。Marketplace を使わない人向け（`code --install-extension html-proofview-X.Y.Z.vsix`）
- VS Code Marketplace … publisher `tonic` の `html-proofview`。Secrets に `VSCE_PAT` があるときだけ publish する
- （任意）Open VSX … Secrets に `OVSX_PAT` があるときだけ publish する。VSCodium / Cursor などの利用者向け

## 初回だけ: Marketplace の publisher と PAT

1. https://marketplace.visualstudio.com/manage に Microsoft アカウントでサインインし、publisher を作る。ID は `package.json` の `publisher`（`tonic`）と一致させる。ID が取れなければ `package.json` の `publisher` を取れた ID に変える（拡張の識別子 `publisher.name` が変わるので、公開前に決めること）
2. https://dev.azure.com で Personal Access Token を作る。Organization は **All accessible organizations**、Scopes は **Marketplace: Manage** のみ。期限は最長（1 年）にして、切れたら作り直す
3. GitHub のリポジトリ → Settings → Secrets and variables → Actions → `VSCE_PAT` にその値を入れる
4. Open VSX も使うなら https://open-vsx.org でサインインして namespace `tonic` を作り、Access Token を `OVSX_PAT` に入れる

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

## 手元で .vsix を確かめる

```bash
npm run package                                   # html-proofview-X.Y.Z.vsix
code --install-extension html-proofview-X.Y.Z.vsix
```

`.vsix` に入るものは `.vscodeignore` で決まる。`npx vsce ls` で一覧できる。

## 対応する VS Code の最低バージョンを上げるとき

`package.json` の `engines.vscode` と `devDependencies` の `@types/vscode` を同じ値にそろえる。片方だけ上げると `vsce package` が拒否する。Dependabot は `@types/vscode` を更新対象から除外してある。
