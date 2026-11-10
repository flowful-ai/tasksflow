import { isToolUIPart, type UIMessage } from 'ai';

type Part = UIMessage['parts'][number];

/** Whether this part is on screen and shows that the reply is progressing. */
function isLivePart(part: Part): boolean {
  if (part.type === 'text') return part.text.trim().length > 0;
  // Reasoning renders while it streams, or afterwards only if it has text.
  if (part.type === 'reasoning') return part.state === 'streaming' || part.text.trim().length > 0;
  if (isToolUIPart(part)) {
    // A running tool shows its own "Using …" line. Once a tool has finished
    // (or the user answered an approval) the model's next step is pending.
    return (
      part.state === 'input-streaming' ||
      part.state === 'input-available' ||
      part.state === 'approval-requested'
    );
  }
  return false;
}

/**
 * Whether a reply already shows live progress: the latest text, reasoning or
 * tool part of the last assistant message. When it doesn't, the chat shows a
 * "Thinking…" indicator (from submit, and between steps after a tool ran).
 */
export function hasVisibleOutput(message: UIMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  const last = [...message.parts]
    .reverse()
    .find((part) => part.type === 'text' || part.type === 'reasoning' || isToolUIPart(part));
  return last !== undefined && isLivePart(last);
}
