/**
 * Connection ladder for MotherDuck access from a Cloudflare Worker / Pages
 * Function. Three strategies, tried in priority order:
 *   1. Hyperdrive binding (preferred — pooled, lower latency)
 *   2. Full Postgres-wire connection string from env
 *   3. MotherDuck personal access token from env, used to build a default
 *      connection string against pg.us-east-1-aws.motherduck.com
 *
 * `pg` is a peer dependency. Consumers must install it themselves and
 * enable `compatibility_flags = ["nodejs_compat"]` in wrangler.toml.
 */

import { Client, type ClientConfig as PgClientConfig } from "pg";

/**
 * Minimal pg.Client surface the proxy uses. Lets consumers / tests
 * supply their own client factory without depending on the concrete
 * `pg.Client` class binding (which is immutable in ESM).
 */
export interface PgLikeClient {
  connect(): Promise<void>;
  query(sql: string): Promise<{ fields?: ReadonlyArray<{ name: string }>; rows: ReadonlyArray<unknown> }>;
  end(): Promise<void>;
}

export type ClientFactory = (config: PgClientConfig) => PgLikeClient;

export interface ConnectionConfig {
  /** Database / catalog name on MotherDuck (e.g. "shooting"). Required. */
  database: string;
  /** Hyperdrive binding name on `env`. Default: `"HYPERDRIVE"`. */
  hyperdriveBindingName?: string;
  /** Env var name holding a full pg connection string. Default: `"PG_CONNECTION"`. */
  connectionStringEnvName?: string;
  /** Env var name holding a MotherDuck PAT. Default: `"MOTHERDUCK_TOKEN"`. */
  motherduckTokenEnvName?: string;
  /** Override the default MD pg host. */
  host?: string;
  /** Override the default MD pg port. */
  port?: number;
  /**
   * Construct the underlying `pg.Client` (or a compatible stub). Defaults
   * to the real `pg.Client`. Useful for tests + alternative drivers.
   */
  clientFactory?: ClientFactory;
}

const DEFAULT_HOST = "pg.us-east-1-aws.motherduck.com";
const DEFAULT_PORT = 5432;
const DEFAULT_USER = "postgres";

const defaultClientFactory: ClientFactory = (cfg) =>
  new Client(cfg) as unknown as PgLikeClient;

/**
 * Build a pg `Client` configured for MotherDuck. Throws if no connection
 * strategy is available. Caller is responsible for `connect()` / `end()`.
 */
export function buildClient(
  env: Record<string, unknown>,
  config: ConnectionConfig,
): PgLikeClient {
  const hyperdriveKey = config.hyperdriveBindingName ?? "HYPERDRIVE";
  const connStringKey = config.connectionStringEnvName ?? "PG_CONNECTION";
  const tokenKey = config.motherduckTokenEnvName ?? "MOTHERDUCK_TOKEN";
  const factory = config.clientFactory ?? defaultClientFactory;

  const hyperdrive = env[hyperdriveKey] as
    | { connectionString?: string }
    | undefined;
  if (hyperdrive?.connectionString) {
    return factory({ connectionString: hyperdrive.connectionString });
  }

  const connString = env[connStringKey];
  if (typeof connString === "string" && connString) {
    return factory({ connectionString: connString });
  }

  const token = env[tokenKey];
  if (typeof token === "string" && token) {
    return factory({
      host: config.host ?? DEFAULT_HOST,
      port: config.port ?? DEFAULT_PORT,
      user: DEFAULT_USER,
      password: token,
      database: config.database,
      ssl: { rejectUnauthorized: true },
    });
  }

  throw new Error(
    `No MotherDuck connection configured (set ${hyperdriveKey} binding, ${connStringKey} env, or ${tokenKey} env)`,
  );
}
