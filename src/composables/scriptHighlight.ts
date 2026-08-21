// >>> syntax highlighter, spits out html with sh-* spans
const CUSTOM_FAMILIES = [
  "$counter.",
  "$ucounter.",
  "$var.",
  "$uvar.",
  "$list.",
];

const BUILTIN_PREFIXES = [
  "$user",
  "$target",
  "$channel",
  "$command",
  "$countdown",
  "$message",
  "$args",
  "$query",
  "$random",
  "$time",
  "$text",
  "$regex",
  "$calc",
  "$http",
  "$twitch",
  "$emote",
  "$log",
  "$mod",
  "$chat",
  "$cooldown",
  "$debug",
  "$index",
  "$last_error",
  "$1",
  "$2",
  "$3",
  "$4",
  "$5",
  "$6",
  "$7",
  "$8",
  "$9",
];

const BLOCK_KEYWORDS_PAREN = ["$foreach", "$repeat", "$define"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// >>> kw/cond/body colors per nested $if level
const IF_COLORS = [
  { kw: "#569cd6", cond: "#7ec8e3", body: "#4ec9b0" }, // <<< level 0: blue/cyan/teal
  { kw: "#c792ea", cond: "#dda0ff", body: "#f9a84d" }, // <<< level 1: purple/lavender/orange
  { kw: "#4ec9b0", cond: "#98d9c8", body: "#82aaff" }, // <<< level 2: teal/mint/periwinkle
];

function colorAt(level: number) {
  return IF_COLORS[level % IF_COLORS.length]!;
}

function isValidCondition(cond: string): boolean {
  const trimmed = cond.trim();
  return trimmed.length > 0 && /\$/.test(trimmed);
}

export function highlightScript(src: string, ifLevel = 0): string {
  let out = "",
    i = 0;

  while (i < src.length) {
    if (src[i] === "\n") {
      out += "\n";
      i++;
      continue;
    }

    // >>> quoted string
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i]!;
      let j = i + 1;
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") j++;
        j++;
      }
      j++;
      out += `<span class="sh-string">${esc(src.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // >>> number literal, skip if right after a $token char
    if (/\d/.test(src[i]!) && (i === 0 || !/[$\w]/.test(src[i - 1]!))) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j]!)) j++;
      out += `<span class="sh-number">${esc(src.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // vvv $if block vvv
    if (src.startsWith("$if(", i) || src.startsWith("$if (", i)) {
      const col = colorAt(ifLevel);

      const parenStart = src.indexOf("(", i + 3);
      if (parenStart === -1) {
        // >>> malformed, just emit $if as keyword
        out += `<span class="sh-kw" style="color:${col.kw}">$if</span>`;
        i += 3;
        continue;
      }

      let depth = 0,
        condEnd = -1;
      for (let k = parenStart; k < src.length; k++) {
        if (src[k] === "(") depth++;
        else if (src[k] === ")") {
          depth--;
          if (depth === 0) {
            condEnd = k;
            break;
          }
        }
      }

      if (condEnd === -1) {
        // >>> unclosed paren
        out += `<span class="sh-kw" style="color:${col.kw}">$if</span>`;
        out += esc(src.slice(i + 3));
        i = src.length;
        continue;
      }

      const condSrc = src.slice(parenStart + 1, condEnd);
      const afterCond = src.slice(condEnd + 1);
      const braceMatch = afterCond.match(/^\s*\{/);

      out += `<span class="sh-if-kw" style="color:${col.kw}">$if</span>`;

      const condTrimmed = condSrc.trim();
      const condValid = isValidCondition(condSrc);
      let condClass = "";
      if (condTrimmed === "") condClass = "sh-if-cond-empty";
      else if (!condValid) condClass = "sh-if-cond-invalid";

      out += `<span class="sh-if-cond${condClass ? " " + condClass : ""}" style="color:${col.cond}">`;
      out += `<span class="sh-if-paren" style="color:${col.kw}">(</span>`;
      out += highlightScript(condSrc, ifLevel); // <<< recurse into condition
      out += `<span class="sh-if-paren" style="color:${col.kw}">)</span>`;
      out += `</span>`;

      if (braceMatch) {
        // >>> brace syntax: $if(...){ body }
        const braceStart = condEnd + 1 + afterCond.indexOf("{");
        let bdepth = 0,
          bodyEnd = -1;
        for (let k = braceStart; k < src.length; k++) {
          if (src[k] === "{") bdepth++;
          else if (src[k] === "}") {
            bdepth--;
            if (bdepth === 0) {
              bodyEnd = k;
              break;
            }
          }
        }

        // >>> preserve whitespace gap between ) and {
        const gapText = src.slice(condEnd + 1, braceStart);
        if (gapText.trim() === "" && gapText.length > 0) out += gapText;

        if (bodyEnd === -1) {
          // >>> unclosed brace, leave it open
          const body = src.slice(braceStart + 1);
          const bodyTrimmed = body.trim();
          out += `<span class="sh-if-body${bodyTrimmed === "" ? " sh-if-body-empty" : ""}" style="color:${col.body}">`;
          out += `<span class="sh-if-paren" style="color:${col.kw}">{</span>`;
          out += highlightScript(body, ifLevel + 1);
          out += `<span class="sh-if-paren" style="color:${col.kw}">}</span>`;
          out += `</span>`;
          i = src.length;
          continue;
        }

        const body = src.slice(braceStart + 1, bodyEnd);
        const bodyTrimmed = body.trim();
        out += `<span class="sh-if-body${bodyTrimmed === "" ? " sh-if-body-empty" : ""}" style="color:${col.body}">`;
        out += `<span class="sh-if-paren" style="color:${col.kw}">{</span>`;
        out += highlightScript(body, ifLevel + 1);
        out += `<span class="sh-if-paren" style="color:${col.kw}">}</span>`;
        out += `</span>`;
        i = bodyEnd + 1;
      } else {
        // >>> legacy $end syntax, kept for old saved commands
        const endRel = afterCond.indexOf("$end");
        if (endRel === -1) {
          i = condEnd + 1;
        } else {
          const bodyStart = condEnd + 1;
          const bodyEnd = condEnd + 1 + endRel;
          const body = src.slice(bodyStart, bodyEnd);
          const bodyTrimmed = body.trim();
          // >>> renders like brace-style, without the actual braces in text
          out += `<span class="sh-if-body${bodyTrimmed === "" ? " sh-if-body-empty" : ""}" style="color:${col.body}">`;
          out += `<span class="sh-if-paren sh-end-compat" style="color:${col.kw}">{</span>`;
          out += highlightScript(body, ifLevel + 1);
          out += `<span class="sh-if-paren sh-end-compat" style="color:${col.kw}">}</span>`;
          out += `</span>`;
          out +=
            `<span class="sh-end-legacy" title="Legacy syntax - consider updating to $if(...){ }">` +
            `<span class="sh-kw sh-end" style="opacity:0.35;font-size:0.85em">$end</span>` +
            `</span>`;
          i = bodyEnd + 4;
        }
      }
      continue;
    }
    // ^^^ end $if block ^^^

    if (src.startsWith("$else", i) && !/\w/.test(src[i + 5] ?? "")) {
      out += `<span class="sh-if-kw" style="color:#569cd6">$else</span>`;
      i += 5;
      continue;
    }

    // >>> $end legacy, shown faded
    if (src.startsWith("$end", i) && !/\w/.test(src[i + 4] ?? "")) {
      out += `<span class="sh-end-legacy"><span class="sh-kw sh-end" style="opacity:0.35;font-size:0.85em">$end</span></span>`;
      i += 4;
      continue;
    }

    const blockKw = BLOCK_KEYWORDS_PAREN.find((k) => src.startsWith(k, i));
    if (blockKw) {
      out += `<span class="sh-kw">${esc(blockKw)}</span>`;
      i += blockKw.length;
      continue;
    }

    // vvv $-token vvv
    if (src[i] === "$") {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j]!)) j++;
      // >>> consume function call parens
      if (src[j] === "(") {
        let depth = 0;
        while (j < src.length) {
          if (src[j] === "(") depth++;
          else if (src[j] === ")") {
            depth--;
            j++;
            if (depth === 0) break;
            continue;
          }
          j++;
        }
      }
      const tok = src.slice(i, j);

      if (CUSTOM_FAMILIES.some((f) => tok.startsWith(f))) {
        const family = CUSTOM_FAMILIES.find((f) => tok.startsWith(f))!;
        const rest = tok.slice(family.length);
        const dotIdx = rest.indexOf(".");
        const userName = dotIdx === -1 ? rest : rest.slice(0, dotIdx);
        const subProp = dotIdx === -1 ? "" : rest.slice(dotIdx);
        out +=
          `<span class="sh-builtin">${esc(family)}</span>` +
          `<span class="sh-custom">${esc(userName)}</span>` +
          (subProp ? `<span class="sh-builtin">${esc(subProp)}</span>` : "");
        i = j;
        continue;
      }

      let cls: string;
      if (
        BUILTIN_PREFIXES.some(
          (b) =>
            tok === b || tok.startsWith(b + ".") || tok.startsWith(b + "("),
        )
      ) {
        cls = "sh-builtin";
      } else if (/^\$[a-zA-Z_]\w*(\(.*\))?$/.test(tok)) {
        cls = "sh-custom";
      } else {
        cls = "sh-error";
      }
      out += `<span class="${cls}">${esc(tok)}</span>`;
      i = j;
      // >>> trailing *s modifier, silences chat output for this response
      if (
        src.slice(i, i + 2) === "*s" &&
        !/[a-zA-Z0-9_]/.test(src[i + 2] ?? "")
      ) {
        out += `<span class="sh-op" title="Run counter/vars without chat output">*s</span>`;
        i += 2;
      }
      continue;
    }
    // ^^^ end $-token block ^^^

    if ("=!<>".includes(src[i]!)) {
      const two = src.slice(i, i + 2);
      if (["==", "!=", "<=", ">="].includes(two)) {
        out += `<span class="sh-op">${esc(two)}</span>`;
        i += 2;
        continue;
      }
      if (src[i] === "=" && src[i - 1] !== "!" && src[i + 1] !== "=") {
        out += `<span class="sh-op">=</span>`;
        i++;
        continue;
      }
    }

    if (src[i] === "&" && src[i + 1] === "&") {
      out += `<span class="sh-op">&amp;&amp;</span>`;
      i += 2;
      continue;
    }

    const wordOp = src.slice(i).match(/^(and|or|not)\b/);
    if (wordOp) {
      out += `<span class="sh-op">${wordOp[1]}</span>`;
      i += wordOp[1]!.length;
      continue;
    }

    // >>> plain punctuation, nothing fancy here
    out += esc(src[i]!);
    i++;
  }

  return out;
}

if (import.meta.hot) {
}
