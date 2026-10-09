#!/usr/bin/env bash
# ワークスペースの .env をシェルの環境変数として読み込む。
#
# 呼ばれ方は2系統:
#   - 非対話シェル … devcontainer.json の containerEnv BASH_ENV から自動で
#                    （Claude Code の bash・VS Code のタスク・npm scripts の子プロセス等）
#   - 対話シェル   … postCreate.sh が ~/.bashrc に書き足す行から
#                    （BASH_ENV は非対話シェルでしか読まれないため両方に仕掛ける）
#
# このファイルも .env もバインドマウント上にあるので、値の追加・変更は
# 新しいシェルを開けば反映される（イメージのリビルドもコンテナ再作成も不要）。
#
# 注意: .env は source される＝shell構文として解釈される。値に空白・記号を含むなら
# クォートすること（NAME="a b" は可、NAME=a b は壊れる）。
#
# ここは bash が起動するたびに走る。.env の記述ミスであらゆるコマンドを道連れに
# しないよう、読み込みの失敗は握りつぶして呼び出し元へ伝播させない。

__workspace_env_file="${BASH_SOURCE[0]%/*}/../.env"
if [ -r "$__workspace_env_file" ]; then
  set -a
  . "$__workspace_env_file" 2>/dev/null || true
  set +a
fi
unset __workspace_env_file
