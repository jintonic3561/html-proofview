#!/usr/bin/env bash
# 非対話シェルで direnv を効かせ、ワークスペースの .envrc（＝ .env）を環境変数として読み込む。
#
# direnv の hook はプロンプト表示のたびに走る仕組みなので、対話シェルにしか効かない。
# 対話シェルは postCreate.sh が ~/.bashrc に `direnv hook bash` を仕掛ける。
# 非対話シェル（Claude Code の bash・VS Code のタスク・npm scripts の子プロセス等）は
# devcontainer.json の containerEnv BASH_ENV がこのファイルを読み、起動時に一度だけ
# カレントディレクトリに応じた差分を当てる。
#
# どちらも .env をシェルの起動時に読み直すので、値の追加・変更は新しいシェルから反映される
# （イメージのリビルドもコンテナ再作成も不要）。.envrc を変えたときだけ `direnv allow` が要る。
#
# ここは bash が起動するたびに走る。direnv の失敗であらゆるコマンドを道連れに
# しないよう、失敗は握りつぶして呼び出し元へ伝播させない。
#
# direnv は .envrc を評価するために bash を起動し、その bash もこのファイルを読む。
# そこで direnv export を呼ぶと無限に再帰するため、目印の変数を子に渡して2段目以降は何もしない。

if [ -z "${__BASH_ENV_DIRENV:-}" ] && command -v direnv >/dev/null 2>&1; then
  eval "$(__BASH_ENV_DIRENV=1 direnv export bash 2>/dev/null)" || true
fi
