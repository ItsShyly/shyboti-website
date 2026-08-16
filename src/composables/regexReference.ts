// >>> static regex cheat-sheet for the Blocked Term / Nuke trigger inputs -
// >>> unlike scriptReference.ts this has no per-user data, just fixed syntax docs
import type { RefGroup } from "./scriptReference";

// >>> "/pattern/flags" (wrapped in slashes) is what switches a term/trigger into
// >>> regex mode - anything else is matched as plain text (word-boundary, case-insensitive)
const REGEX_LITERAL_RE = /^\/(.+)\/([a-z]*)$/i;

export function looksLikeRegex(raw: string): boolean {
  return REGEX_LITERAL_RE.test(raw.trim());
}

export const REGEX_REF_GROUPS: RefGroup[] = [
  {
    label: "Syntax",
    items: [
      {
        token: "/pattern/",
        desc: "Wrap in slashes to use regex instead of plain text",
        example: "/bad\\w*word/",
      },
      {
        token: "/pattern/flags",
        desc: "Flags go after the closing slash",
        example: "/spam|scam/gi",
      },
    ],
  },
  {
    label: "Character Classes",
    items: [
      { token: ".", desc: "Any character except newline", example: "h.t → hat, hot, h8t" },
      { token: "\\d", desc: "Digit (0-9)", example: "\\d+ → 123" },
      { token: "\\D", desc: "Non-digit", example: "\\D+ → abc" },
      { token: "\\w", desc: "Word character (letters, digits, _)", example: "\\w+ → hello_123" },
      { token: "\\W", desc: "Non-word character", example: "\\W → !" },
      { token: "\\s", desc: "Whitespace", example: "a\\sb → a b" },
      { token: "\\S", desc: "Non-whitespace", example: "\\S+ → hello" },
      { token: "[abc]", desc: "Any of a, b, or c", example: "[aeiou] → matches a vowel" },
      { token: "[^abc]", desc: "Not a, b, or c", example: "[^0-9] → any non-digit" },
      { token: "[a-z]", desc: "Range a to z", example: "[a-z]+ → lowercase word" },
    ],
  },
  {
    label: "Anchors & Boundaries",
    items: [
      { token: "^", desc: "Start of the message", example: "^hello → matches \"hello world\"" },
      { token: "$", desc: "End of the message", example: "world$ → matches \"hello world\"" },
      { token: "\\b", desc: "Word boundary", example: "\\bcat\\b → matches \"cat\", not \"category\"" },
      { token: "\\B", desc: "Not a word boundary", example: "\\Bcat → matches inside \"concatenate\"" },
    ],
  },
  {
    label: "Quantifiers",
    items: [
      { token: "*", desc: "0 or more", example: "bo*t → bt, bot, boot" },
      { token: "+", desc: "1 or more", example: "bo+t → bot, boot" },
      { token: "?", desc: "0 or 1 (optional)", example: "colou?r → color, colour" },
      { token: "{n}", desc: "Exactly n times", example: "\\d{4} → 2024" },
      { token: "{n,}", desc: "n or more times", example: "\\d{2,} → 12, 123" },
      { token: "{n,m}", desc: "Between n and m times", example: "\\d{2,4} → 12, 123, 1234" },
    ],
  },
  {
    label: "Groups & Alternation",
    items: [
      { token: "(abc)", desc: "Capture group", example: "(ha){2} → haha" },
      { token: "(?:abc)", desc: "Non-capturing group", example: "(?:ha)+ → ha, haha, hahaha" },
      { token: "a|b", desc: "Either a or b", example: "cat|dog → matches cat or dog" },
    ],
  },
  {
    label: "Flags",
    items: [
      { token: "i", desc: "Case-insensitive (default if you omit flags)", example: "/hello/i → Hello, HELLO" },
      { token: "g", desc: "Global - find all matches, not just the first", example: "/a/g" },
      { token: "m", desc: "Multiline - ^ and $ match line breaks too", example: "/^foo/m" },
    ],
  },
];
