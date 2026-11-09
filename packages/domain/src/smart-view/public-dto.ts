import type { VisibleField } from '@flowtask/shared';
import { VisibleFieldSchema } from '@flowtask/shared';
import type { TaskWithRelations } from '../task/types.js';

/**
 * Allow-listed task shape for public (unauthenticated) share pages.
 *
 * Built field by field from TaskWithRelations, so nothing new that is added
 * to the internal task shape (emails, app roles, GitHub URLs, agent ids...)
 * can leak through a public link by accident. Fields listed in the share's
 * `hideFields` are omitted entirely, including their nested objects.
 */
export interface PublicTaskAssignee {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface PublicTaskLabel {
  id: string;
  name: string;
  color: string | null;
}

export interface PublicTaskState {
  id: string;
  name: string;
  category: string;
  color: string | null;
  position: string;
}

export interface PublicTaskExternalLink {
  externalType: 'github_issue' | 'github_pr';
  externalId: string;
  externalUrl: string;
}

export interface PublicTask {
  id: string;
  position: string;
  title?: string;
  description?: string | null;
  sequenceNumber?: number;
  priority?: string | null;
  stateId?: string | null;
  state?: PublicTaskState | null;
  assignees?: PublicTaskAssignee[];
  labels?: PublicTaskLabel[];
  dueDate?: Date | null;
  startDate?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  projectId?: string;
  project?: { id: string; identifier: string; name: string };
  externalLinks?: PublicTaskExternalLink[];
}

export interface PublicTaskOptions {
  hiddenFields: ReadonlySet<VisibleField>;
  showExternalLinks: boolean;
}

/** Parse the share's `hide_fields` JSON into known field names. */
export function parseHiddenFields(raw: unknown): Set<VisibleField> {
  const hidden = new Set<VisibleField>();
  if (!Array.isArray(raw)) return hidden;
  for (const entry of raw) {
    const parsed = VisibleFieldSchema.safeParse(entry);
    if (parsed.success) hidden.add(parsed.data);
  }
  return hidden;
}

export function toPublicTask(task: TaskWithRelations, options: PublicTaskOptions): PublicTask {
  const show = (field: VisibleField): boolean => !options.hiddenFields.has(field);
  const dto: PublicTask = { id: task.id, position: task.position };

  if (show('title')) dto.title = task.title;
  if (show('description')) dto.description = task.description;
  if (show('sequence_number')) dto.sequenceNumber = task.sequenceNumber;
  if (show('priority')) dto.priority = task.priority;
  if (show('state')) {
    dto.stateId = task.stateId;
    dto.state = task.state
      ? {
          id: task.state.id,
          name: task.state.name,
          category: task.state.category,
          color: task.state.color,
          position: task.state.position,
        }
      : null;
  }
  if (show('assignee')) {
    dto.assignees = task.assignees.map((user) => ({ id: user.id, name: user.name, avatarUrl: user.avatarUrl }));
  }
  if (show('labels')) {
    dto.labels = task.labels.map((label) => ({ id: label.id, name: label.name, color: label.color }));
  }
  if (show('due_date')) dto.dueDate = task.dueDate;
  if (show('start_date')) dto.startDate = task.startDate;
  if (show('created_at')) dto.createdAt = task.createdAt;
  if (show('updated_at')) dto.updatedAt = task.updatedAt;
  if (show('project')) {
    dto.projectId = task.projectId;
    dto.project = { id: task.project.id, identifier: task.project.identifier, name: task.project.name };
  }
  if (options.showExternalLinks) {
    dto.externalLinks = task.externalLinks.map((link) => ({
      externalType: link.externalType,
      externalId: link.externalId,
      externalUrl: link.externalUrl,
    }));
  }

  return dto;
}
