#!/bin/bash

# .envファイルから環境変数を読み込む
# プロジェクトルートは CLAUDE_PROJECT_DIR、無ければ .claude/hooks/ から2階層上。
# cwd（$PWD）はセッション中の `cd` で動くので、表示にも使わない
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd ../.. && pwd)}"
if [ -f "${PROJECT_ROOT}/.env" ]; then
    set -a
    source "${PROJECT_ROOT}/.env"
    set +a
fi

# Slack Webhook URL or Bot Token
SLACK_TOKEN="${SLACK_BOT_TOKEN}"
SLACK_CHANNEL="${SLACK_CHANNEL:-#claude-code}"

# Get event type (Notification or Stop)
EVENT_TYPE="${CLAUDE_CODE_HOOK_EVENT:-Notification}"

# Get project info
PROJECT_DIR="${PROJECT_ROOT}"
PROJECT_NAME=$(basename "${PROJECT_DIR}")
BRANCH_NAME=$(git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")

# Get timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Build message based on event type
if [ "${EVENT_TYPE}" = "Notification" ]; then
    MESSAGE="⏸️ *Claude Code - 承認待ち*\n\n"
    MESSAGE+="📁 プロジェクト: \`${PROJECT_NAME}\`\n"
    MESSAGE+="🌿 ブランチ: \`${BRANCH_NAME}\`\n"
    MESSAGE+="📍 パス: \`${PROJECT_DIR}\`\n"
    MESSAGE+="⏰ 時刻: ${TIMESTAMP}\n\n"
    MESSAGE+="⚠️ ユーザーの承認が必要です"
elif [ "${EVENT_TYPE}" = "AskUserQuestion" ]; then
    MESSAGE="❓ *Claude Code - 質問あり*\n\n"
    MESSAGE+="📁 プロジェクト: \`${PROJECT_NAME}\`\n"
    MESSAGE+="🌿 ブランチ: \`${BRANCH_NAME}\`\n"
    MESSAGE+="📍 パス: \`${PROJECT_DIR}\`\n"
    MESSAGE+="⏰ 時刻: ${TIMESTAMP}\n\n"
    MESSAGE+="💬 ユーザーへの確認事項があります"
elif [ "${EVENT_TYPE}" = "Stop" ]; then
    MESSAGE="✅ *Claude Code - タスク完了*\n\n"
    MESSAGE+="📁 プロジェクト: \`${PROJECT_NAME}\`\n"
    MESSAGE+="🌿 ブランチ: \`${BRANCH_NAME}\`\n"
    MESSAGE+="📍 パス: \`${PROJECT_DIR}\`\n"
    MESSAGE+="⏰ 時刻: ${TIMESTAMP}\n\n"
    MESSAGE+="🎉 作業が完了しました"
else
    MESSAGE="ℹ️ *Claude Code - 通知*\n\n"
    MESSAGE+="📁 プロジェクト: \`${PROJECT_NAME}\`\n"
    MESSAGE+="イベント: ${EVENT_TYPE}"
fi

# Send to Slack
if [ -n "${SLACK_TOKEN}" ]; then
    curl -X POST https://slack.com/api/chat.postMessage \
        -H "Authorization: Bearer ${SLACK_TOKEN}" \
        -H "Content-Type: application/json; charset=utf-8" \
        -d "{
            \"channel\": \"${SLACK_CHANNEL}\",
            \"text\": \"${MESSAGE}\",
            \"mrkdwn\": true
        }" \
        --silent --show-error > /dev/null
else
    echo "Warning: SLACK_BOT_TOKEN not set. Slack notification skipped." >&2
fi
