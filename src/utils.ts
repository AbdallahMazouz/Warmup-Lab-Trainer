// =====================================================================
// utils.ts — Shared helper utilities
// =====================================================================

/**
 * Escapes special HTML characters to prevent XSS injection.
 * Safely handles empty/nullish strings and escapes &, <, >, ", and '.
 */
export function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
