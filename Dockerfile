# syntax=docker/dockerfile:1
# base: Node メジャーを固定した共通土台
# dev:  devcontainer の attach イメージ（開発ツール込み）

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /workspace

# ---------------------------------------------------------------------------
FROM base AS dev

ARG PLAYWRIGHT_VERSION=1.50.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# fonts-noto-cjk: Chromium のスクショで日本語を出すため
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates gnupg openssh-client less procps unzip sudo jq direnv \
      fontconfig fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# glow（Markdown レンダラ。docs/ や README を端末で読む）
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://repo.charm.sh/apt/gpg.key | gpg --dearmor -o /etc/apt/keyrings/charm.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" > /etc/apt/sources.list.d/charm.list \
    && apt-get update && apt-get install -y --no-install-recommends glow \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI（gh）
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Chromium（scripts/shot.cjs 用）
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
    && ln -s "$(find /opt/pw-browsers -type f -name chrome -path '*chrome-linux*' | head -1)" /opt/pw-browsers/chromium \
    && chown -R node:node /opt/pw-browsers

# NODE_PATH: 任意の場所のスクリプトから require("playwright-core") を解決させる（CJS の require のみ。ESM の import には効かない）
RUN npm install -g playwright-core@${PLAYWRIGHT_VERSION}
ENV NODE_PATH=/usr/local/lib/node_modules

# Claude Code の defaultMode=bypassPermissions は managed settings に置く。
# プロジェクトの .claude/settings.json では効かず、~/.claude/settings.json は Claude Code 自身が書き換えるため。
RUN mkdir -p /etc/claude-code \
    && printf '%s\n' '{' \
         '  "permissions": { "defaultMode": "bypassPermissions" },' \
         '  "skipDangerousModePermissionPrompt": true' \
         '}' > /etc/claude-code/managed-settings.json

RUN echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node && chmod 0440 /etc/sudoers.d/node

# Claude Code（postCreate が ~/.local/bin へ入れる）の PATH。Debian の /etc/profile がログイン時に
# PATH を上書きするため、ENV に加えて profile.d にも通す。
ENV PATH=/home/node/.local/bin:$PATH
RUN mkdir -p /home/node/.local/bin \
    && chown -R node:node /home/node/.local \
    && printf '%s\n' 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac' \
       > /etc/profile.d/10-local-bin.sh

USER node
