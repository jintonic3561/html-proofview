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
claude --version

# defaultMode=bypassPermissions は Dockerfile が /etc/claude-code/managed-settings.json に焼き込む。

# --- direnv: .env の読み込み -----------------------------------------------
echo "==> direnv: .envrc の許可と対話シェルへの hook"
direnv allow "$WORKSPACE_DIR"
BASHRC="$HOME/.bashrc"
MARKER="# devcontainer: direnv でワークスペースの .envrc（.env）を読み込む"
if grep -qF "$MARKER" "$BASHRC" 2>/dev/null; then
  echo "    already configured"
else
  printf '\n%s\neval "$(direnv hook bash)"\n' "$MARKER" >> "$BASHRC"
  echo "    ~/.bashrc に追記"
fi
eval "$(cd "$WORKSPACE_DIR" && direnv export bash 2>/dev/null)"

# --- gh --------------------------------------------------------------------
# 認証は .env の GH_TOKEN を環境変数として渡すだけ。
echo "==> gh: 認証確認"
if gh auth status >/dev/null 2>&1; then
  echo "    ok"
  gh auth setup-git --hostname github.com
else
  echo "    未認証 → .env の GH_TOKEN を確認（gh auth status で詳細）。設定後にこのスクリプトを再実行してよい"
fi

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
echo "==> npm run typecheck && npm test"
(cd "$WORKSPACE_DIR" && npm run typecheck && npm test)

echo "==> postCreate done"
