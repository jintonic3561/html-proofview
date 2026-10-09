#!/usr/bin/env bash
# devcontainer 作成/リビルド後に走るセットアップスクリプト。
# システムパッケージ（gh / glow / Chromium 等）は Dockerfile の dev ステージが持つ。
# ここに置くのはユーザレベル・シークレット依存のものだけ。冪等に書いてあるので何度実行してもよい。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"

# --- Claude Code -----------------------------------------------------------
# インストール先は $HOME/.local/bin。PATH は Dockerfile の dev ステージで通してある。
echo "==> Claude Code"
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash
else
  echo "    already installed"
fi
# PATH が切れていれば command not found で落とす（黙って「入ったつもり」にしない）
claude --version

# defaultMode=bypassPermissions は Dockerfile が /etc/claude-code/managed-settings.json に焼き込む。

# --- 対話シェルへの .env 読み込み ------------------------------------------
# 非対話シェルは devcontainer.json の containerEnv BASH_ENV が拾う。BASH_ENV は
# 対話シェルでは読まれないため、VS Code のターミナル向けに ~/.bashrc へ同じ
# 読み込みを仕掛ける（~/.bashrc はイメージ側なのでコンテナ再作成で消える。毎回張り直す）。
echo "==> .env: 対話シェルへの読み込み"
BASHRC="$HOME/.bashrc"
MARKER="# devcontainer: ワークスペースの .env を環境変数として読み込む"
if grep -qF "$MARKER" "$BASHRC" 2>/dev/null; then
  echo "    already configured"
else
  printf '\n%s\n. "%s/.devcontainer/bash_env.sh"\n' "$MARKER" "$WORKSPACE_DIR" >> "$BASHRC"
  echo "    ~/.bashrc に追記"
fi

# --- gh --------------------------------------------------------------------
# 認証は .env の GH_TOKEN を環境変数として渡すだけ（gh 側にログイン状態を持たせない
# ＝ .env を唯一の秘密ソースに保つ）。
echo "==> gh: 認証確認"
if gh auth status >/dev/null 2>&1; then
  echo "    ok"
  # git の credential helper をコンテナの gh に向け直す。Dev Containers はホストの ~/.gitconfig を
  # コピーしてくるため、ホスト側の gh の絶対パス（例: /home/<host>/.local/bin/gh）が残っていて
  # git fetch/push が「gh: not found」で落ちる。setup-git が github.com 向けの helper を上書きする。
  gh auth setup-git --hostname github.com
else
  echo "    未認証 → .env の GH_TOKEN を確認（gh auth status で詳細）。設定後にこのスクリプトを再実行してよい"
fi

# コミットの作者情報。ホストの ~/.gitconfig に user が無いとコミットが「Author identity unknown」で
# 落ちるため、未設定のときだけ GH_TOKEN の GitHub アカウント（login と noreply アドレス）で埋める。
echo "==> git: 作者情報"
if git config --global user.email >/dev/null 2>&1; then
  echo "    already configured ($(git config --global user.email))"
elif login_id="$(gh api user --jq '.login + " " + (.id|tostring)' 2>/dev/null)"; then
  read -r gh_login gh_id <<<"$login_id"
  git config --global user.name "$gh_login"
  git config --global user.email "${gh_id}+${gh_login}@users.noreply.github.com"
  echo "    $gh_login <${gh_id}+${gh_login}@users.noreply.github.com>"
else
  echo "    未設定 → gh 未認証のため埋められない（git config --global user.name/user.email を手で設定）"
fi

# --- 依存 ------------------------------------------------------------------
# npm ci: package-lock.json と package.json のズレをここで顕在化させる（黙って書き換えない）。
echo "==> npm ci"
(cd "$WORKSPACE_DIR" && npm ci)

# --- 動作確認 --------------------------------------------------------------
# 環境が正しく組めていれば必ず通る（Node / git / jsdom / esbuild の動作確認を兼ねる）。
echo "==> npm run typecheck && npm test"
(cd "$WORKSPACE_DIR" && npm run typecheck && npm test)

echo "==> postCreate done"
