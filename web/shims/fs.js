// browser shim — the playground only ever parses text, never reads files
export function readFileSync() {
  throw new Error("fs is unavailable in the browser — use parseTranscriptText()");
}
