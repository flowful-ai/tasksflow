/**
 * List every HTTP route the API serves, read statically from src/app.ts and
 * src/routes/*.ts, as a Markdown table per route file: method, full path,
 * authentication, permission and request body. docs/api.md is generated from
 * this output (plus hand-written notes), so re-run it after changing routes.
 *
 * Usage:
 *   bun apps/api/scripts/list-routes.ts            # Markdown tables
 *   bun apps/api/scripts/list-routes.ts --tsv      # one route per line
 *
 * Detection is heuristic: permissions are the `'scope:action'` literals passed
 * to the guards inside each handler, the body is the schema given to
 * `zValidator('json', …)`, and authentication comes from where the router is
 * mounted (before or after `authMiddleware` in app.ts) and the guards it calls.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', 'src');
const ROUTES_DIR = join(SRC, 'routes');

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';

interface RouteEntry {
  file: string;
  method: Method;
  path: string;
  auth: string;
  permissions: string[];
  body: string;
}

interface RouterSource {
  file: string;
  /** Local variable name of the Hono instance. */
  variable: string;
}

interface Mount {
  prefix: string;
  router: RouterSource;
  /** True when mounted before `app.use('/api/*', authMiddleware)`. */
  beforeAuth: boolean;
}

/** Authentication for routers that app.ts mounts before the session middleware. */
const PRE_AUTH_LABELS: Record<string, string> = {
  'auth.ts': 'Better Auth',
  'public.ts': 'none (share token, optional password)',
  'webhooks.ts': 'signature (HMAC)',
  'mcp-sse.ts': 'MCP OAuth bearer',
  'mcp-oauth.ts': 'none (OAuth endpoint)',
  'events.ts': 'none',
  'invitations.ts': 'none (invitation token)',
  'github.ts': 'session (OAuth state nonce)',
};

const SESSION_GUARDS =
  /\b(requireUser|requireSession|requireWorkspace|requireProject|requireTask|requireSmartView|getCurrentUser|requireAuth|authorizeProjectIntegration)\b/;

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** `export { a as b, c }` and `export const c = new Hono()` → exported name → local variable. */
function exportedRouters(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const block of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of (block[1] ?? '').split(',')) {
      const [local, exported] = part
        .trim()
        .split(/\s+as\s+/)
        .map((name) => name.trim());
      if (local) result.set(exported ?? local, local);
    }
  }
  for (const match of source.matchAll(/export\s+const\s+(\w+)\s*=\s*new\s+Hono\b/g)) {
    if (match[1]) result.set(match[1], match[1]);
  }
  return result;
}

/** Imported router name → source file, from `import { … } from './routes/x.js'`. */
function importedRouters(source: string): Map<string, RouterSource> {
  const result = new Map<string, RouterSource>();
  for (const match of source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*'\.\/(?:routes\/)?([\w-]+)\.js'/g
  )) {
    const file = `${match[2] ?? ''}.ts`;
    let exportsOfFile: Map<string, string>;
    try {
      exportsOfFile = exportedRouters(read(join(ROUTES_DIR, file)));
    } catch {
      continue;
    }
    for (const part of (match[1] ?? '').split(',')) {
      const [exported, alias] = part
        .trim()
        .split(/\s+as\s+/)
        .map((name) => name.trim());
      const variable = exported ? exportsOfFile.get(exported) : undefined;
      if (exported && variable) result.set(alias ?? exported, { file, variable });
    }
  }
  return result;
}

function appMounts(): Mount[] {
  const source = read(join(SRC, 'app.ts'));
  const routers = importedRouters(source);
  const authAt = source.indexOf("app.use('/api/*', authMiddleware)");
  const mounts: Mount[] = [];
  for (const match of source.matchAll(/app\.route\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
    const router = match[2] ? routers.get(match[2]) : undefined;
    if (!router || match.index === undefined) continue;
    mounts.push({
      prefix: match[1] ?? '',
      router,
      beforeAuth: authAt >= 0 && match.index < authAt,
    });
  }
  return mounts;
}

function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function isMethod(value: string): value is Method {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL'].includes(value);
}

interface LocalRoute {
  method: Method;
  path: string;
  snippet: string;
}

/** Routes declared on `variable` in `file`, including sub-routers mounted with `variable.route()`. */
function localRoutes(router: RouterSource, seen = new Set<string>()): LocalRoute[] {
  const key = `${router.file}:${router.variable}`;
  if (seen.has(key)) return [];
  seen.add(key);

  const source = read(join(ROUTES_DIR, router.file));
  const declaration = new RegExp(
    `\\b${router.variable}\\.(get|post|put|patch|delete|all)\\(\\s*'([^']*)'`,
    'g'
  );
  // A handler ends where the next route of any router in the file begins.
  const boundaries = [
    ...source.matchAll(/\b\w+\.(?:get|post|put|patch|delete|all)\(\s*'/g),
    ...source.matchAll(/^export\s/gm),
  ]
    .map((match) => match.index ?? 0)
    .sort((a, b) => a - b);
  const matches = [...source.matchAll(declaration)];
  const routes: LocalRoute[] = matches.map((match) => {
    const start = match.index ?? 0;
    const end = boundaries.find((index) => index > start) ?? source.length;
    const method = (match[1] ?? '').toUpperCase();
    return {
      method: isMethod(method) ? method : 'ALL',
      path: match[2] ?? '/',
      snippet: source.slice(start, end),
    };
  });

  // Sub-routers: `github.route('/', slackRoutes)` with slackRoutes imported from ./slack.js.
  const imports = new Map<string, RouterSource>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)\.js'/g)) {
    const file = `${match[2] ?? ''}.ts`;
    let exportsOfFile: Map<string, string>;
    try {
      exportsOfFile = exportedRouters(read(join(ROUTES_DIR, file)));
    } catch {
      continue;
    }
    for (const name of (match[1] ?? '').split(',').map((part) => part.trim())) {
      const variable = exportsOfFile.get(name);
      if (variable) imports.set(name, { file, variable });
    }
  }
  const subMount = new RegExp(
    `\\b${router.variable}\\.route\\(\\s*'([^']*)'\\s*,\\s*(\\w+)\\s*\\)`,
    'g'
  );
  for (const match of source.matchAll(subMount)) {
    const sub = match[2] ? imports.get(match[2]) : undefined;
    if (!sub) continue;
    for (const route of localRoutes(sub, seen)) {
      routes.push({ ...route, path: joinPath(match[1] ?? '/', route.path) });
    }
  }
  return routes;
}

function describeBody(snippet: string): string {
  const json = /zValidator\(\s*'json'\s*,\s*([\w.]+)/.exec(snippet)?.[1];
  if (json?.startsWith('z.')) return 'inline zod schema';
  if (json?.endsWith('.extend')) return `${json.slice(0, -'.extend'.length)} (extended)`;
  if (json) return json;
  const parsed =
    /(\w+Schema)\.safeParse\(\s*(?:await\s+)?(?:readJsonBody\(c\)|c\.req\.json\(\))/.exec(
      snippet
    )?.[1];
  if (parsed) return parsed;
  if (/parseBody\(/.test(snippet)) return 'form (application/x-www-form-urlencoded)';
  if (/c\.req\.json\(|readJsonBody\(/.test(snippet)) return 'JSON (parsed in handler)';
  return '';
}

function describeAuth(mount: Mount, route: LocalRoute): string {
  if (/deprecatedResponse|legacySseDeprecatedResponse/.test(route.snippet)) return 'none';
  if (mount.beforeAuth) {
    const label = PRE_AUTH_LABELS[mount.router.file] ?? 'none';
    if (SESSION_GUARDS.test(route.snippet) || /authMiddleware/.test(route.snippet)) {
      return label.startsWith('session') ? label : 'session';
    }
    return label;
  }
  if (/requireAppManager\(/.test(route.snippet)) return 'session (app manager)';
  return 'session';
}

/** Routes declared directly on the app in app.ts (health, discovery, root). */
function appLevelRoutes(): RouteEntry[] {
  const source = read(join(SRC, 'app.ts'));
  const entries: RouteEntry[] = [];
  for (const match of source.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const method = (match[1] ?? '').toUpperCase();
    entries.push({
      file: 'app.ts',
      method: isMethod(method) ? method : 'ALL',
      path: match[2] ?? '/',
      auth: 'none',
      permissions: [],
      body: '',
    });
  }
  return entries;
}

/** Permission literals and role checks found in a handler. */
function describePermissions(snippet: string): string[] {
  const found = new Set<string>();
  for (const match of snippet.matchAll(
    /'((?:workspace|project|task|comment|smart_view|agent):[a-z_]+)'/g
  )) {
    if (match[1]) found.add(match[1]);
  }
  for (const match of snippet.matchAll(/requireSmartView\(c,[^;]*?\),\s*'(\w+)'\s*\)/g)) {
    if (match[1]) found.add(`smart view ${match[1]}`);
  }
  if (/requireWorkspaceAdminOrOwner\(|isWorkspaceAdmin\(|loadOwned\(/.test(snippet)) {
    found.add('owner or admin');
  }
  if (/deprecatedResponse|legacySseDeprecatedResponse/.test(snippet)) found.add('gone (410)');
  return [...found];
}

function collectRoutes(): RouteEntry[] {
  const entries: RouteEntry[] = appLevelRoutes();
  for (const mount of appMounts()) {
    for (const route of localRoutes(mount.router)) {
      const permissions = describePermissions(route.snippet);
      entries.push({
        file: mount.router.file,
        method: route.method,
        path: joinPath(mount.prefix, route.path),
        auth: describeAuth(mount, route),
        permissions,
        body: describeBody(route.snippet),
      });
    }
  }
  return entries;
}

function main(): void {
  const entries = collectRoutes();
  if (process.argv.includes('--tsv')) {
    for (const entry of entries) {
      console.log(
        [
          entry.method,
          entry.path,
          entry.auth,
          entry.permissions.join(','),
          entry.body,
          entry.file,
        ].join('\t')
      );
    }
    return;
  }

  // Files in mount order (app.ts first).
  const byFile = new Map<string, RouteEntry[]>();
  for (const entry of entries) {
    const list = byFile.get(entry.file) ?? [];
    list.push(entry);
    byFile.set(entry.file, list);
  }
  for (const [file, list] of byFile) {
    console.log(`### \`${file === 'app.ts' ? file : `routes/${file}`}\`\n`);
    console.log('| Method | Path | Auth | Permission | Body |');
    console.log('| --- | --- | --- | --- | --- |');
    for (const entry of list) {
      const permission = entry.permissions.map((p) => `\`${p}\``).join(', ') || '-';
      const body = entry.body ? `\`${entry.body}\`` : '-';
      console.log(
        `| ${entry.method} | \`${entry.path}\` | ${entry.auth} | ${permission} | ${body} |`
      );
    }
    console.log('');
  }
  console.log(`${entries.length} routes.`);
}

main();
