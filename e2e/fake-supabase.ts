import type { BrowserContext, Route } from '@playwright/test';

/**
 * A tiny in-memory Supabase stand-in (auth + the `records` table and
 * `push_records` function), so the cloud build can be tested end to end
 * without a real project. It follows the same rules as supabase/schema.sql:
 * per-user isolation and "strictly newer client change wins".
 */

export const FAKE_SUPABASE_URL = 'https://fake-project.supabase.test';

interface User {
  id: string;
  email: string;
  password: string;
}

interface Row {
  kind: string;
  key: string;
  data: unknown;
  deleted: boolean;
  client_updated_at: number;
  server_updated_at: string;
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export class FakeSupabase {
  users: User[] = [];
  rows = new Map<string, Map<string, Row>>();
  private clock = Date.UTC(2026, 9, 14, 8);
  private tokens = new Map<string, string>(); // refresh token -> user id

  recordsOf(email: string) {
    const user = this.users.find((u) => u.email === email);
    return [...(this.rows.get(user?.id ?? '')?.values() ?? [])].filter((r) => !r.deleted);
  }

  private session(user: User) {
    const now = Math.floor(Date.now() / 1000);
    const access = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.c2ln`;
    const refresh = `r-${Math.random().toString(36).slice(2)}`;
    this.tokens.set(refresh, user.id);
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: refresh,
      user: this.userJson(user),
    };
  }

  private userJson(user: User) {
    const t = new Date().toISOString();
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: t,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: t,
      updated_at: t,
    };
  }

  private userFromAuth(route: Route): User | undefined {
    const token = route.request().headers()['authorization']?.replace(/^Bearer /, '') ?? '';
    try {
      const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
      return this.users.find((u) => u.id === sub);
    } catch {
      return undefined;
    }
  }

  private error(route: Route, status: number, code: string, msg: string) {
    return route.fulfill({ status, json: { code, error_code: code, msg, message: msg } });
  }

  async install(context: BrowserContext) {
    // Realtime: accept the socket and stay silent (devices still sync on focus/after changes).
    await context.routeWebSocket(/fake-project\.supabase\.test/, () => {});
    await context.route(`${FAKE_SUPABASE_URL}/**`, (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = (() => {
      try {
        return req.postDataJSON();
      } catch {
        return undefined;
      }
    })();

    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });

    if (path === '/auth/v1/signup') {
      if (this.users.some((u) => u.email === body.email)) return this.error(route, 422, 'user_already_exists', 'User already registered');
      if (String(body.password).length < 8) return this.error(route, 422, 'weak_password', 'Password should be at least 8 characters.');
      const user = { id: crypto.randomUUID(), email: body.email, password: body.password };
      this.users.push(user);
      return route.fulfill({ json: this.session(user) });
    }
    if (path === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const user = this.users.find((u) => u.email === body.email && u.password === body.password);
        if (!user) return this.error(route, 400, 'invalid_credentials', 'Invalid login credentials');
        return route.fulfill({ json: this.session(user) });
      }
      if (grant === 'refresh_token') {
        const id = this.tokens.get(body.refresh_token);
        const user = this.users.find((u) => u.id === id);
        if (!user) return this.error(route, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
        return route.fulfill({ json: this.session(user) });
      }
    }
    if (path === '/auth/v1/user') {
      const user = this.userFromAuth(route);
      return user ? route.fulfill({ json: this.userJson(user) }) : this.error(route, 401, 'bad_jwt', 'invalid JWT');
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (path === '/auth/v1/recover') return route.fulfill({ json: {} });

    if (path === '/rest/v1/rpc/push_records') {
      const user = this.userFromAuth(route);
      if (!user) return route.fulfill({ status: 401, json: { message: 'permission denied' } });
      const table = this.rows.get(user.id) ?? new Map<string, Row>();
      this.rows.set(user.id, table);
      for (const r of body.records as Row[]) {
        const k = `${r.kind}:${r.key}`;
        const prev = table.get(k);
        if (!prev || prev.client_updated_at < r.client_updated_at) {
          this.clock += 1000;
          table.set(k, {
            kind: r.kind,
            key: r.key,
            data: r.deleted ? null : r.data,
            deleted: !!r.deleted,
            client_updated_at: r.client_updated_at,
            server_updated_at: new Date(this.clock).toISOString().replace('Z', '+00:00'),
          });
        }
      }
      return route.fulfill({ status: 204 });
    }
    if (path === '/rest/v1/records' && req.method() === 'GET') {
      const user = this.userFromAuth(route);
      if (!user) return route.fulfill({ status: 401, json: { message: 'permission denied' } });
      const gt = url.searchParams.get('server_updated_at')?.replace(/^gt\./, '');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 1000);
      const rows = [...(this.rows.get(user.id)?.values() ?? [])]
        .filter((r) => !gt || Date.parse(r.server_updated_at) > Date.parse(gt))
        .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
        .slice(offset, offset + limit);
      return route.fulfill({ json: rows });
    }
    return route.fulfill({ status: 404, json: { message: `fake supabase: ${req.method()} ${path} not handled` } });
  }
}
