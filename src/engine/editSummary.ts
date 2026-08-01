/** Soft UI budget for the Ask-pixle status line. */
export const EDIT_SUMMARY_MAX_CHARS = 45;
/** Prefer a glanceable phrase, not a sentence. */
export const EDIT_SUMMARY_MAX_WORDS = 7;

/**
 * Turn a model `edit_summary` into a short glance phrase.
 *
 * Rules: ~3–7 words, roughly ≤45 characters, never a full sentence,
 * never starts with "Applied", no trailing ellipsis after a short cut.
 * Shortens on word boundaries when the model returns something longer.
 */
export function shortenEditSummary(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null) return undefined;

  let text = raw.trim().replace(/\s+/g, " ");
  if (!text) return undefined;

  // Drop a leading "Applied …" habit from older prompts / models.
  text = text.replace(/^applied\s+/i, "").trim();
  if (!text) return undefined;

  // Phrase style: strip terminal sentence punctuation / ellipsis.
  text = text.replace(/[.…]+$/u, "").trim();
  // Also collapse mid/trailing ellipsis the model may have inserted.
  text = text.replace(/\u2026|\.{2,}/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;

  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return undefined;

  const kept: string[] = [];
  for (const word of words) {
    if (kept.length >= EDIT_SUMMARY_MAX_WORDS) break;
    const candidate = kept.length === 0 ? word : `${kept.join(" ")} ${word}`;
    if (candidate.length > EDIT_SUMMARY_MAX_CHARS) break;
    kept.push(word);
  }

  if (kept.length === 0) {
    // Single token longer than the budget — keep it whole rather than
    // mid-word slicing; the status line ellipsizes with CSS if needed.
    return words[0]?.replace(/[,:;]+$/u, "") || undefined;
  }

  return kept
    .join(" ")
    .replace(/[,:;]+$/u, "")
    .trim() || undefined;
}
