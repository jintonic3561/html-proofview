---
description: PRの未解決コメントを取得し、妥当性を判断後に修正してpush・返信する。
---

## User Input

```text
$ARGUMENTS
```

## Goal

指定されたPRの未解決レビューコメントに対応し、修正をcommit・push・返信する。

## Usage

```
/pr-fix <PR番号>
/pr-fix 5
```

## ワークフロー

### 1. 未解決コメントの取得

GraphQL APIで未解決スレッドのみ抽出する:

```bash
gh repo view --json owner,name -q '.owner.login + "/" + .name'
```

```bash
gh api graphql -f query='
query($pr: Int!) {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: $pr) {
      reviewThreads(first: 50) {
        nodes {
          isResolved
          comments(first: 5) {
            nodes {
              databaseId
              body
              path
              author { login }
            }
          }
        }
      }
    }
  }
}' -F pr=<PR番号>
```

`isResolved: false` のスレッドのみを対象とする。

### 2. コメントの妥当性を評価

各コメントについて、対象ファイルを読み込み、以下の基準で評価する:

- **採用**: プロジェクト規約に合致し、コード品質を向上させる指摘
- **却下**: 好みの問題、既に対応済み、または技術的に誤った指摘
- **保留**: 判断が難しい場合はユーザに確認する

### 3. 修正の実施

採用したコメントごとに:

1. TDDに従い、必要に応じてテストを先に修正する
2. 実装を修正する
3. 品質チェックを実行する

### 4. レビュー

すべての修正が終わったら、 レビューワークフローに従って実装レビューと改善を行う。

### 5. commit・push・返信

1. コメント単位でcommitを作成する
  - コメントの内容がcommitメッセージから分かるようにする
  - すべての変更がcommitされたか確かめる
2. 変更をpushする
3. 各コメントにスレッド返信する（解決済みにはしない）:

```bash
gh api repos/{owner}/{repo}/pulls/<PR番号>/comments/<comment_id>/replies \
  -f body="<対応内容の説明>" --method POST
```

- 採用したコメント: 修正内容を簡潔に説明
- 却下したコメント: 却下理由を説明

## レビューワークフロー

以下1~4を「本質的な指摘なし」とレビューエージェントが明示するまで繰り返す。
3で1件でも修正した周回の後は、修正が新たな問題を生んでいないかの収束確認として、必ずもう1周回すこと。

1. レビューすべき実装ファイル、ドキュメントのpath, レビューに必要な背景情報を整理する
2. reviewスキルを、1の情報を引数として起動する
3. レビュー結果のうち、本質的で重要だと思われる指摘事項について、すべて修正を行う
4. ソースコードの変更が含まれる場合、品質チェックを行う

## 制約

- コメントの解決（resolve）は行わない（レビュアーに委ねる）
- 修正はコメント単位でcommitを分ける
