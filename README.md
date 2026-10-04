# Nomi — Briefing demo and foundation

Node.js API skeleton and PostgreSQL setup gate. Production supports an explicit setup mode or a static briefing demo. The demo reuses the approved prototype and its existing Majed audio; it does not publish a live news feed.

## Run

```sh
npm run check
npm test
npm start
```

The local API binds to http://127.0.0.1:3000. `GET /health/live`, `GET /health/ready`, and `GET /v1/meta` are read-only. In setup mode, `GET /` serves the Arabic holding page. With `NODE_ENV=production`, `NOMI_LAUNCH_MODE=setup` or `NOMI_LAUNCH_MODE=demo` is required and the server binds to `0.0.0.0` for Railway's `PORT`.

```sh
NODE_ENV=production NOMI_LAUNCH_MODE=setup PORT=3000 DATABASE_URL=... npm start
```

Readiness runs only `SELECT 1` against the injected `DATABASE_URL`. Missing or failed database access returns 503; a successful connection returns 200 while metadata still reports `applicationReady: false`. No migrations or schema writes run at startup.

## Briefing demo

Set `NOMI_LAUNCH_MODE=demo` to serve the reading and listening experience at `/`. `/briefing.mp3` supports byte ranges for seeking. Only these explicit public assets are served; study files and other repository content stay unavailable. The demo is dated 4 October 2026, marked as a fixed sample, and excluded from search indexing.

“Ask Nomi” requires the original Claude environment, linked from the page. No paid provider calls or database writes occur in this demo. Set the mode back to `setup` to restore the holding page.

## Development database

Copy .env.example to .env and set a local POSTGRES_PASSWORD, then run `docker compose up -d db`. Initial SQL runs only on a new volume. Do not delete existing volumes to apply schema changes. The bootstrap database role is for local initialization only.

## Status

The setup gate is intentionally not the application launch. Authentication, authorization, migrations, editorial publishing, worker execution, and provider integrations remain outside this safe hosting connection step. The editorial validator checks required evidence metadata; it does not establish factual correctness.
