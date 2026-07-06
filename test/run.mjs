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
