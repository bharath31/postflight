// analyze.js — the flight review. Takes the harness-neutral parse output and finds
// the loops: redundant read-like calls, error/retry chains, and the dominant
// repeated workflow worth extracting into a skill. No dashboards — findings + a fix.

const APPROX_TOKENS_PER_CHAR = 0.27; // ~4 chars/token, for rough "re-read" cost

function slug(s) {
  return (
    (s || "pattern")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "pattern"
  );
}

// A human-readable subject for the extracted skill. File paths → basename;
// serialized args (a custom/OpenAI tool) → the tool name; anything else (a
// command, a query) → its last token.
function subjectOf(name, target) {
  if (target.includes("/")) return target.split(/[\/\s]/).filter(Boolean).slice(-1)[0] || target;
  if (/^\s*[{[]/.test(target)) return name;
  return target.split(/\s+/).filter(Boolean).slice(-1)[0] || name;
}

export function analyze(parsed) {
  const { toolCalls } = parsed;

  // --- tool histogram ---
  const histogram = {};
  for (const c of toolCalls) histogram[c.name] = (histogram[c.name] || 0) + 1;

  // --- redundant read-like calls (same tool + same target, seen >1x) ---
  const sigCount = new Map(); // sig -> { name, target, count, wastedChars }
  for (const c of toolCalls) {
    if (!c.readLike || !c.target) continue;
    const sig = `${c.name}::${c.target}`;
    const e = sigCount.get(sig) || { name: c.name, target: c.target, count: 0, chars: 0 };
    e.count++;
    e.chars += c.resultLen || 0;
    sigCount.set(sig, e);
  }
  const redundant = [...sigCount.values()]
    .filter((e) => e.count > 1)
    .map((e) => ({
      name: e.name,
      target: e.target,
      count: e.count,
      // wasted = the repeats (count-1) worth of re-read result payload
      wastedTokens: Math.round(((e.chars * (e.count - 1)) / e.count) * APPROX_TOKENS_PER_CHAR),
    }))
    .sort((a, b) => b.count - a.count || b.wastedTokens - a.wastedTokens);

  // --- error / retry chains: an errored call followed by same-tool calls nearby ---
  const errors = toolCalls.filter((c) => c.isError);
  const retryChains = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const c = toolCalls[i];
    if (!c.isError) continue;
    // look ahead up to 3 calls for a same-tool retry
    let j = i + 1;
    const chain = [c];
    while (j < toolCalls.length && j <= i + 4) {
      const n = toolCalls[j];
      if (n.name === c.name) {
        chain.push(n);
        if (!n.isError) break; // recovered
      }
      j++;
    }
    if (chain.length > 1) {
      retryChains.push({
        name: c.name,
        target: c.target,
        attempts: chain.length,
        recovered: !chain[chain.length - 1].isError,
        atSeq: c.seq,
      });
      i = j; // skip past this chain
    }
  }

  // --- heaviest turns by output tokens ---
  const heaviest = [...parsed.heavy].sort((a, b) => b.outputTokens - a.outputTokens).slice(0, 3);

  // --- run shape: the most common consecutive tool bigram (a separate stat) ---
  const bigrams = new Map();
  for (let i = 1; i < toolCalls.length; i++) {
    const k = `${toolCalls[i - 1].name} → ${toolCalls[i].name}`;
    bigrams.set(k, (bigrams.get(k) || 0) + 1);
  }
  const topBigram = [...bigrams.entries()].sort((a, b) => b[1] - a[1])[0];

  // --- the skill to extract: the most re-derived read target, framed coherently ---
  // if the agent re-read the same thing 3+ times, it never remembered it — that's a
  // skill (or a CLAUDE.md fact) waiting to be written. This is the loop-closing move.
  let skill = null;
  const topRepeat = redundant[0];
  if (topRepeat && topRepeat.count >= 3) {
    const subject = subjectOf(topRepeat.name, topRepeat.target);
    skill = {
      name: slug(`${subject}-context`),
      kind: topRepeat.name,
      subject,
      target: topRepeat.target,
      count: topRepeat.count,
      why:
        `the agent ran \`${topRepeat.name}\` on this **${topRepeat.count}×** — re-deriving the same thing ` +
        `instead of remembering it. capture its durable facts once (a skill, or a line in CLAUDE.md/AGENTS.md), ` +
        `and the next run reads it once.`,
    };
  }

  const wastedTokens = redundant.reduce((a, r) => a + r.wastedTokens, 0);

  return {
    summary: {
      toolCalls: toolCalls.length,
      distinctTools: Object.keys(histogram).length,
      assistantTurns: parsed.assistantTurns,
      errorCount: errors.length,
      errorRate: toolCalls.length ? errors.length / toolCalls.length : 0,
      // honest token accounting: output = real generation. context re-read (cache)
      // is reported separately — you can't sum per-turn input, it re-sends context.
      outputTokens: parsed.usage.output,
      contextReadTokens: parsed.usage.cacheRead,
      wastedTokens,
      durationMs: parsed.durationMs,
      runShape: topBigram ? { pair: topBigram[0], count: topBigram[1] } : null,
    },
    histogram,
    redundant: redundant.slice(0, 8),
    retryChains: retryChains.slice(0, 8),
    heaviest,
    skill,
  };
}
