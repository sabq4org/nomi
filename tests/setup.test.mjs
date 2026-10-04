import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createDatabase, isDatabaseReady} from '../apps/api/database.mjs';
import {assertProductionLaunchAllowed, makeServer} from '../apps/api/server.mjs';

async function withServer(options, callback) {
  const server = makeServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('production requires the explicit setup launch mode', () => {
  assert.throws(
    () => assertProductionLaunchAllowed({nodeEnv: 'production', launchMode: undefined}),
    /NOMI_LAUNCH_MODE=setup/,
  );
  assert.doesNotThrow(() => assertProductionLaunchAllowed({nodeEnv: 'production', launchMode: 'setup'}));
});

test('setup page is static, Arabic, and contains no application or credential surface', async () => {
  await withServer({launchMode: 'setup', database: null}, async (base) => {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.match(response.headers.get('content-security-policy'), /font-src data:/);
    assert.match(html, /نومي قيد التجهيز/);
    assert.match(html, /class="wordmark"[^>]+aria-label="نومي"/);
    assert.match(html, /إحاطة إخبارية عربية، مكتوبة ومسموعة\. نجهّز التجربة للإطلاق/);
    assert.match(html, /@font-face/);
    assert.match(html, /data:font\/woff2;base64,/);
    assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
    assert.match(html, /dir="rtl"/);
    assert.match(html, /#F7F3EA/);
    assert.match(html, /#1C1B18/);
    assert.match(html, /#F2A33A/);
    for (const forbidden of ['DATABASE_URL', 'ELEVENLABS', 'apiKey', 'password', '/v1/stories', 'sample-briefing']) {
      assert.doesNotMatch(html, new RegExp(forbidden, 'i'));
    }
  });
});

test('readiness is 503 without a database or after a database error', async () => {
  await withServer({launchMode: 'setup', database: null}, async (base) => {
    const response = await fetch(`${base}/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json()).dependencies, {database: 'not_connected'});
  });
  await withServer({launchMode: 'setup', database: {check: async () => { throw new Error('private connection detail'); }}}, async (base) => {
    const response = await fetch(`${base}/health/ready`);
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.doesNotMatch(body, /private connection detail/);
  });
});

test('readiness is 200 only after SELECT 1 succeeds and still marks setup stage', async () => {
  const calls = [];
  await withServer({launchMode: 'setup', database: {query: async (sql) => { calls.push(sql); return {rows: [{'?column?': 1}]}; }}}, async (base) => {
    const response = await fetch(`${base}/health/ready`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['SELECT 1']);
    assert.equal(body.stage, 'setup');
    assert.equal(body.applicationReady, false);
    assert.deepEqual(body.dependencies, {database: 'connected'});
  });
});

test('readiness fails within the configured timeout when the check never resolves', async () => {
  const started = Date.now();
  await withServer({launchMode: 'setup', readyTimeoutMs: 35, database: {check: () => new Promise(() => {})}}, async (base) => {
    const response = await fetch(`${base}/health/ready`);
    assert.equal(response.status, 503);
  });
  assert.ok(Date.now() - started < 1_000);
});

test('real PostgreSQL adapter reports an unreachable database as not ready and closes', async () => {
  const database = createDatabase({connectionString: 'postgres://nomi:nomi@127.0.0.1:1/nomi', timeoutMs: 100});
  assert.ok(database);
  const started = Date.now();
  try {
    assert.equal(await isDatabaseReady(database, {timeoutMs: 250}), false);
    assert.ok(Date.now() - started < 1_000);
  } finally {
    await database.close();
  }
});

test('malformed request targets return a generic 400 without crashing the server', async () => {
  await withServer({launchMode: 'setup', database: null}, async (base) => {
    const url = new URL(base);
    const response = await new Promise((resolve, reject) => {
      const req = request({hostname: url.hostname, port: url.port, path: '//[', method: 'GET'}, resolve);
      req.on('error', reject);
      req.end();
    });
    response.resume();
    assert.equal(response.statusCode, 400);
  });
});

test('only existing read-only endpoints are exposed', async () => {
  await withServer({launchMode: 'setup', database: null}, async (base) => {
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    assert.equal((await fetch(`${base}/v1/meta`)).status, 200);
    assert.equal((await fetch(`${base}/v1/stories`)).status, 404);
    assert.equal((await fetch(`${base}/sample-briefing/prototype/nomi-briefing.html`)).status, 404);
    for (const path of ['/', '/health/live', '/health/ready', '/v1/meta']) {
      const response = await fetch(`${base}${path}`, {method: 'POST'});
      assert.equal(response.status, 405, path);
    }
  });
});
