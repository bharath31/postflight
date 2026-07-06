# postflight

**read your agent's run back.**

vercel shipped agent observability into deploys this week. langsmith, langfuse, braintrust,
helicone all did it before them. the dashboard is table stakes now. it was never the point.

the point of a run is to make the *next* run better. postflight is a tiny, local, harness-neutral
CLI that turns an agent transcript into a **flight review + the skill to extract** — not a chart to
stare at.

```
npx agent-postflight
```

no signup, no SDK, no platform. it reads your most recent Claude Code run and tells you where the
loop leaked.

## the demo is the argument

run it on a real session:

```
$ npx agent-postflight

# postflight — flight review

**725 tool calls** across 1,434 turns · 20 distinct tools · 3d 8h (resumed) · 1,319,024 tokens generated

> worth a look: 26 tool errors (4%) · ~57,015 tokens re-reading the same things · 8 redundant read patterns · 8 retry loops

## redundant work — the agent re-derived the same thing
- `Read` × 27 — `site/agent-worker/src/index.ts` · ~29,128 tokens
- `Read` × 8  — `README.md` · ~1,344 tokens
- `Read` × 7  — `site/index.html` · ~9,396 tokens

## the skill to extract →
the agent ran `Read` on index.ts 27× — re-deriving the same thing instead of remembering it.
capture its durable facts once (a skill, or a line in CLAUDE.md), and the next run reads it once.
```

that `Read × 27` is a real number from a real session. the agent read the same file twenty-seven
times because nothing told it to remember. that's not a model problem. it's a missing loop — and a
missing loop is a skill waiting to be written.

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
postflight path/to/run.jsonl  review a specific transcript
postflight --list             list recent runs
postflight --json             findings as JSON (pipe it anywhere)
postflight --skill            write the proposed skill to .claude/skills/<name>/SKILL.md
```

## harness-neutral by design

the Claude Code JSONL reader is the first adapter. the analysis never sees the format — so
OpenAI Agents SDK, LangGraph, and raw-log adapters are additive, not rewrites. (Claude Code
first because it's where the transcripts already live on disk. more adapters next.)

## the honest caveat

if your runs are short and tight, postflight will tell you so and find nothing to fix — that's a
good run, not a failure. and the loop-closing (`--skill`) gives you a *scaffold*, not a finished
skill; you still write the durable facts. the value is that it points at exactly the right thing to
capture. it will not fabricate a problem to look useful.

## why this exists

built by [Bharath Natarajan](https://bharath.sh) — this is loop engineering as a tool: a run should
teach the next run. observability shows you the run. postflight closes the loop.

MIT.
