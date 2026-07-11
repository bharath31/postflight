# postflight

**read your agent's run back.**

[![npm](https://img.shields.io/npm/v/agent-postflight?color=black&label=npm)](https://www.npmjs.com/package/agent-postflight)
[![license](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-black)](package.json)

<p align="center">
  <img src="https://raw.githubusercontent.com/bharath31/postflight/main/examples/demo.svg" alt="postflight flight review — the output of npx agent-postflight --demo" width="760">
</p>

vercel shipped agent observability into deploys. langsmith, langfuse, braintrust, helicone
all did it before them. the dashboard is table stakes now. it was never the point.

the point of a run is to make the *next* run better. postflight is a tiny, local, harness-neutral
CLI that turns an agent transcript into a **flight review + the skill to extract** — not a chart to
stare at.

```
npx agent-postflight
```

no signup, no SDK, no platform. it reads your most recent Claude Code run and tells you where the
loop leaked. or try it in the browser — the same analyzer, running on your transcript in-tab:
**[postflight.pages.dev](https://postflight.pages.dev)**.

## the demo is the argument

no transcript handy? run the bundled sample — one command, no setup, the same shape of review
you'd get on your own run:

```
$ npx agent-postflight --demo

# postflight — flight review

**32 tool calls** across 32 turns · 4 distinct tools · 32s · 14,900 tokens generated

> worth a look: 5 tool errors (16%) · ~24,543 tokens re-reading the same things · 5 redundant read patterns · 2 retry loops

## redundant work — the agent re-derived the same thing
- `Read` × 12 — `~/src/db/schema.ts` · ~23,166 tokens
- `Read` × 5  — `~/package.json` · ~752 tokens
- `Read` × 2  — `~/src/middleware/auth.ts` · ~608 tokens

## retry loops — errored, then tried again
- `Bash` — 3 attempts, never recovered — `npm run lint`

## the skill to extract →
the agent ran `Read` on schema.ts 12× — re-deriving the same thing instead of remembering it.
capture its durable facts once (a skill, or a line in CLAUDE.md/AGENTS.md), and the next run reads it once.
```

then point it at your own latest run — no flag needed:

```
npx agent-postflight
```

that shape is real. on one production session postflight flagged `Read × 27` on a single file — the
agent read the same thing twenty-seven times because nothing told it to remember. that's not a model
problem. it's a missing loop — and a missing loop is a skill waiting to be written.

## what it finds

- **redundant work** — the same file read, the same command run, the same search repeated. with a
  rough token cost for the re-reads.
- **retry loops** — a tool that errored, then got tried again (and whether it ever recovered).
- **heaviest turns** — where the output tokens actually went.
- **run shape** — the dominant tool-to-tool pattern.
- **the skill to extract** — the one thing repeated enough that it should be captured once.
  `--skill` writes a `SKILL.md` scaffold for it. that's the loop, closed.

## usage

```
postflight                    review your latest Claude Code run
postflight --demo             review a bundled sample run (no setup needed)
postflight path/to/run.jsonl  review a specific transcript
postflight --list             list recent runs
postflight --json             findings as JSON (pipe it anywhere)
postflight --skill            write the proposed skill to .claude/skills/<name>/SKILL.md
```

## harness-neutral by design

the analysis never sees the format — each harness gets a small adapter, and they all emit the same
shape. **two ship today, auto-detected (no flag):**

- **Claude Code** — `~/.claude/projects/**/*.jsonl` (the default, and the most battle-tested path)
- **OpenAI-format** — a JSONL of chat-completion responses *or* raw message arrays with `tool_calls` /
  `role:"tool"` (the OpenAI Agents SDK / Chat Completions shape)

point it at either and it just works — the format is detected for you:

```
postflight run.jsonl          # claude code or openai — detected automatically
```

LangGraph and raw-log adapters are next; because the analyzer never learns the format, they're
additive, not rewrites. (the OpenAI adapter is new — if your logs don't parse, open an issue with a
small sample and i'll fix it.)

## the honest caveat

if your runs are short and tight, postflight will tell you so and find nothing to fix — that's a
good run, not a failure. and the loop-closing (`--skill`) gives you a *scaffold*, not a finished
skill; you still write the durable facts. the value is that it points at exactly the right thing to
capture. it will not fabricate a problem to look useful.

## why this exists

built by [Bharath Natarajan](https://bharath.sh) — this is loop engineering as a tool: a run should
teach the next run. observability shows you the run. postflight closes the loop.

MIT.
