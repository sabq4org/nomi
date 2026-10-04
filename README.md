# Nomi — Setup foundation

Node.js API skeleton and PostgreSQL setup gate. Production serves only the safe setup surface until the application launch mode is explicitly changed in a later, reviewed delivery.

## Run

```sh
npm run check
npm test
npm start
```

The local API binds to http://127.0.0.1:3000. `GET /health/live`, `GET /health/ready`, and `GET /v1/meta` are read-only. In setup mode, `GET /` serves the Arabic holding page. With `NODE_ENV=production`, `NOMI_LAUNCH_MODE=setup` is required and the server binds to `0.0.0.0` for Railway's `PORT`.

```sh
NODE_ENV=production NOMI_LAUNCH_MODE=setup PORT=3000 DATABASE_URL=... npm start
```

Readiness runs only `SELECT 1` against the injected `DATABASE_URL`. Missing or failed database access returns 503; a successful connection returns 200 while metadata still reports `applicationReady: false`. No migrations or schema writes run at startup.

## Development database

Copy .env.example to .env and set a local POSTGRES_PASSWORD, then run `docker compose up -d db`. Initial SQL runs only on a new volume. Do not delete existing volumes to apply schema changes. The bootstrap database role is for local initialization only.

## Status

The setup gate is intentionally not the application launch. Authentication, authorization, migrations, editorial publishing, worker execution, and provider integrations remain outside this safe hosting connection step. The editorial validator checks required evidence metadata; it does not establish factual correctness.
