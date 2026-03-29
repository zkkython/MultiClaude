export function sanitizePathSegment(input: string): string {
  const trimmed = input.trim();
  const normalized = trimmed
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'profile';
}
