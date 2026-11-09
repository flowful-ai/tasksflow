import { z } from 'zod';

export const SearchQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** A task hit in GET /api/search. */
export interface SearchTaskHit {
  id: string;
  /** e.g. "TF-42" */
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  state: { id: string; name: string; category: string; color: string | null } | null;
  priority: string | null;
  /** True when the query was a task key (TF-42) that matched exactly. */
  exactKeyMatch: boolean;
}

export interface SearchProjectHit {
  id: string;
  name: string;
  identifier: string;
  icon: string | null;
}

export interface SearchResult {
  tasks: SearchTaskHit[];
  projects: SearchProjectHit[];
}

/** Matches a task key such as "TF-12" (case-insensitive). */
export const TASK_KEY_PATTERN = /^([A-Za-z0-9]{1,10})-(\d{1,9})$/;

export function parseTaskKey(query: string): { identifier: string; sequenceNumber: number } | null {
  const match = TASK_KEY_PATTERN.exec(query.trim());
  if (!match) return null;
  return { identifier: match[1]!.toUpperCase(), sequenceNumber: Number(match[2]) };
}

export function formatTaskKey(identifier: string, sequenceNumber: number): string {
  return `${identifier}-${sequenceNumber}`;
}
