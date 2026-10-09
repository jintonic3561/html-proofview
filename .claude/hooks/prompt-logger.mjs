#!/usr/bin/env node
// ユーザープロンプトをブランチ別のraw.mdにログ記録するhook。
// 実行環境（devcontainer / リモート）に確実に居るのは Node だけなので Node で書く。
// 書き先はプロジェクトルート（CLAUDE_PROJECT_DIR、無ければ cwd）の .logs/。
// セッション中に `cd` していても、cwd 側に .logs/ を散らかさないため。

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

/** transcript JSONLからモデル名を抽出（末尾＝最新から探す） */
function getModelFromTranscript(transcriptPath) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return "unknown";
    const lines = readFileSync(transcriptPath, "utf-8").split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const model = entry?.message?.model;
      if (typeof model !== "string" || !model) continue;
      if (model.includes("opus")) return "opus";
      if (model.includes("sonnet")) return "sonnet";
      if (model.includes("haiku")) return "haiku";
      return model;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** transcript pathからセッション名（拡張子なしファイル名）を抽出 */
function getSessionName(transcriptPath) {
  try {
    if (!transcriptPath) return "unknown";
    return basename(transcriptPath, extname(transcriptPath));
  } catch {
    return "unknown";
  }
}

function getBranchName(root) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }

  const prompt = input?.prompt ?? "";
  if (!prompt) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  const transcriptPath = input?.transcript_path ?? "";
  const model = getModelFromTranscript(transcriptPath);
  const session = getSessionName(transcriptPath).slice(0, 8);
  const branch = getBranchName(root);

  const logDir = join(root, ".logs", "prompts", branch);
  const logFile = join(logDir, "raw.md");
  mkdirSync(logDir, { recursive: true });

  // 既存ファイルに追記する場合は区切り線を挿入
  const needsSeparator = existsSync(logFile) && statSync(logFile).size > 0;

  appendFileSync(
    logFile,
    `${needsSeparator ? "\n---\n\n" : ""}${prompt}\n\n[model: ${model}, session: ${session}]\n`,
    "utf-8",
  );
}

main();
