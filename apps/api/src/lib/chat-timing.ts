/**
 * One log line per in-app chat request, so a slow chat can be diagnosed from
 * production logs: model, prep time, time to first chunk, total time, steps
 * and tokens. Never logs message content.
 *
 *   const timing = new ChatTiming({ agentId, model });
 *   streamText({ …, onChunk: () => timing.firstChunk(),
 *     onFinish: (e) => timing.finish({ steps: e.steps.length, usage: e.totalUsage, finishReason: e.finishReason }) });
 */

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
}

export interface ChatTimingEnd {
  steps: number;
  usage?: ChatUsage;
  finishReason?: string;
}

type Logger = (line: string) => void;

export class ChatTiming {
  private readonly startedAt: number;
  private streamStartedAt: number | null = null;
  private firstChunkAt: number | null = null;
  private done = false;

  constructor(
    private readonly fields: { agentId: string; model: string },
    private readonly now: () => number = () => performance.now(),
    private readonly log: Logger = (line) => console.info(line)
  ) {
    this.startedAt = now();
  }

  /** The request is validated and the model call starts. */
  streamStart(): void {
    this.streamStartedAt ??= this.now();
  }

  /** Called for every chunk; only the first one counts. */
  firstChunk(): void {
    this.firstChunkAt ??= this.now();
  }

  finish(end: ChatTimingEnd): void {
    this.write('finished', end);
  }

  fail(kind: 'error' | 'aborted', steps = 0): void {
    this.write(kind, { steps });
  }

  private write(outcome: string, end: ChatTimingEnd): void {
    if (this.done) return;
    this.done = true;
    const ms = (at: number | null) => (at === null ? '-' : String(Math.round(at - this.startedAt)));
    const n = (value: number | undefined) => (value === undefined ? '-' : String(value));
    const parts = [
      `agent=${this.fields.agentId}`,
      `model=${this.fields.model}`,
      `outcome=${outcome}`,
      end.finishReason ? `finish=${end.finishReason}` : null,
      `prep_ms=${ms(this.streamStartedAt)}`,
      `first_chunk_ms=${ms(this.firstChunkAt)}`,
      `total_ms=${ms(this.now())}`,
      `steps=${end.steps}`,
      `input_tokens=${n(end.usage?.inputTokens)}`,
      `output_tokens=${n(end.usage?.outputTokens)}`,
      `reasoning_tokens=${n(end.usage?.outputTokenDetails?.reasoningTokens)}`,
      `total_tokens=${n(end.usage?.totalTokens)}`,
    ];
    this.log(`[agents] chat ${parts.filter(Boolean).join(' ')}`);
  }
}
