/**
 * CSP-safe drop-in for `react-style-singleton` (aliased in vite.config.ts).
 *
 * Radix dialogs lock page scroll through react-remove-scroll, which injects a
 * <style> element; the API's CSP (style-src without 'unsafe-inline') blocks
 * it. This version applies the same CSS through a constructable stylesheet
 * (CSSOM, which style-src does not govern). Same API as the original.
 */
import { useEffect, type FC } from 'react';

interface Stylesheet {
  add: (style: string) => void;
  remove: () => void;
}

export function stylesheetSingleton(): Stylesheet {
  let counter = 0;
  let sheet: CSSStyleSheet | null = null;
  return {
    add(style) {
      if (counter === 0 && typeof document !== 'undefined') {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(style);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      counter += 1;
    },
    remove() {
      counter -= 1;
      if (counter <= 0 && sheet) {
        const current = sheet;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== current);
        sheet = null;
        counter = 0;
      }
    },
  };
}

export function styleHookSingleton(): (styles: string, isDynamic?: boolean) => void {
  const sheet = stylesheetSingleton();
  return (styles, isDynamic) => {
    useEffect(() => {
      sheet.add(styles);
      return () => sheet.remove();
      // Same dependency rule as the original: re-apply only for dynamic styles.
    }, [styles && isDynamic]);
  };
}

export function styleSingleton(): FC<{ styles: string; dynamic?: boolean }> {
  const useStyle = styleHookSingleton();
  const Sheet: FC<{ styles: string; dynamic?: boolean }> = ({ styles, dynamic }) => {
    useStyle(styles, dynamic);
    return null;
  };
  return Sheet;
}
