import {createServer} from 'node:http';
import {createReadStream, readFileSync, statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createDatabase, isDatabaseReady} from './database.mjs';

const setupPage = readFileSync(new URL('../web/setup.html', import.meta.url), 'utf8');
const demoPagePath = new URL('../../sample-briefing/prototype/nomi-briefing.html', import.meta.url);
const demoAudioPath = new URL('../../sample-briefing/prototype/briefing.mp3', import.meta.url);
const DEFAULT_READY_TIMEOUT_MS = 1500;

export function assertProductionLaunchAllowed({nodeEnv = process.env.NODE_ENV, launchMode = process.env.NOMI_LAUNCH_MODE} = {}) {
  if (nodeEnv === 'production' && !['setup', 'demo'].includes(launchMode)) {
    throw new Error('Production requires NOMI_LAUNCH_MODE=setup or demo');
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
  const demoMode = launchMode === 'demo';
  const stage = demoMode ? 'demo' : 'setup';
  const demoPage = demoMode ? readFileSync(demoPagePath, 'utf8') : null;
  const demoAudioSize = demoMode ? statSync(demoAudioPath).size : null;

  return createServer((req, res) => {
    const requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Referrer-Policy', 'no-referrer');

    const reply = (status, body) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(status);
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({...body, requestId}));
    };
    const replyPage = (page = setupPage, contentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data:; base-uri 'none'; form-action 'none'") => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', contentSecurityPolicy);
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Content-Length', Buffer.byteLength(page));
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : page);
    };
    const replyDemoPage = () => {
      return replyPage(demoPage, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src 'self' data:; media-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
    };
    const replyDemoAudio = () => {
      const total = demoAudioSize;
      const range = req.headers.range;
      let start = 0;
      let end = total - 1;
      let partial = false;

      if (range !== undefined) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
          res.setHeader('Content-Range', `bytes */${total}`);
          return reply(416, {error: 'range_not_satisfiable'});
        }
        if (match[1] === '' && match[2] === '') {
          res.setHeader('Content-Range', `bytes */${total}`);
          return reply(416, {error: 'range_not_satisfiable'});
        }
        if (match[1] === '') {
          const suffixLength = Number(match[2]);
          if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            res.setHeader('Content-Range', `bytes */${total}`);
            return reply(416, {error: 'range_not_satisfiable'});
          }
          start = Math.max(total - suffixLength, 0);
        } else {
          start = Number(match[1]);
          if (!Number.isSafeInteger(start) || start >= total) {
            res.setHeader('Content-Range', `bytes */${total}`);
            return reply(416, {error: 'range_not_satisfiable'});
          }
          if (match[2] !== '') {
            end = Number(match[2]);
            if (!Number.isSafeInteger(end) || end < start) {
              res.setHeader('Content-Range', `bytes */${total}`);
              return reply(416, {error: 'range_not_satisfiable'});
            }
          }
        }
        end = Math.min(end, total - 1);
        partial = true;
      }

      const length = end - start + 1;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', length);
      if (partial) {
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.writeHead(206);
      } else {
        res.writeHead(200);
      }
      if (req.method === 'HEAD') return res.end();

      const stream = createReadStream(demoAudioPath, {start, end});
      const abort = () => stream.destroy();
      req.once('aborted', abort);
      res.once('close', abort);
      stream.once('error', () => {
        req.off('aborted', abort);
        res.off('close', abort);
        if (!res.headersSent) reply(500, {error: 'media_unavailable'});
        else res.destroy();
      });
      stream.once('close', () => {
        req.off('aborted', abort);
        res.off('close', abort);
      });
      stream.pipe(res);
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

    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return reply(405, {error: 'method_not_allowed'});
    }
    if (path === '/' && setupMode) return replyPage();
    if (demoMode && (path === '/' || path === '/nomi-briefing.html')) return replyDemoPage();
    if (demoMode && path === '/briefing.mp3') return replyDemoAudio();
    if (path === '/health/live') {
      return reply(200, {status: 'ok', service: 'nomi-api', stage});
    }
    if (path === '/health/ready') {
      return isDatabaseReady(database, {timeoutMs: readyTimeoutMs}).then((ready) => {
        if (ready) return reply(200, {
          status: 'ready',
          stage,
          applicationReady: false,
          dependencies: {database: 'connected'},
        });
        return reply(503, {
          status: 'not_ready',
          stage,
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
        stage,
        applicationReady: false,
        sampleAvailable: demoMode,
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
