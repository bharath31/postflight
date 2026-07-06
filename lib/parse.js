// parse.js — turn a Claude Code JSONL transcript into an ordered list of tool
// calls + token usage. Harness-neutral by design: the Claude Code reader is the
// first adapter; the shape it returns (a flat `events`/`toolCalls` model) is what
// every other adapter will produce, so analyze/report never learn the format.

import { readFileSync } from "node:fs";

// Normalize a tool call's input into a stable signature target, so "read the same
// file twice" collapses to one signature regardless of incidental key order.
function targetOf(name, input) {
  input = input || {};
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
      return input.file_path || input.path || "";
    case "Bash":
      return (input.command || "").trim().replace(/\s+/g, " ");
    case "Grep":
      return `${input.pattern || ""} :: ${input.path || input.glob || ""}`;
    case "Glob":
      return input.pattern || "";
    case "WebFetch":
      return input.url || "";
    case "WebSearch":
      return input.query || "";
    case "Task":
    case "Agent":
      return (input.description || input.subagent_type || "").trim();
    default: {
      try {
        return JSON.stringify(input).slice(0, 200);
      } catch {
        return "";
      }
    }
  }
}

// Tools that READ state and should be idempotent — repeating them verbatim is the
// smell postflight looks for. Repeating an Edit/Write is often legitimate.
const READ_LIKE = new Set(["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch"]);

export function parseTranscript(path) {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");

  const toolCalls = []; // ordered
  const resultsById = new Map(); // tool_use_id -> { isError, len }
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  // Claude Code writes one JSONL line per content block, so a single assistant
  // message (one message.id) can span several lines that each repeat the SAME
  // cumulative usage. Counting usage per line double-counts tokens (~2.5x on real
  // runs). Dedupe by message.id: count usage + a turn once per distinct message.
  const seenMsgIds = new Set();
  let assistantTurns = 0;
  let userTurns = 0;
  let firstTs = null;
  let lastTs = null;
  let seq = 0;
  const heavy = []; // { turn, outputTokens }

  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let d;
    try {
      d = JSON.parse(s);
    } catch {
      continue;
    }
    if (d.timestamp) {
      const t = Date.parse(d.timestamp);
      if (!Number.isNaN(t)) {
        firstTs = firstTs === null ? t : Math.min(firstTs, t);
        lastTs = lastTs === null ? t : Math.max(lastTs, t);
      }
    }
    const msg = d.message;
    if (!msg || typeof msg !== "object") continue;

    if (d.type === "assistant") {
      const id = msg.id || null;
      // a new turn only when this message.id hasn't been accounted yet (no id ⇒
      // always new, which keeps single-line transcripts and fixtures exact).
      if (!id || !seenMsgIds.has(id)) {
        if (id) seenMsgIds.add(id);
        assistantTurns++;
        const u = msg.usage;
        if (u) {
          usage.input += u.input_tokens || 0;
          usage.output += u.output_tokens || 0;
          usage.cacheRead += u.cache_read_input_tokens || 0;
          usage.cacheWrite += u.cache_creation_input_tokens || 0;
          heavy.push({ turn: assistantTurns, outputTokens: u.output_tokens || 0 });
        }
      }
    } else if (d.type === "user") {
      userTurns++;
    }

    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_use") {
        toolCalls.push({
          seq: seq++,
          id: b.id || null,
          name: b.name || "?",
          target: targetOf(b.name, b.input),
          readLike: READ_LIKE.has(b.name),
          ts: d.timestamp ? Date.parse(d.timestamp) : null,
        });
      } else if (b.type === "tool_result") {
        const id = b.tool_use_id;
        if (id) {
          let len = 0;
          const c = b.content;
          if (typeof c === "string") len = c.length;
          else if (Array.isArray(c))
            len = c.reduce((a, x) => a + (typeof x?.text === "string" ? x.text.length : 0), 0);
          resultsById.set(id, { isError: !!b.is_error, len });
        }
      }
    }
  }

  // attach results to their calls
  for (const call of toolCalls) {
    const r = call.id ? resultsById.get(call.id) : null;
    call.isError = r ? r.isError : false;
    call.resultLen = r ? r.len : 0;
  }

  return {
    path,
    toolCalls,
    usage,
    assistantTurns,
    userTurns,
    durationMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    heavy,
  };
}
