// postflight playground — the REAL analyzer, bundled for the browser.
// Nothing uploads: parse → analyze → report all happen in this tab.
import { parseTranscriptText } from "../../lib/parse.js";
import { analyze } from "../../lib/analyze.js";
import { toMarkdown } from "../../lib/report.js";
import sample from "../../examples/session.jsonl";

const $ = (sel) => document.querySelector(sel);

// --- tiny renderer for the report's own markdown shape -----------------------
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
function renderReport(md) {
  const html = [];
  let inFence = false;
  let fence = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };
  for (const raw of md.split("\n")) {
    if (raw.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fence = [];
      } else {
        inFence = false;
        html.push('<pre class="skill">' + esc(fence.join("\n")) + "</pre>");
      }
      continue;
    }
    if (inFence) {
      fence.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push('<h3 class="r-title">' + inline(line.slice(2)) + "</h3>");
    } else if (line.startsWith("## ")) {
      closeList();
      html.push("<h4>" + inline(line.slice(3)) + "</h4>");
    } else if (line.startsWith("> ")) {
      closeList();
      const t = line.slice(2);
      const cls = /worth a look/.test(t) ? "flag warn" : "flag ok";
      html.push('<p class="' + cls + '">' + inline(t) + "</p>");
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push("<li>" + inline(line.slice(2)) + "</li>");
    } else if (/^_.+_$/.test(line)) {
      closeList();
      html.push('<p class="closing">' + inline(line.slice(1, -1)) + "</p>");
    } else {
      closeList();
      html.push("<p>" + inline(line) + "</p>");
    }
  }
  closeList();
  return html
    .join("\n")
    .replaceAll("<strong>never recovered</strong>", '<strong class="bad">never recovered</strong>');
}

// --- run + render -------------------------------------------------------------
function review(text, sourceName) {
  const out = $("#report");
  let parsed;
  try {
    parsed = parseTranscriptText(text, sourceName);
  } catch (err) {
    out.innerHTML = '<p class="flag warn">that didn’t parse — ' + esc(String(err.message || err)) + "</p>";
    return;
  }
  if (!parsed.toolCalls.length && !parsed.assistantTurns) {
    out.innerHTML =
      '<p class="flag warn">no agent activity found in this file.</p>' +
      '<p>postflight reads <code>.jsonl</code> transcripts — claude code (<code>~/.claude/projects/**/*.jsonl</code>) ' +
      "or OpenAI-format chat completions. the format is auto-detected.</p>";
    return;
  }
  const a = analyze(parsed);
  const md = toMarkdown(a, { source: sourceName });
  out.innerHTML = renderReport(md);
  $("#src-name").textContent = sourceName;

  // the "printing" reveal — staggered, and skipped for reduced motion
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    [...out.children].forEach((el, i) => el.style.setProperty("--i", i));
    out.classList.remove("printing");
    void out.offsetWidth; // restart the animation
    out.classList.add("printing");
  }
}

function loadSample() {
  review(sample, "bundled sample · your own run: npx agent-postflight");
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => review(String(reader.result), file.name);
  reader.readAsText(file);
}

// --- wire up -------------------------------------------------------------------
loadSample();
$("#btn-sample").addEventListener("click", loadSample);
$("#file-input").addEventListener("change", (e) => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});
$("#btn-open").addEventListener("click", () => $("#file-input").click());

const card = $("#card");
["dragover", "dragenter"].forEach((ev) =>
  card.addEventListener(ev, (e) => {
    e.preventDefault();
    card.classList.add("dropping");
  })
);
["dragleave", "drop"].forEach((ev) =>
  card.addEventListener(ev, (e) => {
    e.preventDefault();
    card.classList.remove("dropping");
  })
);
card.addEventListener("drop", (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// copy chip
$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("npx agent-postflight");
    const el = $("#copy");
    el.textContent = "copied";
    setTimeout(() => (el.textContent = "copy"), 1400);
  } catch {}
});
