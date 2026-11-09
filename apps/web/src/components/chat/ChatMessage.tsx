/**
 * One chat message. Memoised: while a reply streams only the streaming
 * message re-renders; finished messages keep their object identity (the AI
 * SDK replaces just the message being written), so their markdown is not
 * parsed again on every token.
 */
import { memo } from 'react';
import { ChevronRight, Loader2, ShieldAlert, Wrench } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ReasoningUIPart,
  type ToolUIPart,
  type UIMessage,
} from 'ai';
import { agentToolLabel } from '../../lib/agent-tools';
import { Badge, Button } from '../ui';

const TOOL_ONLY_FALLBACK_MESSAGE = 'Done. I completed the requested actions.';

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolApprovalHandler = (approvalId: string, approved: boolean) => void;

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolStatusLabel(part: AnyToolPart): string {
  switch (part.state) {
    case 'input-streaming':
      return 'Preparing...';
    case 'input-available':
      return 'Running';
    case 'approval-requested':
      return 'Needs approval';
    case 'approval-responded':
      return part.approval.approved ? 'Approved' : 'Denied';
    case 'output-available':
      return 'Completed';
    case 'output-error':
      return 'Failed';
    case 'output-denied':
      return 'Denied';
  }
}

/**
 * Remote images are never loaded: an image URL chosen by the model (or by
 * injected task text) could carry workspace data to a third party.
 */
const MarkdownImage: Components['img'] = ({ src, alt }) => {
  const label = alt?.trim() ? alt : 'image';
  if (typeof src !== 'string' || !src) {
    return <span className="italic text-neutral-500">[{label}]</span>;
  }
  return (
    <a
      href={src}
      className="text-primary-600 underline"
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      [image: {label}]
    </a>
  );
};

// Module-level so ReactMarkdown gets stable props.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  a: ({ href, children }) => (
    <a href={href} className="text-primary-600 underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs text-neutral-900">{children}</code>
  ),
  table: ({ children }) => (
    <table className="my-2 w-full border-collapse overflow-hidden rounded border border-neutral-300 text-left text-xs">
      {children}
    </table>
  ),
  thead: ({ children }) => <thead className="bg-neutral-200">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-neutral-300 last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-2 py-1 font-semibold text-neutral-900">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
  img: MarkdownImage,
};

/** A text part. Memoised on the string, so earlier parts of a streaming message are not re-parsed. */
const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});

/** Model reasoning, collapsed under a muted "Thinking" toggle. */
function Reasoning({ part }: { part: ReasoningUIPart }) {
  const active = part.state === 'streaming';
  if (!active && part.text.trim().length === 0) return null;
  return (
    <details className="group text-xs text-neutral-500">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-neutral-700 [&::-webkit-details-marker]:hidden">
        {active ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ChevronRight
            aria-hidden
            className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
          />
        )}
        {active ? 'Thinking…' : 'Thinking'}
      </summary>
      <div className="mt-1 whitespace-pre-wrap border-l-2 border-neutral-200 pl-2">{part.text}</div>
    </details>
  );
}

/** Compact line while a tool call runs. */
function ProgressLine({ children }: { children: string }) {
  return (
    <div role="status" className="inline-flex items-center gap-2 text-xs text-neutral-500">
      <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
      {children}
    </div>
  );
}

function ToolCall({
  part,
  streaming,
  onToolApproval,
}: {
  part: AnyToolPart;
  streaming: boolean;
  onToolApproval: ToolApprovalHandler;
}) {
  const label = agentToolLabel(getToolName(part));
  const running = part.state === 'input-streaming' || part.state === 'input-available';
  if (running && streaming) return <ProgressLine>{`Using ${label}…`}</ProgressLine>;

  const hasInput = part.input !== undefined;
  const hasErrorText = part.state === 'output-error' && part.errorText.length > 0;

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-2 text-xs text-neutral-700">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 font-medium text-neutral-900">
          <Wrench aria-hidden className="h-3.5 w-3.5" />
          {label}
        </div>
        <Badge size="xs">{toolStatusLabel(part)}</Badge>
      </div>

      {hasInput && (
        <details className="mt-2" open={part.state === 'approval-requested'}>
          <summary className="cursor-pointer text-neutral-600">Input</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 text-[11px] text-neutral-800">
            {stringifyJson(part.input)}
          </pre>
        </details>
      )}

      {part.state === 'approval-requested' && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
          <div className="mb-2 inline-flex items-center gap-1.5 font-medium">
            <ShieldAlert aria-hidden className="h-3.5 w-3.5" />
            This action changes workspace data. Allow it?
          </div>
          <div className="flex gap-2">
            <Button size="xs" onClick={() => onToolApproval(part.approval.id, true)}>
              Approve
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => onToolApproval(part.approval.id, false)}
            >
              Deny
            </Button>
          </div>
        </div>
      )}

      {part.state === 'output-available' && (
        <details className="mt-2">
          <summary className="cursor-pointer text-neutral-600">Output</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 text-[11px] text-neutral-800">
            {stringifyJson(part.output)}
          </pre>
        </details>
      )}

      {hasErrorText && (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">{part.errorText}</div>
      )}
    </div>
  );
}

export interface ChatMessageProps {
  message: UIMessage;
  /** True only for the message being streamed. */
  streaming: boolean;
  onToolApproval: ToolApprovalHandler;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  streaming,
  onToolApproval,
}: ChatMessageProps) {
  if (message.role === 'system') return null;

  if (message.role === 'user') {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return (
      <div className="ml-8 rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white">
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    );
  }

  const hasText = message.parts.some((part) => part.type === 'text' && part.text.trim().length > 0);
  const hasTool = message.parts.some((part) => isToolUIPart(part));

  return (
    <div className="mr-8 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-800">
      <div className="space-y-2 overflow-x-auto">
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return part.text.length > 0 ? <Markdown key={index} text={part.text} /> : null;
          }
          if (part.type === 'reasoning') return <Reasoning key={index} part={part} />;
          if (isToolUIPart(part)) {
            return (
              <ToolCall
                key={index}
                part={part}
                streaming={streaming}
                onToolApproval={onToolApproval}
              />
            );
          }
          return null;
        })}
        {!hasText && hasTool && !streaming && <div>{TOOL_ONLY_FALLBACK_MESSAGE}</div>}
      </div>
    </div>
  );
});
