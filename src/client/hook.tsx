/**
 * React hook factory for talking to the server-side query proxy.
 *
 * Usage in a Vite app:
 *
 *   import { createSQLQueryProxyHook } from "@obsidianlabs/motherduck-pages-proxy/client";
 *
 *   export const useSQLQueryProxy = createSQLQueryProxyHook({
 *     proxyPath: import.meta.env.VITE_QUERY_PROXY_PATH ?? "/api/query",
 *   });
 *
 * The hook returns the same shape as `react-query`: `data`, `isLoading`,
 * `isSuccess`, `isError`, `error`, plus `refetch`, `placeholderData`,
 * `initialData`, and `select` options. Designed as a drop-in for
 * `useSQLQuery` from `@motherduck/react-sql-query` when you want to
 * route queries through a server-side proxy instead of the wasm client.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type QueryStatus = "idle" | "loading" | "success" | "error";

export interface UseSQLQueryOptions<TData> {
  enabled?: boolean;
  select?: (data: ReadonlyArray<unknown>) => TData;
  initialData?: TData;
  placeholderData?: TData | ((previousData: TData | undefined) => TData | undefined);
}

export interface UseSQLQueryResult<TData> {
  data: TData | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  error: Error | null;
  refetch: () => void;
  status: QueryStatus;
}

export interface ClientConfig {
  /** Path the proxy is mounted at, e.g. `"/api/query"`. Required. */
  proxyPath: string;
  /** Extra `fetch` options. `body`/`method`/`signal` are managed internally. */
  fetchOptions?: Omit<RequestInit, "body" | "method" | "signal">;
}

interface ProxyResponse {
  columns?: string[];
  rows?: ReadonlyArray<unknown>;
  error?: { code: string; message: string };
}

async function fetchProxiedQuery(
  proxyPath: string,
  fetchOptions: Omit<RequestInit, "body" | "method" | "signal"> | undefined,
  sql: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<unknown>> {
  const headers = new Headers(fetchOptions?.headers);
  headers.set("Content-Type", "application/json");
  const res = await fetch(proxyPath, {
    ...fetchOptions,
    method: "POST",
    headers,
    body: JSON.stringify({ sql }),
    credentials: fetchOptions?.credentials ?? "same-origin",
    signal,
  });
  let payload: ProxyResponse;
  try {
    payload = (await res.json()) as ProxyResponse;
  } catch {
    throw new Error(`Query proxy returned non-JSON (status ${res.status})`);
  }
  if (!res.ok || payload.error) {
    const message = payload.error?.message ?? `HTTP ${res.status}`;
    const code = payload.error?.code ?? "PROXY_ERROR";
    throw new Error(`[${code}] ${message}`);
  }
  return payload.rows ?? [];
}

interface QuerySnap {
  status: QueryStatus;
  data: ReadonlyArray<unknown> | undefined;
  error: Error | undefined;
  hasHadData: boolean;
  lastData: ReadonlyArray<unknown> | undefined;
}

/**
 * Build a configured `useSQLQueryProxy` hook. Call once at module scope and
 * export the returned hook.
 */
export function createSQLQueryProxyHook(config: ClientConfig) {
  const { proxyPath, fetchOptions } = config;

  return function useSQLQueryProxy<TData = ReadonlyArray<unknown>>(
    sql: string,
    options?: UseSQLQueryOptions<TData>,
  ): UseSQLQueryResult<TData> {
    const enabled = options?.enabled !== false;

    const [snap, setSnap] = useState<QuerySnap>({
      status: "idle",
      data: undefined,
      error: undefined,
      hasHadData: false,
      lastData: undefined,
    });

    // Single owning AbortController so refetch + sql-change + unmount all
    // cancel the prior in-flight fetch instead of racing it. Without this,
    // a slow first request can resolve after a faster refetch and overwrite
    // the fresh data.
    const acRef = useRef<AbortController | null>(null);

    const run = useCallback(
      (s: string) => {
        acRef.current?.abort();
        const ac = new AbortController();
        acRef.current = ac;
        setSnap((prev) => ({ ...prev, status: "loading", error: undefined }));
        fetchProxiedQuery(proxyPath, fetchOptions, s, ac.signal).then(
          (rows) => {
            if (ac.signal.aborted) return;
            setSnap({
              status: "success",
              data: rows,
              error: undefined,
              hasHadData: true,
              lastData: rows,
            });
          },
          (err: unknown) => {
            if (ac.signal.aborted) return;
            const e = err instanceof Error ? err : new Error(String(err));
            if (e.name === "AbortError") return;
            setSnap((prev) => ({
              ...prev,
              status: "error",
              data: undefined,
              error: e,
            }));
          },
        );
      },
      [],
    );

    useEffect(() => {
      if (!enabled) {
        acRef.current?.abort();
        setSnap((prev) =>
          prev.status === "idle"
            ? prev
            : { ...prev, status: "idle", data: undefined, error: undefined },
        );
        return;
      }
      run(sql);
      return () => acRef.current?.abort();
    }, [sql, enabled, run]);

    const refetch = useCallback(() => {
      if (!enabled) return;
      run(sql);
    }, [run, sql, enabled]);

    const isLoading = snap.status === "loading";
    const rawData = snap.data ?? snap.lastData;

    const transformed = useMemo<TData | undefined>(() => {
      if (rawData === undefined) return undefined;
      return options?.select
        ? options.select(rawData)
        : (rawData as unknown as TData);
    }, [rawData, options?.select]);

    const { data, isPlaceholderData } = useMemo<{
      data: TData | undefined;
      isPlaceholderData: boolean;
    }>(() => {
      if (transformed !== undefined) {
        return { data: transformed, isPlaceholderData: false };
      }
      if (!snap.hasHadData && options?.initialData !== undefined) {
        return { data: options.initialData, isPlaceholderData: false };
      }
      if (isLoading && options?.placeholderData !== undefined) {
        const ph =
          typeof options.placeholderData === "function"
            ? (
                options.placeholderData as (
                  previous: TData | undefined,
                ) => TData | undefined
              )(transformed)
            : options.placeholderData;
        if (ph !== undefined) return { data: ph, isPlaceholderData: true };
      }
      return { data: undefined, isPlaceholderData: false };
    }, [
      transformed,
      snap.hasHadData,
      options?.initialData,
      options?.placeholderData,
      isLoading,
    ]);

    return {
      data,
      isLoading,
      isSuccess: snap.status === "success",
      isError: snap.status === "error",
      isPlaceholderData,
      error: snap.error ?? null,
      refetch,
      status: snap.status,
    };
  };
}
