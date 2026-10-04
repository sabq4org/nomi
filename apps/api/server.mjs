import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function makeServer() {
  return createServer((req, res) => {
    const requestId = randomUUID();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-ID', requestId);
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify({...body, requestId})); };
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET') return reply(405, {error:'method_not_allowed'});
    if (path === '/health/live') return reply(200, {status:'ok', service:'nomi-api'});
    // Never report readiness while the data adapter is not implemented.
    if (path === '/health/ready') return reply(503, {status:'not_ready', dependencies:{database:'not_connected'}});
    if (path === '/v1/meta') return reply(200, {name:'نومي', locale:'ar-SA', direction:'rtl', stage:'foundation', newsAvailable:false});
    return reply(404, {error:'not_found'});
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') throw new Error('Production is disabled until authentication and persistence are implemented');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = makeServer();
  server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(JSON.stringify({event:'listening',port})));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
