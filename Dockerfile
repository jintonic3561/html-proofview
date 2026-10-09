# syntax=docker/dockerfile:1
# マルチステージ構成（saqigake 系リポジトリと同じ型）。
# - base: Node メジャーを固定した共通土台
# - dev:  devcontainer の attach イメージ（開発ツール込み）
# 拡張のビルド・テスト・パッケージングは Node と git だけで完結する。Chromium は webview
# スクリプト（media/preview.js）の見た目を目視確認する `scripts/shot.cjs` のために焼き込む。

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
# このリポジトリは npm（package-lock.json）で管理する。pnpm/corepack は使わない。
WORKDIR /workspace

# ---------------------------------------------------------------------------
FROM base AS dev

# Chromium の配置はリモート実行環境（Claude Code on the web）と同一パスに揃える。
# playwright-core から executablePath: /opt/pw-browsers/chromium で参照できる。
ARG PLAYWRIGHT_VERSION=1.50.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# fonts-noto-cjk: この拡張は日本語の文言を扱うので、Chromium のスクショで日本語が豆腐にならないようにする。
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates gnupg openssh-client less procps unzip sudo jq \
      fontconfig fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# glow（Markdown レンダラ。docs/ や README を端末で読む）
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://repo.charm.sh/apt/gpg.key | gpg --dearmor -o /etc/apt/keyrings/charm.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" > /etc/apt/sources.list.d/charm.list \
    && apt-get update && apt-get install -y --no-install-recommends glow \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI（gh）。配布鍵は dearmor 済みバイナリなのでそのまま keyrings へ置く。
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Playwright Chromium + 依存ライブラリ（イメージビルド時に焼き込み）
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
    && ln -s "$(find /opt/pw-browsers -type f -name chrome -path '*chrome-linux*' | head -1)" /opt/pw-browsers/chromium \
    && chown -R node:node /opt/pw-browsers

# playwright-core をグローバルへ。NODE_PATH を通し、任意の場所のスクリプトから
# require("playwright-core") で解決できるようにする（NODE_PATH は CJS の require のみ有効。
# ESM の import は解決しないので注意）。ブラウザは上の焼き込みを PLAYWRIGHT_BROWSERS_PATH 経由で
# 自動解決するため executablePath の指定は不要。
RUN npm install -g playwright-core@${PLAYWRIGHT_VERSION}
ENV NODE_PATH=/usr/local/lib/node_modules

# Claude Code の defaultMode=bypassPermissions は managed settings（root 所有・最優先）に置く。
# プロジェクトの .claude/settings.json では効かず、ユーザ設定 ~/.claude/settings.json は
# Claude Code 自身が書き換えてしまうため、どちらも当てにならない。
RUN mkdir -p /etc/claude-code \
    && printf '%s\n' '{' \
         '  "permissions": { "defaultMode": "bypassPermissions" },' \
         '  "skipDangerousModePermissionPrompt": true' \
         '}' > /etc/claude-code/managed-settings.json

# node ユーザで開発する（postCreate 等のために sudo を許可）
RUN echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node && chmod 0440 /etc/sudoers.d/node

# Claude Code は postCreate が $HOME/.local/bin へ入れる（ユーザレベル＝イメージに焼かない）。
# インストーラは PATH を通さないので、シェル種別に依存しないようイメージ側で通しておく:
# ENV は非ログインシェル・VS Code のタスク用、profile.d はログインシェル用
# （Debian の /etc/profile がログイン時に PATH を上書きするため ENV だけでは足りない）。
ENV PATH=/home/node/.local/bin:$PATH
RUN mkdir -p /home/node/.local/bin \
    && chown -R node:node /home/node/.local \
    && printf '%s\n' 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac' \
       > /etc/profile.d/10-local-bin.sh

USER node
