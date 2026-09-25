/**
 * Persona OS — preview backend shim.
 *
 * This file mirrors the exact subset of supabase-js used by the app
 * (auth.getUser / signUp / signInWithPassword / signOut, Postgrest-style
 * query builder, storage upload/getPublicUrl/remove) but backs it with
 * local API routes (Prisma/SQLite + on-disk file storage).
 *
 * To connect the real Supabase later, restore the original client:
 *
 *   import { createClient } from '@supabase/supabase-js'
 *   export const supabase = createClient(
 *     process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
 *   )
 *
 * No page code needs to change in either direction.
 */

const TOKEN_KEY = "persona-os-auth-token";

type MockUser = { id: string; email: string };
type MockError = { message: string; status?: number } | null;
type DbResponse<T = any> = { data: T; error: MockError; count?: number | null };

type Filter = { type: "eq" | "in" | "gte" | "lte" | "gt" | "lt" | "ne" | "not"; column: string; value: unknown; innerOp?: string };

interface SelectOptions {
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
}

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * fetch() with the preview-backend session token attached. Required for any
 * /api/* route guarded by userFromRequest (auto-tag, render-image,
 * consistency-scan, delete-account, ...). Pages must use this instead of
 * bare fetch for auth-gated endpoints.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const contentType = init.body ? "application/json" : null;
  if (contentType && !headers.has("Content-Type")) headers.set("Content-Type", contentType);
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * The raw session token, for surfaces that must attach it themselves
 * (e.g. the CopilotKit provider's headers callback in the agent page).
 */
export function getSessionToken(): string | null {
  return getStoredToken();
}

async function requestDb(payload: Record<string, unknown>): Promise<DbResponse> {
  const res = await fetch("/api/local-db", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({ error: { message: "Bad gateway from local-db" } }));
  return json as DbResponse;
}

/** Chainable, awaitable query builder that mimics supabase-js. */
class PostgrestQueryBuilder {
  private filters: Filter[] = [];
  private _order?: { column: string; ascending: boolean };
  private _limit?: number;
  private _single = false;
  private _upsertConflict?: string;
  private _select?: string;
  private _promise?: Promise<DbResponse<any>>;

  constructor(
    private table: string,
    private op: "select" | "insert" | "update" | "delete",
    private values?: Record<string, unknown> | Record<string, unknown>[],
    private options?: SelectOptions
  ) {}

  select(columns?: string, options?: SelectOptions): PostgrestQueryBuilder {
    this._select = columns;
    if (options) this.options = options;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): PostgrestQueryBuilder {
    this.op = "insert";
    this.values = values as Record<string, unknown>;
    return this;
  }

  update(values: Record<string, unknown>): PostgrestQueryBuilder {
    this.op = "update";
    this.values = values;
    return this;
  }

  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): PostgrestQueryBuilder {
    this.op = "insert";
    this.values = values;
    this._upsertConflict = options?.onConflict;
    return this;
  }

  delete(): PostgrestQueryBuilder {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  gte(column: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "lte", column, value });
    return this;
  }

  gt(column: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "gt", column, value });
    return this;
  }

  lt(column: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "lt", column, value });
    return this;
  }

  ne(column: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "ne", column, value });
    return this;
  }

  /** Postgrest negation: .not(col, op, value). Supports eq/ne/gt/gte/lt/lte/is. */
  not(column: string, op: string, value: unknown): PostgrestQueryBuilder {
    this.filters.push({ type: "not", column, value, innerOp: op });
    return this;
  }

  in(column: string, value: unknown[]): PostgrestQueryBuilder {
    this.filters.push({ type: "in", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): PostgrestQueryBuilder {
    this._order = { column, ascending: options?.ascending ?? false };
    return this;
  }

  limit(count: number): PostgrestQueryBuilder {
    this._limit = count;
    return this;
  }

  single(): PostgrestQueryBuilder {
    this._single = true;
    return this;
  }

  private exec(): Promise<DbResponse<any>> {
    if (!this._promise) {
      this._promise = requestDb({
        table: this.table,
        op: this.op,
        select: this._select,
        options: this.options,
        filters: this.filters,
        order: this._order,
        limit: this._limit,
        single: this._single,
        values: this.values,
        onConflict: this._upsertConflict,
      });
    }
    return this._promise;
  }

  // Make the builder awaitable (thenable), like supabase-js.
  then<TResult1 = DbResponse<any>, TResult2 = never>(
    onfulfilled?: ((value: DbResponse<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<DbResponse<any> | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<DbResponse<any>> {
    return this.exec().finally(onfinally);
  }
}

function bucketStorage(bucket: string) {
  return {
    async upload(path: string, file: File | Blob): Promise<{ data: { path: string }; error: MockError }> {
      const form = new FormData();
      form.append("path", `${bucket}/${path}`);
      form.append("file", file);
      try {
        // Auth header required — the storage POST endpoint is auth-gated
        // (same as remove() below). Without it every vault upload 401s.
        const res = await fetch("/api/local-storage", {
          method: "POST",
          headers: { ...authHeaders() },
          body: form,
        });
        const json = await res.json();
        if (json.error) return { data: { path }, error: json.error };
        return { data: { path }, error: null };
      } catch (err: unknown) {
        return { data: { path }, error: { message: err instanceof Error ? err.message : "Upload failed" } };
      }
    },
    getPublicUrl(path: string): { data: { publicUrl: string } } {
      return {
        data: { publicUrl: `/api/local-storage?path=${encodeURIComponent(`${bucket}/${path}`)}` },
      };
    },
    async remove(paths: string[]): Promise<{ data: { removed: string[] }; error: MockError }> {
      try {
        const res = await fetch("/api/local-storage", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ paths: paths.map((p) => `${bucket}/${p}`) }),
        });
        const json = await res.json();
        if (json.error) return { data: { removed: [] }, error: json.error };
        return { data: { removed: json.data?.removed ?? [] }, error: null };
      } catch (err: unknown) {
        return {
          data: { removed: [] },
          error: { message: err instanceof Error ? err.message : "Remove failed" },
        };
      }
    },
  };
}

const auth = {
  async getUser(): Promise<{ data: { user: MockUser | null }; error: MockError }> {
    const token = getStoredToken();
    if (!token) return { data: { user: null }, error: null };
    try {
      const res = await fetch("/api/local-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", token }),
      });
      const json = await res.json();
      if (!json.user) {
        if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
        return { data: { user: null }, error: null };
      }
      return { data: { user: json.user as MockUser }, error: null };
    } catch {
      return { data: { user: null }, error: null };
    }
  },

  async signUp(credentials: { email: string; password: string }) {
    try {
      const res = await fetch("/api/local-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signup", ...credentials }),
      });
      const json = await res.json();
      if (json.error) return { data: null, error: { message: json.error as string, status: res.status || 400 } };
      if (!json.token) {
        return {
          data: null,
          error: {
            message:
              (json.error as string) ||
              "No session token returned. Set LOCAL_SESSION_SECRET in .env.local and restart.",
            status: 500,
          },
        };
      }
      if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, json.token as string);
      return { data: { session: { token: json.token }, user: json.user as MockUser }, error: null };
    } catch (err: unknown) {
      return { data: null, error: { message: err instanceof Error ? err.message : "Sign up failed", status: 500 } };
    }
  },

  async signInWithPassword(credentials: { email: string; password: string }) {
    try {
      const res = await fetch("/api/local-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signin", ...credentials }),
      });
      const json = await res.json();
      if (json.error) return { data: null, error: { message: json.error as string, status: res.status || 400 } };
      if (!json.token) {
        return {
          data: null,
          error: {
            message:
              (json.error as string) ||
              "No session token returned. Set LOCAL_SESSION_SECRET in .env.local and restart.",
            status: 500,
          },
        };
      }
      if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, json.token as string);
      return { data: { session: { token: json.token }, user: json.user as MockUser }, error: null };
    } catch (err: unknown) {
      return { data: null, error: { message: err instanceof Error ? err.message : "Sign in failed", status: 500 } };
    }
  },

  async signOut(): Promise<{ error: MockError }> {
    if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
    return { error: null };
  },
};

const storage = { from: bucketStorage };

function from(table: string): PostgrestQueryBuilder {
  return new PostgrestQueryBuilder(table, "select");
}

export const supabase = { auth, from, storage };
