/** Shorten `text` to at most `max` characters, ending with an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Escape `%`, `_` and `\` so a value matches literally inside a SQL LIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
