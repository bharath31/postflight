#!/usr/bin/env node
// postflight — read your agent's run back.
// usage: postflight [transcript.jsonl] [--json] [--skill] [--list]
// with no path, it finds your most recent Claude Code transcript.

import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../lib/parse.js";
import { analyze } from "../lib/analyze.js";
import { toMarkdown, skillMarkdown } from "../lib/report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// bundled sample run, so anyone can see the flight review with zero setup:
//   npx agent-postflight --demo
const DEMO_PATH = join(__dirname, "..", "examples", "session.jsonl");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

function findTranscripts() {
  const base = join(homedir(), ".claude", "projects");
  if (!existsSync(base)) return [];
  const out = [];
  for (const proj of readdirSync(base)) {
    const dir = join(base, proj);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".jsonl")) {
        const p = join(dir, f);
        try {
          out.push({ path: p, mtime: statSync(p).mtimeMs, project: proj });
        } catch {}
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function main() {
  if (flags.has("--help") || flags.has("-h")) {
    console.log(
      `postflight — read your agent's run back.\n\n` +
        `usage:\n` +
        `  postflight [transcript.jsonl]   review a run (default: your latest Claude Code run)\n` +
        `  postflight --demo               review a bundled sample run (no setup needed)\n` +
        `  postflight --list               list recent runs\n` +
        `  postflight --json               emit findings as JSON\n` +
        `  postflight --skill              write the proposed skill to .claude/skills/<name>/SKILL.md\n`
    );
    return;
  }

  const transcripts = findTranscripts();

  if (flags.has("--list")) {
    if (!transcripts.length) return console.log("no Claude Code transcripts found under ~/.claude/projects");
    for (const t of transcripts.slice(0, 15)) {
      console.log(`${new Date(t.mtime).toISOString().slice(0, 16).replace("T", " ")}  ${t.project}`);
    }
    return;
  }

  let path = positional[0];
  if (flags.has("--demo")) {
    path = DEMO_PATH;
  }
  if (!path) {
    if (!transcripts.length) {
      console.error(
        "postflight: no transcript given and none found under ~/.claude/projects.\n\n" +
          "  try the bundled sample:  postflight --demo\n" +
          "  or point at a run:        postflight path/to/run.jsonl"
      );
      process.exit(1);
    }
    path = transcripts[0].path;
  }
  if (!existsSync(path)) {
    console.error(`postflight: no such file: ${path}`);
    process.exit(1);
  }

  const parsed = parseTranscript(path);
  if (!parsed.toolCalls.length) {
    console.error("postflight: no tool calls found in that transcript (nothing to review).");
    process.exit(1);
  }
  const a = analyze(parsed);

  if (flags.has("--json")) {
    console.log(JSON.stringify(a, null, 2));
    return;
  }

  process.stdout.write(toMarkdown(a, { source: flags.has("--demo") ? "bundled sample · your own run: npx agent-postflight" : path }));

  if (flags.has("--skill")) {
    if (!a.skill) {
      console.error("\npostflight: nothing repeated enough to extract a skill from this run.");
      return;
    }
    const dir = join(process.cwd(), ".claude", "skills", a.skill.name);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, "SKILL.md");
    writeFileSync(out, skillMarkdown(a.skill) + "\n");
    console.error(`\npostflight: wrote proposed skill → ${out} (review before using)`);
  }
}

main();
