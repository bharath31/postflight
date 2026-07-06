// zero-dep test runner. node test/run.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTranscript } from "../lib/parse.js";
import { analyze } from "../lib/analyze.js";
import { toMarkdown } from "../lib/report.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixture.jsonl");

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

const parsed = parseTranscript(fixture);
const a = analyze(parsed);

// --- duplicate message.id handling (Claude Code splits one message across lines,
//     each repeating the same cumulative usage — must count once, not per line) ---
const dup = parseTranscript(join(here, "fixture-dup.jsonl"));
// msg_A appears on 3 lines @200 output, msg_B on 1 line @150. Summed-per-line = 750;
// correct (deduped by id) = 350.
ok(dup.usage.output === 350, `dup usage counted once per message.id (got ${dup.usage.output}, want 350)`);
ok(dup.assistantTurns === 2, `dup turns counted once per message.id (got ${dup.assistantTurns}, want 2)`);
ok(dup.usage.cacheRead === 1100, `dup cache-read counted once per message.id (got ${dup.usage.cacheRead}, want 1100)`);
ok(dup.toolCalls.length === 3, `all 3 tool_use blocks kept across split lines (got ${dup.toolCalls.length})`);
const dupHeavy = [...dup.heavy].sort((x, y) => y.outputTokens - x.outputTokens);
ok(dupHeavy.length === 2 && dupHeavy[0].outputTokens === 200, `heaviest turns deduped (got ${dupHeavy.length} turns)`);

// parse
ok(parsed.toolCalls.length === 5, `5 tool calls (got ${parsed.toolCalls.length})`);
ok(parsed.usage.output === 460, `output tokens summed (got ${parsed.usage.output})`);

// redundant: config.ts read 3x
const cfg = a.redundant.find((r) => r.target === "/app/config.ts");
ok(cfg && cfg.count === 3, `config.ts flagged read 3× (got ${cfg && cfg.count})`);
ok(cfg && cfg.wastedTokens > 0, `wasted tokens estimated for the re-reads`);

// retry: npm test errored then recovered
const retry = a.retryChains.find((c) => c.name === "Bash");
ok(retry && retry.attempts === 2 && retry.recovered, `npm test retry chain detected + recovered`);
ok(a.summary.errorCount === 1, `1 tool error (got ${a.summary.errorCount})`);

// skill extraction: config.ts is the thing to remember
ok(a.skill && a.skill.count === 3, `skill proposed from the 3× re-read (got ${a.skill && a.skill.count})`);
ok(a.skill && /config/.test(a.skill.name), `skill named for the re-read subject (got ${a.skill && a.skill.name})`);

// honesty: no absurd summed-context token headline
ok(a.summary.outputTokens === 460, `headline uses generated tokens, not summed context`);

// report renders without throwing
const md = toMarkdown(a, { source: fixture });
ok(md.includes("redundant work"), `report includes redundant section`);
ok(md.includes("retry loops"), `report includes retry section`);

console.log(`\npostflight tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
