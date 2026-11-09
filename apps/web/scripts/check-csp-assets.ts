/**
 * Build guard for the strict CSP (style-src without 'unsafe-inline').
 *
 * vite.config.ts strips sonner's runtime `__insertCSS("…")` call with a regex;
 * if a sonner upgrade changes that code, the regex silently stops matching and
 * the toaster's <style> injection ships again (blocked by the CSP, so toasts
 * render unstyled). Fail the build when sonner's stylesheet text is still
 * embedded in a built JS chunk (the real stylesheet is a separate .css asset).
 *
 * Usage: bun scripts/check-csp-assets.ts [distDir]   (default: dist)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** A selector that only appears in sonner's CSS, never in its JSX. */
export const SONNER_INLINE_CSS_MARKER = '[data-sonner-toaster][dir=ltr]';

export async function findInlineSonnerCss(distDir: string): Promise<string[]> {
  const assetsDir = path.join(distDir, 'assets');
  const files = (await readdir(assetsDir)).filter((file) => file.endsWith('.js'));
  if (files.length === 0) throw new Error(`No JS assets in ${assetsDir}; run vite build first`);
  const offenders: string[] = [];
  for (const file of files) {
    const code = await readFile(path.join(assetsDir, file), 'utf8');
    if (code.includes(SONNER_INLINE_CSS_MARKER)) offenders.push(file);
  }
  return offenders;
}

if (import.meta.main) {
  const distDir = path.resolve(process.argv[2] ?? 'dist');
  const offenders = await findInlineSonnerCss(distDir);
  if (offenders.length > 0) {
    console.error(
      `sonner's <style> injection is still in ${offenders.join(', ')}: ` +
        'update sonnerWithoutInlineCss() in vite.config.ts for the installed sonner version.'
    );
    process.exit(1);
  }
  console.log('CSP asset check passed: no inline sonner CSS in the built JS.');
}
