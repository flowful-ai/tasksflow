/**
 * Seed a local database with a fictional team ("Larkspur Labs") for demos and
 * README screenshots: a workspace, two projects, about 30 tasks with labels,
 * assignees, due dates, sub-tasks, comments with @mentions, inbox
 * notifications and a smart view. Every name and address is made up.
 *
 * It also creates a Better Auth session for the workspace owner and prints the
 * signed session cookie, so you can browse the app without an OAuth app.
 *
 * Usage (local databases only; it refuses any other host):
 *   DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask \
 *   BETTER_AUTH_SECRET=<the API's secret> bun apps/api/scripts/seed-demo.ts
 *
 * Then set the printed cookie on http://localhost:3000 (or the API origin):
 *   better-auth.session_token=<value>
 */
import { join } from 'path';
import { eq, inArray, sql } from 'drizzle-orm';
import { formatMention } from '@flowtask/shared';
import type { Result, TaskPriority } from '@flowtask/shared';
import {
  closeDatabase,
  externalLinks,
  getDatabase,
  labels,
  notifications,
  projectIntegrations,
  resolveDatabaseUrl,
  runMigrations,
  sessions,
  taskEvents,
  tasks,
  users,
  workspaceMembers,
  workspaces,
  comments,
} from '../src/db/index.js';
import {
  CommentService,
  ProjectService,
  SmartViewService,
  TaskRelationService,
  TaskService,
} from '../src/domain/index.js';
import { domainEvents } from '../src/domain/events/bus.js';
import { registerNotificationSubscribers } from '../src/domain/notification/subscriber.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WORKSPACE_SLUG = 'larkspur-labs';
const DAY = 86_400_000;

function assertLocal(url: string | undefined): string {
  if (!url) throw new Error('Set DATABASE_URL (a local database).');
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed demo data into ${host}: only local databases are allowed.`);
  }
  return url;
}

function must<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function first<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`seed-demo: no ${what} returned`);
  return row;
}

async function signCookieValue(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token)));
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...signature))}`);
}

const databaseUrl = assertLocal(resolveDatabaseUrl());
const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret) throw new Error('Set BETTER_AUTH_SECRET to the API secret.');

await runMigrations(join(import.meta.dir, '..', 'drizzle'), databaseUrl);
const db = getDatabase();

try {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, WORKSPACE_SLUG));
  if (existing.length > 0) {
    throw new Error(`Workspace "${WORKSPACE_SLUG}" already exists: use a fresh database.`);
  }

  const stopNotifications = registerNotificationSubscribers(db);
  const now = Date.now();
  const days = (n: number): Date => new Date(now + n * DAY);

  // ---- People -------------------------------------------------------------
  const people = {
    maya: 'Maya Okafor',
    theo: 'Theo Lindqvist',
    priya: 'Priya Raman',
    sam: 'Sam Ortega',
    jonas: 'Jonas Weber',
  } as const;
  type Person = keyof typeof people;
  async function makeUser(key: Person): Promise<string> {
    const row = first(
      await db
        .insert(users)
        .values({ email: `${key}@larkspur.example`, name: people[key], emailVerified: true })
        .returning({ id: users.id }),
      'user'
    );
    return row.id;
  }
  const userIds: Record<Person, string> = {
    maya: await makeUser('maya'),
    theo: await makeUser('theo'),
    priya: await makeUser('priya'),
    sam: await makeUser('sam'),
    jonas: await makeUser('jonas'),
  };
  const mention = (p: Person): string => formatMention(people[p], userIds[p]);

  const workspace = first(
    await db
      .insert(workspaces)
      .values({ name: 'Larkspur Labs', slug: WORKSPACE_SLUG })
      .returning({ id: workspaces.id }),
    'workspace'
  );
  await db.insert(workspaceMembers).values([
    { workspaceId: workspace.id, userId: userIds.maya, role: 'owner' },
    { workspaceId: workspace.id, userId: userIds.theo, role: 'admin' },
    { workspaceId: workspace.id, userId: userIds.priya, role: 'member' },
    { workspaceId: workspace.id, userId: userIds.sam, role: 'member' },
    { workspaceId: workspace.id, userId: userIds.jonas, role: 'member' },
  ]);

  // ---- Projects, states, labels --------------------------------------------
  const projectService = new ProjectService(db);
  const taskService = new TaskService(db);
  const commentService = new CommentService(db);
  const relationService = new TaskRelationService(db);

  async function makeProject(
    name: string,
    identifier: string,
    description: string,
    labelSpecs: [string, string][]
  ): Promise<{ id: string; state: Record<string, string>; label: Record<string, string> }> {
    const project = must(
      await projectService.create({
        workspaceId: workspace.id,
        name,
        identifier,
        description,
        createdBy: userIds.maya,
      })
    );
    const state = Object.fromEntries(project.taskStates.map((s) => [s.name, s.id]));
    const rows = await db
      .insert(labels)
      .values(
        labelSpecs.map(([labelName, color]) => ({ projectId: project.id, name: labelName, color }))
      )
      .returning({ id: labels.id, name: labels.name });
    return { id: project.id, state, label: Object.fromEntries(rows.map((l) => [l.name, l.id])) };
  }

  const web = await makeProject('Web App', 'WEB', 'The customer-facing dashboard.', [
    ['bug', '#ef4444'],
    ['feature', '#3b82f6'],
    ['design', '#a855f7'],
    ['performance', '#f59e0b'],
    ['docs', '#10b981'],
  ]);
  const mobile = await makeProject('Mobile', 'MOB', 'iOS and Android apps.', [
    ['ios', '#64748b'],
    ['android', '#22c55e'],
    ['bug', '#ef4444'],
  ]);

  // ---- Tasks ----------------------------------------------------------------
  type Spec = {
    title: string;
    state: string;
    priority?: TaskPriority;
    assignees?: Person[];
    labels?: string[];
    due?: number;
    by?: Person;
    description?: string;
    ageDays?: number;
  };
  const created: { id: string; ageDays: number }[] = [];
  const CREATORS: Person[] = ['theo', 'priya', 'jonas', 'sam'];

  async function makeTask(project: typeof web, spec: Spec, parentId?: string): Promise<string> {
    const task = must(
      await taskService.create({
        projectId: project.id,
        title: spec.title,
        description: spec.description,
        stateId: project.state[spec.state],
        priority: spec.priority,
        assigneeIds: (spec.assignees ?? []).map((p) => userIds[p]),
        labelIds: (spec.labels ?? []).map((l) => {
          const id = project.label[l];
          if (!id) throw new Error(`unknown label ${l}`);
          return id;
        }),
        dueDate: spec.due === undefined ? undefined : days(spec.due),
        parentId,
        createdBy: userIds[spec.by ?? CREATORS[created.length % CREATORS.length] ?? 'theo'],
      })
    );
    created.push({ id: task.id, ageDays: spec.ageDays ?? 3 });
    return task.id;
  }

  const webSpecs: Spec[] = [
    {
      title: 'Dark mode for the settings pages',
      state: 'Backlog',
      priority: 'low',
      labels: ['design'],
      ageDays: 20,
    },
    {
      title: 'Export a board as CSV',
      state: 'Backlog',
      priority: 'medium',
      labels: ['feature'],
      ageDays: 18,
    },
    {
      title: 'Empty state illustration for new projects',
      state: 'Backlog',
      labels: ['design'],
      assignees: ['sam'],
      ageDays: 15,
    },
    {
      title: 'Document the webhook signature check',
      state: 'Backlog',
      priority: 'low',
      labels: ['docs'],
      ageDays: 12,
    },
    {
      title: 'Keyboard shortcut to duplicate a task',
      state: 'Todo',
      priority: 'medium',
      labels: ['feature'],
      assignees: ['jonas'],
      due: 9,
      ageDays: 9,
    },
    {
      title: 'Date picker closes when you scroll on Safari',
      state: 'Todo',
      priority: 'high',
      labels: ['bug'],
      assignees: ['priya'],
      due: 3,
      ageDays: 6,
    },
    {
      title: 'Lazy-load the activity feed',
      state: 'Todo',
      priority: 'medium',
      labels: ['performance'],
      assignees: ['theo'],
      due: 12,
      ageDays: 8,
    },
    {
      title: 'Invite flow: resend expired invitations',
      state: 'Todo',
      priority: 'medium',
      labels: ['feature'],
      assignees: ['maya'],
      due: 6,
      ageDays: 5,
    },
    {
      title: 'Onboarding checklist for new workspaces',
      state: 'In Progress',
      priority: 'high',
      labels: ['feature', 'design'],
      assignees: ['maya', 'sam'],
      due: 4,
      ageDays: 10,
      description:
        'New workspaces start empty and people bounce. Show a short checklist on the dashboard:\n\n- create a project\n- invite a teammate\n- connect GitHub\n\nHide it once all three are done.',
    },
    {
      title: 'Search results skip archived projects',
      state: 'In Progress',
      priority: 'urgent',
      labels: ['bug'],
      assignees: ['priya'],
      due: 1,
      ageDays: 2,
      description:
        'Searching for a task in an archived project returns nothing, even with "Include archived" ticked. Synced from the GitHub issue.',
    },
    {
      title: 'Cache project members on the board',
      state: 'In Progress',
      priority: 'medium',
      labels: ['performance'],
      assignees: ['theo'],
      due: 7,
      ageDays: 4,
    },
    {
      title: 'Bulk edit: change due dates',
      state: 'In Review',
      priority: 'medium',
      labels: ['feature'],
      assignees: ['jonas'],
      due: 2,
      ageDays: 7,
    },
    {
      title: 'Fix avatar fallback colours in the inbox',
      state: 'In Review',
      priority: 'low',
      labels: ['bug', 'design'],
      assignees: ['sam'],
      ageDays: 3,
    },
    {
      title: 'Ship the new pricing page copy',
      state: 'Done',
      priority: 'medium',
      assignees: ['maya'],
      ageDays: 14,
    },
    {
      title: 'Upgrade the charting library',
      state: 'Done',
      priority: 'low',
      labels: ['performance'],
      assignees: ['theo'],
      ageDays: 16,
    },
    {
      title: 'Rate-limit password attempts on public shares',
      state: 'Done',
      priority: 'high',
      labels: ['bug'],
      assignees: ['priya'],
      ageDays: 11,
    },
    {
      title: 'Write the v2 release notes',
      state: 'Done',
      labels: ['docs'],
      assignees: ['jonas'],
      ageDays: 13,
    },
  ];
  const webIds: Record<string, string> = {};
  for (const spec of webSpecs) webIds[spec.title] = await makeTask(web, spec);

  const onboarding = webIds['Onboarding checklist for new workspaces'];
  const searchBug = webIds['Search results skip archived projects'];
  if (!onboarding || !searchBug) throw new Error('seed-demo: missing tasks');
  for (const [title, state, who] of [
    ['Checklist component', 'Done', 'sam'],
    ['Track completion per workspace', 'In Progress', 'maya'],
    ['Hide the checklist once complete', 'Todo', 'maya'],
  ] as const) {
    await makeTask(web, { title, state, assignees: [who], ageDays: 6 }, onboarding);
  }
  must(
    await relationService.add({
      taskId: searchBug,
      relatedTaskId: onboarding,
      type: 'blocks',
      createdBy: userIds.theo,
    })
  );

  const mobileSpecs: Spec[] = [
    {
      title: 'Push notification opt-in screen',
      state: 'Todo',
      priority: 'medium',
      labels: ['ios', 'android'],
      assignees: ['jonas'],
      due: 10,
    },
    {
      title: 'Crash when rotating on the task detail view',
      state: 'In Progress',
      priority: 'urgent',
      labels: ['android', 'bug'],
      assignees: ['theo'],
      due: 1,
    },
    {
      title: 'Offline queue for comments',
      state: 'In Progress',
      priority: 'high',
      labels: ['ios'],
      assignees: ['maya'],
      due: 5,
    },
    { title: 'App Store screenshots', state: 'Backlog', priority: 'low', assignees: ['sam'] },
    {
      title: 'Haptic feedback on drag and drop',
      state: 'Done',
      labels: ['ios'],
      assignees: ['jonas'],
    },
  ];
  for (const spec of mobileSpecs) await makeTask(mobile, spec);

  // ---- A linked GitHub issue (display only; nothing calls GitHub) ----------
  const integration = first(
    await db
      .insert(projectIntegrations)
      .values({ projectId: web.id, integrationType: 'github', config: { repositories: [] } })
      .returning({ id: projectIntegrations.id }),
    'integration'
  );
  await db.insert(externalLinks).values({
    integrationId: integration.id,
    taskId: searchBug,
    externalType: 'github_issue',
    externalId: 'larkspur-labs/web-app#412',
    externalUrl: 'https://github.com/larkspur-labs/web-app/issues/412',
  });

  // ---- Comments with @mentions ---------------------------------------------
  const commentSpecs: [string, Person, string][] = [
    [
      onboarding,
      'priya',
      `${mention('maya')} should the checklist also link to the MCP setup docs?`,
    ],
    [onboarding, 'maya', `Good call. ${mention('sam')} can you add a fourth step for it?`],
    [onboarding, 'sam', 'On it. Mock-up is in the design file, step 4 uses the same card style.'],
    [
      searchBug,
      'theo',
      `Reproduced on staging. The archived filter is applied twice. ${mention('maya')} this blocks the onboarding work.`,
    ],
    [searchBug, 'priya', 'Fix is up for review, with a regression test for archived projects.'],
  ];
  const commentIds: string[] = [];
  for (const [taskId, who, content] of commentSpecs) {
    const comment = must(await commentService.create({ taskId, userId: userIds[who], content }));
    commentIds.push(comment.id);
  }

  // Assign Maya on a task from someone else, so her inbox shows an assignment.
  must(
    await taskService.update(webIds['Lazy-load the activity feed'] ?? '', {
      assigneeIds: [userIds.theo, userIds.maya],
      updatedBy: userIds.jonas,
    })
  );

  await domainEvents.idle();
  stopNotifications();

  // ---- Smart view -----------------------------------------------------------
  must(
    await new SmartViewService(db).create({
      workspaceId: workspace.id,
      name: 'Due this week',
      description: 'Open tasks due in the next 7 days, across projects',
      createdBy: userIds.maya,
      displayType: 'list',
      groupBy: 'project',
      sortBy: 'due_date',
      sortOrder: 'asc',
      filters: {
        operator: 'AND',
        conditions: [
          { field: 'state.category', op: 'in', value: ['backlog', 'in_progress'] },
          { field: 'due_date', op: 'lt', value: '{{now + 7d}}' },
        ],
      },
    })
  );

  // ---- Spread timestamps so "created 3 days ago" reads naturally ------------
  for (const { id, ageDays } of created) {
    await db
      .update(tasks)
      .set({ createdAt: days(-ageDays), updatedAt: days(-Math.min(ageDays, 1)) })
      .where(eq(tasks.id, id));
    // History entries keep their order but move back with the task.
    await db
      .update(taskEvents)
      .set({ createdAt: sql`${taskEvents.createdAt} - ${`${ageDays} days`}::interval` })
      .where(eq(taskEvents.taskId, id));
  }
  for (const [i, id] of commentIds.entries()) {
    const minutesAgo = (commentIds.length - i) * 47;
    await db
      .update(comments)
      .set({
        createdAt: new Date(now - minutesAgo * 60_000),
        updatedAt: new Date(now - minutesAgo * 60_000),
      })
      .where(eq(comments.id, id));
  }
  await db
    .update(notifications)
    .set({ createdAt: sql`${notifications.createdAt} - (random() * interval '6 hours')` })
    .where(inArray(notifications.userId, Object.values(userIds)));

  // ---- Session for Maya -----------------------------------------------------
  const token = `demo-${crypto.randomUUID()}`;
  await db.insert(sessions).values({ userId: userIds.maya, token, expiresAt: days(7) });

  console.log(`Seeded workspace "Larkspur Labs" (${workspace.id}).`);
  console.log(`Signed in as ${people.maya} (maya@larkspur.example) for 7 days. Cookie:`);
  console.log(`better-auth.session_token=${await signCookieValue(token, authSecret)}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
