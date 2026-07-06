// parse.js — turn an agent transcript into an ordered list of tool calls + token
// usage. Harness-neutral by design: each harness gets a small adapter, and they
// all emit the same flat shape, so analyze/report never learn the format.
//
// Adapters today:
//   - Claude Code JSONL   (~/.claude/projects/**/*.jsonl)
//   - OpenAI-format JSONL  (chat-completion responses or raw message arrays with
//                           tool_calls / role:"tool" — the OpenAI Agents SDK / API shape)
// The format is auto-detected; you never pass a flag.

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
      // custom/harness-specific tools (e.g. an OpenAI function): key on a stable
      // serialization of the args so identical calls collapse to one signature.
      try {
        const s = JSON.stringify(input);
        return s === "{}" ? "" : s.slice(0, 200);
      } catch {
        return "";
      }
    }
  }
}

// Tools that READ state and should be idempotent — repeating them verbatim is the
// smell postflight looks for. Repeating an Edit/Write is often legitimate.
const READ_LIKE = new Set(["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch"]);

// For custom (non-Claude) tools we don't know the semantics, so guess: a name that
// looks like a mutation is not read-like; everything else (search/get/list/query…)
// is, because re-running it with identical args is the waste worth flagging.
const MUTATION_RE = /(^|[_\-.])(write|create|update|delete|insert|send|post|put|patch|remove|edit|save|upload|append|set|add|make|publish|commit|deploy)/i;
function customReadLike(name) {
  return !MUTATION_RE.test(name || "");
}

function resultLen(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content))
    return content.reduce((a, x) => a + (typeof x?.text === "string" ? x.text.length : 0), 0);
  return 0;
}

function normalize(parts) {
  // attach results to their calls, then return the flat harness-neutral shape.
  const { toolCalls, resultsById, usage, assistantTurns, userTurns, firstTs, lastTs, heavy } = parts;
  for (const call of toolCalls) {
    const r = call.id ? resultsById.get(call.id) : null;
    call.isError = r ? r.isError : false;
    call.resultLen = r ? r.len : 0;
  }
  return {
    toolCalls,
    usage,
    assistantTurns,
    userTurns,
    durationMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    heavy,
  };
}

// --- format detection -------------------------------------------------------
// Claude Code: records tagged {type:"assistant"|"user", message:{…}}.
// OpenAI:      chat-completion objects ({choices:[…]}) or bare messages with a
//              `role` and tool_calls / tool_call_id.
function detectFormat(records) {
  let claude = 0;
  let openai = 0;
  for (const d of records.slice(0, 40)) {
    if (!d || typeof d !== "object") continue;
    if ((d.type === "assistant" || d.type === "user") && d.message && typeof d.message === "object") claude++;
    else if (Array.isArray(d.choices) || d.object === "chat.completion") openai++;
    else if (typeof d.role === "string" && (Array.isArray(d.tool_calls) || d.tool_call_id || d.role === "tool")) openai++;
  }
  return openai > claude ? "openai" : "claude";
}

// --- Claude Code adapter (unchanged semantics) ------------------------------
function parseClaudeCode(records) {
  const toolCalls = [];
  const resultsById = new Map();
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
  const heavy = [];

  for (const d of records) {
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
        if (id) resultsById.set(id, { isError: !!b.is_error, len: resultLen(b.content) });
      }
    }
  }

  return normalize({ toolCalls, resultsById, usage, assistantTurns, userTurns, firstTs, lastTs, heavy });
}

// --- OpenAI-format adapter --------------------------------------------------
// Accepts a JSONL of any mix of: chat-completion responses ({choices,usage,created}),
// bare messages ({role,content,tool_calls|tool_call_id}), or {messages:[…]} wrappers.
function parseOpenAI(records) {
  const toolCalls = [];
  const resultsById = new Map();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let assistantTurns = 0;
  let userTurns = 0;
  let firstTs = null;
  let lastTs = null;
  let seq = 0;
  const heavy = [];

  const noteTs = (t) => {
    if (t == null) return;
    const ms = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
    if (!Number.isNaN(ms)) {
      firstTs = firstTs === null ? ms : Math.min(firstTs, ms);
      lastTs = lastTs === null ? ms : Math.max(lastTs, ms);
    }
  };

  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    noteTs(rec.timestamp ?? rec.created ?? rec.created_at);

    const u = rec.usage || null;
    const outTok = u ? u.completion_tokens ?? u.output_tokens ?? 0 : 0;
    if (u) {
      usage.input += u.prompt_tokens ?? u.input_tokens ?? 0;
      usage.output += outTok;
      usage.cacheRead += u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
    }

    // collect the message(s) carried by this record
    const messages = [];
    if (Array.isArray(rec.choices)) {
      for (const ch of rec.choices) if (ch && ch.message) messages.push(ch.message);
    } else if (Array.isArray(rec.messages)) {
      for (const m of rec.messages) if (m && m.role) messages.push(m);
    } else if (typeof rec.role === "string") {
      messages.push(rec);
    }

    let creditedTurn = false;
    for (const m of messages) {
      if (m.role === "assistant") {
        assistantTurns++;
        // credit this record's output tokens to the first assistant message in it
        if (outTok && !creditedTurn) {
          heavy.push({ turn: assistantTurns, outputTokens: outTok });
          creditedTurn = true;
        }
        for (const tc of m.tool_calls || []) {
          const fn = tc.function || {};
          let input = {};
          try {
            input = typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : fn.arguments || {};
          } catch {
            input = { _raw: String(fn.arguments) };
          }
          const name = fn.name || tc.name || "?";
          const isClaudeName = READ_LIKE.has(name) || ["Edit", "Write", "NotebookEdit", "Task", "Agent"].includes(name);
          toolCalls.push({
            seq: seq++,
            id: tc.id || null,
            name,
            target: targetOf(name, input),
            readLike: isClaudeName ? READ_LIKE.has(name) : customReadLike(name),
            ts: null,
          });
        }
      } else if (m.role === "tool") {
        userTurns++;
        const id = m.tool_call_id;
        // no standard error flag in OpenAI tool results — leave isError false rather
        // than guess from content (a false "retry loop" is worse than none).
        if (id) resultsById.set(id, { isError: false, len: resultLen(m.content) });
      } else if (m.role === "user") {
        userTurns++;
      }
    }
  }

  return normalize({ toolCalls, resultsById, usage, assistantTurns, userTurns, firstTs, lastTs, heavy });
}

export function parseTranscript(path) {
  const raw = readFileSync(path, "utf8");
  const records = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      records.push(JSON.parse(s));
    } catch {
      // tolerate a stray non-JSON line rather than fail the whole run
    }
  }
  const format = detectFormat(records);
  const parsed = format === "openai" ? parseOpenAI(records) : parseClaudeCode(records);
  parsed.path = path;
  parsed.format = format;
  return parsed;
}
