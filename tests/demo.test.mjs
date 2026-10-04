import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {assertProductionLaunchAllowed, makeServer} from '../apps/api/server.mjs';

const htmlPath = new URL('../sample-briefing/prototype/nomi-briefing.html', import.meta.url);
const audioPath = new URL('../sample-briefing/prototype/briefing.mp3', import.meta.url);
const audio = readFileSync(audioPath);

test('production explicitly permits the demo launch mode', () => {
  assert.doesNotThrow(() => assertProductionLaunchAllowed({nodeEnv: 'production', launchMode: 'demo'}));
});

async function withServer(callback) {
  const server = makeServer({launchMode: 'demo', database: null});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('demo serves the exact briefing page only at the public demo paths', async () => {
  const expected = readFileSync(htmlPath, 'utf8');
  await withServer(async (base) => {
    for (const path of ['/', '/nomi-briefing.html']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.equal(await response.text(), expected, path);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.match(response.headers.get('content-security-policy'), /script-src 'unsafe-inline'/);
      assert.match(response.headers.get('content-security-policy'), /style-src 'unsafe-inline'/);
      assert.match(response.headers.get('content-security-policy'), /font-src data:/);
      assert.match(response.headers.get('content-security-policy'), /media-src 'self'/);
      assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
      assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
    }
    const head = await fetch(base + '/nomi-briefing.html', {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(expected)));
    assert.equal(await head.text(), '');
  });
});

test('demo streams the complete audio and supports single byte ranges and HEAD', async () => {
  const total = statSync(audioPath).size;
  await withServer(async (base) => {
    const full = await fetch(base + '/briefing.mp3');
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'audio/mpeg');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), String(total));
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), audio);

    const ranged = await fetch(base + '/briefing.mp3', {headers: {Range: 'bytes=100-199'}});
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 100-199/${total}`);
    assert.equal(ranged.headers.get('content-length'), '100');
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), audio.subarray(100, 200));

    const suffixLength = 257;
    const suffix = await fetch(base + '/briefing.mp3', {headers: {Range: `bytes=-${suffixLength}`}});
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), `bytes ${total - suffixLength}-${total - 1}/${total}`);
    assert.equal(suffix.headers.get('content-length'), String(suffixLength));
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), audio.subarray(-suffixLength));

    const rangeHead = await fetch(base + '/briefing.mp3', {method: 'HEAD', headers: {Range: 'bytes=4-8'}});
    assert.equal(rangeHead.status, 206);
    assert.equal(rangeHead.headers.get('content-range'), `bytes 4-8/${total}`);
    assert.equal(rangeHead.headers.get('content-length'), '5');
    assert.equal(await rangeHead.text(), '');
  });
});

test('demo rejects malformed and unsatisfiable ranges without exposing private sample paths', async () => {
  await withServer(async (base) => {
    for (const range of ['bytes=1-2,4-5', 'bytes=999999999-', 'bytes=8-4', 'not-a-range']) {
      const response = await fetch(base + '/briefing.mp3', {headers: {Range: range}});
      assert.equal(response.status, 416, range);
      assert.equal(response.headers.get('content-range'), `bytes */${audio.length}`);
    }
    for (const path of [
      '/sample-briefing/prototype/nomi-briefing.html',
      '/sample-briefing/prototype/briefing.mp3',
      '/sample-briefing/prototype/assets/logos/nomi-symbol.svg',
      '/v1/stories',
    ]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }

    const live = await (await fetch(base + '/health/live')).json();
    assert.equal(live.stage, 'demo');
    const ready = await (await fetch(base + '/health/ready')).json();
    assert.equal(ready.stage, 'demo');
    assert.equal(ready.applicationReady, false);
    const meta = await (await fetch(base + '/v1/meta')).json();
    assert.equal(meta.stage, 'demo');
    assert.equal(meta.applicationReady, false);
    assert.equal(meta.sampleAvailable, true);
    assert.equal(meta.newsAvailable, false);
  });
});
