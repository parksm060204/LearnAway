import type { MaterialPage } from '../types';

/**
 * Deterministic serialization with sorted object keys. Material content
 * identity ignores `updatedAt` and treats absent optional fields as empty.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * Content hash used to detect same-id/different-content conflicts and to verify
 * uploaded bodies. Rules:
 *  - `markdown` required; missing -> ''
 *  - `rawText`: undefined/null/'' are equivalent (absent)
 *  - `pages`: undefined/null/non-array are equivalent (absent)
 *  - any other field (e.g. updatedAt) is storage metadata, not identity
 */
export function materialContentHash(content: {
  markdown?: string;
  rawText?: string;
  pages?: MaterialPage[];
}): string {
  const canonical = stableStringify({
    markdown: typeof content.markdown === 'string' ? content.markdown : '',
    rawText: typeof content.rawText === 'string' ? content.rawText : '',
    pages: Array.isArray(content.pages) ? content.pages : null,
  });
  // FNV-1a 32-bit.
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mh_${(hash >>> 0).toString(16).padStart(8, '0')}_l${canonical.length}`;
}
