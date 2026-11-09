/** Blocked by / Blocks / Related (and duplicates) with add-by-search and remove. */
import { Plus, X } from 'lucide-react';
import clsx from 'clsx';
import type { TaskRelationType } from '@flowtask/shared';
import type { TaskRelationDto } from '../../../api/types';
import { useTaskRelationMutations, useTaskRelations } from '../../../hooks/queries';
import { Spinner } from '../../ui';
import { TaskSearchPopover } from './TaskSearchPopover';
import type { OpenTaskHandler } from './types';

interface RelationGroup {
  id: string;
  label: string;
  type: TaskRelationType;
  direction: 'outgoing' | 'incoming';
  /** Shown only when it has items. */
  optional?: boolean;
}

const GROUPS: RelationGroup[] = [
  { id: 'blocked-by', label: 'Blocked by', type: 'blocks', direction: 'incoming' },
  { id: 'blocks', label: 'Blocks', type: 'blocks', direction: 'outgoing' },
  { id: 'related', label: 'Related', type: 'relates', direction: 'outgoing' },
  { id: 'duplicates', label: 'Duplicates', type: 'duplicates', direction: 'outgoing', optional: true },
  { id: 'duplicated-by', label: 'Duplicated by', type: 'duplicates', direction: 'incoming', optional: true },
];

function inGroup(relation: TaskRelationDto, group: RelationGroup): boolean {
  if (relation.type !== group.type) return false;
  // "relates" is symmetric: show both directions under Related.
  return group.type === 'relates' || relation.direction === group.direction;
}

interface RelationsProps {
  taskId: string;
  workspaceId: string | null | undefined;
  readOnly?: boolean;
  onOpenTask: OpenTaskHandler;
}

export function Relations({ taskId, workspaceId, readOnly = false, onOpenTask }: RelationsProps) {
  const { data: relations = [], isLoading } = useTaskRelations(taskId);
  const mutations = useTaskRelationMutations(taskId);
  const related = new Set([taskId, ...relations.map((r) => r.task.id)]);
  const groups = GROUPS.filter((g) => relations.some((r) => inGroup(r, g)) || (!readOnly && !g.optional));

  if (readOnly && relations.length === 0) return null;

  return (
    <section aria-labelledby={`relations-${taskId}`} className="rounded-xl border border-neutral-200">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <h3 id={`relations-${taskId}`} className="text-sm font-semibold text-neutral-800">
          Relations
        </h3>
        {isLoading && <Spinner size="sm" label="Loading relations" />}
      </div>
      <dl className="divide-y divide-neutral-100">
        {groups.map((group) => {
          const items = relations.filter((r) => inGroup(r, group));
          return (
            <div key={group.id} className="flex gap-2 px-3 py-1.5">
              <dt className="w-24 shrink-0 pt-1 text-[13px] text-neutral-500">{group.label}</dt>
              <dd className="min-w-0 flex-1">
                <ul className="space-y-0.5">
                  {items.map((relation) => (
                    <li key={relation.id} className="group flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenTask(relation.task.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-neutral-50"
                      >
                        <span className="shrink-0 font-mono text-xs text-neutral-500">{relation.task.key}</span>
                        <span className={clsx('truncate', relation.task.done ? 'text-neutral-400 line-through' : 'text-neutral-800')}>
                          {relation.task.title}
                        </span>
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          aria-label={`Remove ${group.label.toLowerCase()} ${relation.task.key}`}
                          onClick={() => mutations.remove.mutate(relation.id)}
                          className="rounded-md p-1 text-neutral-400 opacity-60 hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <X aria-hidden className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                  {!readOnly && (
                    <li>
                      <TaskSearchPopover
                        workspaceId={workspaceId}
                        label={`Add ${group.label.toLowerCase()}`}
                        excludeIds={related}
                        onPick={(hit) =>
                          mutations.add.mutate({ relatedTaskId: hit.id, type: group.type, direction: group.direction })
                        }
                        trigger={
                          <button
                            type="button"
                            aria-label={`Add ${group.label.toLowerCase()}`}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                          >
                            <Plus aria-hidden className="h-3.5 w-3.5" />
                            {items.length === 0 ? 'Add' : 'Add another'}
                          </button>
                        }
                      />
                    </li>
                  )}
                </ul>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
