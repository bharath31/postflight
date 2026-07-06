// report.js — render the flight review as markdown (the human-readable argument)
// and the proposed skill as an extractable SKILL.md scaffold.

import { homedir } from "node:os";

const HOME = homedir();
// Collapse the user's home dir to `~` in anything we print. postflight output is
// meant to be screenshotted and shared, so never leak an absolute /Users/<name>/…
// path. JSON output keeps raw paths for machine use; only the markdown prettifies.
function tilde(s) {
  s = String(s || "");
  return HOME && s.startsWith(HOME) ? "~" + s.slice(HOME.length) : s;
}

function fmt(n) {
  return Math.round(n).toLocaleString("en-US");
}
function dur(ms) {
  if (ms == null) return "unknown";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h (resumed)`;
}

export function toMarkdown(a, meta = {}) {
  const s = a.summary;
  const L = [];
  L.push(`# postflight — flight review`);
  if (meta.source) L.push(`\n\`${tilde(meta.source)}\``);
  L.push("");
  L.push(
    `**${fmt(s.toolCalls)} tool calls** across ${fmt(s.assistantTurns)} turns · ` +
      `${fmt(s.distinctTools)} distinct tools · ${dur(s.durationMs)} · ` +
      `${fmt(s.outputTokens)} tokens generated`
  );

  const flags = [];
  if (s.errorCount) flags.push(`${s.errorCount} tool errors (${(s.errorRate * 100).toFixed(0)}%)`);
  if (s.wastedTokens) flags.push(`~${fmt(s.wastedTokens)} tokens re-reading the same things`);
  if (a.redundant.length) flags.push(`${a.redundant.length} redundant read patterns`);
  if (a.retryChains.length) flags.push(`${a.retryChains.length} retry loops`);
  if (flags.length) L.push(`\n> **worth a look:** ${flags.join(" · ")}`);
  else L.push(`\n> clean run — no redundant reads or retry loops detected.`);

  if (a.redundant.length) {
    L.push(`\n## redundant work — the agent re-derived the same thing`);
    for (const r of a.redundant) {
      const w = r.wastedTokens ? ` · ~${fmt(r.wastedTokens)} tokens` : "";
      L.push(`- \`${r.name}\` × **${r.count}** — \`${trunc(tilde(r.target), 76)}\`${w}`);
    }
  }

  if (a.retryChains.length) {
    L.push(`\n## retry loops — errored, then tried again`);
    for (const c of a.retryChains) {
      const ok = c.recovered ? "recovered" : "**never recovered**";
      L.push(`- \`${c.name}\` — ${c.attempts} attempts, ${ok} — \`${trunc(tilde(c.target), 60)}\``);
    }
  }

  if (a.heaviest.length) {
    L.push(`\n## heaviest turns (by output tokens)`);
    for (const h of a.heaviest) L.push(`- turn ${h.turn} — ${fmt(h.outputTokens)} tokens`);
  }

  const shape = s.runShape ? ` · run shape: \`${s.runShape.pair}\` ×${s.runShape.count}` : "";
  L.push(`\n## tool mix`);
  L.push(
    Object.entries(a.histogram)
      .sort((x, y) => y[1] - x[1])
      .map(([n, c]) => `${n} ${c}`)
      .join(" · ") + shape
  );

  L.push(`\n## the skill to extract →`);
  if (a.skill) {
    L.push(a.skill.why);
    L.push("\n```markdown");
    L.push(skillMarkdown(a.skill));
    L.push("```");
    L.push(
      `\n_close the loop: save that as \`.claude/skills/${a.skill.name}/SKILL.md\` (or drop the facts into ` +
        `CLAUDE.md), and the next run stops rediscovering it._`
    );
  } else {
    L.push(`nothing repeated ≥3× this run — nothing worth extracting. that's a tight run.`);
  }

  return L.join("\n") + "\n";
}

export function skillMarkdown(skill) {
  const subject = skill.target.split(/[\/\s]/).filter(Boolean).slice(-1)[0] || skill.target;
  return [
    `---`,
    `name: ${skill.name}`,
    `description: Use when you need to know about ${subject}. postflight saw the agent ${skill.kind} it ${skill.count}× in one run — capture it once here so it isn't re-derived.`,
    `---`,
    ``,
    `# ${skill.name}`,
    ``,
    `\`${tilde(skill.target)}\``,
    ``,
    `The agent re-read this ${skill.count} times in a single run. Write its durable facts here —`,
    `what it is, the 3-5 things worth knowing, the gotchas — so the next run reads it once:`,
    ``,
    `- <key fact 1>`,
    `- <key fact 2>`,
    `- <gotcha>`,
  ].join("\n");
}

function trunc(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
