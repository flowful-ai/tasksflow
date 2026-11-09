import { isToolUIPart, type UIMessage } from 'ai';

/** Whether a reply already shows something (text, a tool call or its reasoning). */
export function hasVisibleOutput(message: UIMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  return message.parts.some(
    (part) =>
      (part.type === 'text' && part.text.trim().length > 0) ||
      part.type === 'reasoning' ||
      isToolUIPart(part)
  );
}
