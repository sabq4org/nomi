import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createDatabase, isDatabaseReady} from './database.mjs';

const setupPage = readFileSync(new URL('../web/setup.html', import.meta.url), 'utf8');
const DEFAULT_READY_TIMEOUT_MS = 1500;

export function assertProductionLaunchAllowed({nodeEnv = process.env.NODE_ENV, launchMode = process.env.NOMI_LAUNCH_MODE} = {}) {
  if (nodeEnv === 'production' && launchMode !== 'setup') {
    throw new Error('Production requires NOMI_LAUNCH_MODE=setup');
  }
}

function timeoutValue(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : DEFAULT_READY_TIMEOUT_MS;
}

export function makeServer({
  database = createDatabase(),
  launchMode = process.env.NOMI_LAUNCH_MODE ?? 'normal',
  readyTimeoutMs = timeoutValue(process.env.NOMI_DB_TIMEOUT_MS),
} = {}) {
  const setupMode = launchMode === 'setup';

  return createServer((req, res) => {
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Referrer-Policy', 'no-referrer');

    const reply = (status, body) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(status);
      res.end(JSON.stringify({...body, requestId}));
    };
    const replyPage = () => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data:; base-uri 'none'; form-action 'none'");
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.writeHead(200);
      res.end(setupPage);
    };

    let path;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(400);
      res.end(JSON.stringify({error: 'bad_request', requestId}));
      return;
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return reply(405, {error: 'method_not_allowed'});
    }
    if (path === '/' && setupMode) return replyPage();
    if (path === '/health/live') {
      return reply(200, {status: 'ok', service: 'nomi-api', stage: 'setup'});
    }
    if (path === '/health/ready') {
      return isDatabaseReady(database, {timeoutMs: readyTimeoutMs}).then((ready) => {
        if (ready) return reply(200, {
          status: 'ready',
          stage: 'setup',
          applicationReady: false,
          dependencies: {database: 'connected'},
        });
        return reply(503, {
          status: 'not_ready',
          stage: 'setup',
          applicationReady: false,
          dependencies: {database: 'not_connected'},
        });
      });
    }
    if (path === '/v1/meta') {
      return reply(200, {
        name: 'نومي',
        locale: 'ar-SA',
        direction: 'rtl',
        stage: 'setup',
        applicationReady: false,
        newsAvailable: false,
      });
    }
    return reply(404, {error: 'not_found'});
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertProductionLaunchAllowed();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

  const launchMode = process.env.NOMI_LAUNCH_MODE ?? 'normal';
  const database = createDatabase();
  const server = makeServer({database, launchMode});
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1');
  server.listen(port, host, () => console.log(JSON.stringify({event: 'listening', port, host, stage: launchMode})));

  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();
    server.close(async () => {
      try {
        await database?.close();
        clearTimeout(forceExit);
        process.exit(0);
      } catch {
        process.exit(1);
      }
    });
  });
}
