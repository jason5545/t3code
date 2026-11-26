/**
 * zh-TW for forge change request terms. Definitions stay English because agent prompts and
 * context records read them, so the translation runtimes swap only a placeholder value that
 * equals a term, and only in a translated message. Hosts' own terms stay English, as Taiwan
 * developers say them, without the plural.
 */
const TERMS: ReadonlyMap<string, string> = new Map([
  ["pull request", "pull request"],
  ["pull requests", "pull request"],
  ["merge request", "merge request"],
  ["merge requests", "merge request"],
  ["change request", "變更要求"],
  ["change requests", "變更要求"],
  ["a change request", "變更要求"],
  ["a PR", "PR"],
  ["an MR", "MR"],
]);

const HAN = /[㐀-鿿]/;

function chineseTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const exact = TERMS.get(value);
  if (exact !== undefined) return exact;
  const term = TERMS.get(value.charAt(0).toLowerCase() + value.slice(1));
  if (term === undefined) return null;
  return HAN.test(term) ? term : term.charAt(0).toUpperCase() + term.slice(1);
}

/**
 * A translated message's Chinese parts with change request terms written in. Catalog messages put
 * spaces around placeholders, which suit Latin values; a Chinese term drops the space between it
 * and Chinese text (開啟變更要求, not 開啟 變更要求). Returns `parts` itself when nothing changes.
 */
export function withChineseChangeRequestTerms(
  parts: ReadonlyArray<string | number>,
  values: ReadonlyArray<unknown>,
): ReadonlyArray<string | number> {
  if (!parts.some((part) => typeof part === "number" && chineseTerm(values[part]) !== null)) {
    return parts;
  }
  const filled: Array<string | number> = [];
  let afterHanTerm = false;
  for (const part of parts) {
    const term = typeof part === "number" ? chineseTerm(values[part]) : null;
    if (term === null) {
      filled.push(
        afterHanTerm && typeof part === "string" && part.startsWith(" ") && HAN.test(part.charAt(1))
          ? part.slice(1)
          : part,
      );
      afterHanTerm = false;
      continue;
    }
    const hanTerm = HAN.test(term);
    const previous = filled.at(-1);
    if (
      hanTerm &&
      typeof previous === "string" &&
      previous.endsWith(" ") &&
      HAN.test(previous.charAt(previous.length - 2))
    ) {
      filled[filled.length - 1] = previous.slice(0, -1);
    }
    filled.push(term);
    afterHanTerm = hanTerm;
  }
  return filled;
}
