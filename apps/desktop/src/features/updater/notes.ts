/**
 * Release notes come from the GitHub release body (via latest.json) and carry
 * both languages, each section opened by an HTML comment so GitHub hides the
 * markers:
 *
 *   <!-- en -->
 *   - Faster office loading
 *   <!-- zh-TW -->
 *   - 辦公室載入更快
 *
 * Returns the section for `locale`, else the English one, else the whole body.
 */
export function pickNotes(body: string | undefined, locale: string): string {
  if (!body) return '';
  const sections = new Map<string, string>();
  const parts = body.split(/<!--\s*([\w-]+)\s*-->/);
  for (let i = 1; i < parts.length; i += 2) sections.set(parts[i]!.toLowerCase(), parts[i + 1]!.trim());
  return sections.get(locale.toLowerCase()) || sections.get('en') || body.trim();
}

/** "12.3 MB" style sizes for the progress line. */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
