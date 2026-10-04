# Nomi — Development foundation

Node.js 24 API skeleton and PostgreSQL development schema. Not production ready.

## Run

```sh
npm run check
npm test
npm start
```

API binds to http://127.0.0.1:3000 by default. GET /health/live, /health/ready, /v1/meta. Readiness returns 503 until database connectivity is implemented.

## Development database

Copy .env.example to .env and set a local POSTGRES_PASSWORD, then run `docker compose up -d db`. Initial SQL runs only on a new volume. Do not delete existing volumes to apply schema changes. The bootstrap database role is for local initialization only.

## Status

Seven local tests pass. Docker and PostgreSQL execution have not been tested in this environment. API database integration, authentication, authorization, migrations runner, editorial publishing transactions, worker execution and provider integrations remain to be implemented. No application deployment has been created. The editorial validator checks required evidence metadata; it does not establish factual correctness.
