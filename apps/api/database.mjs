import pg from 'pg';

const {Pool} = pg;
const DEFAULT_TIMEOUT_MS = 1500;

function timeoutValue(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Create the read-only database adapter used by setup health checks.
 * This intentionally exposes no migration or write operation.
 */
export function createDatabase({connectionString = process.env.DATABASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  if (!connectionString) return null;

  const queryTimeout = timeoutValue(timeoutMs);
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: queryTimeout,
    idleTimeoutMillis: 1_000,
    query_timeout: queryTimeout,
    allowExitOnIdle: true,
  });

  // Prevent an idle pool error from becoming an unhandled process error. The
  // readiness endpoint deliberately reports only a stable not-ready state.
  pool.on('error', () => {});

  let closed = false;
  return {
    async check() {
      if (closed) return false;
      await pool.query('SELECT 1');
      return true;
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

export async function isDatabaseReady(database, {timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  if (!database) return false;
  const check = typeof database.check === 'function'
    ? database.check.bind(database)
    : typeof database.query === 'function'
      ? () => Promise.resolve(database.query('SELECT 1')).then(() => true)
      : null;
  if (!check) return false;

  const timeout = timeoutValue(timeoutMs);
  let timer;
  try {
    return Boolean(await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('database_timeout')), timeout);
        timer.unref?.();
      }),
    ]));
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
