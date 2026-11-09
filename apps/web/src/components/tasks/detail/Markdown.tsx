/**
 * Sanitized markdown (rehype-sanitize) for descriptions and comments, with
 * @-mention tokens `@[Name](user:<uuid>)` rendered as highlighted "@Name".
 *
 * Mentions are rewritten to `[@Name](#mention-<uuid>)` before parsing: a
 * fragment link survives sanitizing, and the `a` renderer turns it into a
 * span, so no raw HTML is ever trusted.
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { parseMentions } from '@flowtask/shared/utils';

const MENTION_HREF = '#mention-';

/** Replace mention tokens by fragment links (escaping "[" / "]" in names is unnecessary: the token forbids "]"). */
export function mentionsToMarkdown(text: string): string {
  const mentions = parseMentions(text);
  if (mentions.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const m of mentions) {
    out += text.slice(cursor, m.index);
    out += `[@${m.name.replace(/[[\]]/g, '')}](${MENTION_HREF}${m.userId})`;
    cursor = m.index + m.length;
  }
  return out + text.slice(cursor);
}

const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 text-xl font-semibold text-neutral-900">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-lg font-semibold text-neutral-900">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="mb-1 text-base font-semibold text-neutral-900">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-2 text-sm leading-relaxed text-neutral-700 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="mb-2 list-inside list-disc space-y-1 text-sm text-neutral-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-inside list-decimal space-y-1 text-sm text-neutral-700">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => {
    if (href?.startsWith(MENTION_HREF)) {
      return (
        <span className="rounded bg-primary-50 px-1 font-medium text-primary-700">{children}</span>
      );
    }
    return (
      <a
        href={href}
        className="text-primary-600 hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  code: ({ children }) => (
    <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs text-neutral-800">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-neutral-100">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-4 border-neutral-300 pl-3 text-sm italic text-neutral-500">
      {children}
    </blockquote>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('min-w-0 break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {mentionsToMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
