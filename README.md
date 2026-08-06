# MyPetMart Backend

MyPetMart backend is the standalone Node.js and Express API for the customer storefront and admin panel.

## Locked Stack

- Runtime: Node.js 24 LTS
- Framework: Express 5
- Language: TypeScript
- Module system: ES modules
- Database target: MySQL 8.4
- ORM target: Sequelize with migrations and seeders
- Image storage target: Cloudflare R2
- API base path: `/api/v1`

## Stage 2 Capabilities

- Express application foundation
- Versioned `/api/v1` routing
- Liveness health endpoint
- Request ID middleware
- Helmet security headers
- Compression
- `1mb` JSON and URL-encoded request body limits
- Pino structured HTTP logging
- Standard success and error response shape
- Safe not-found and central error handling
- Graceful HTTP server shutdown
- Linting, strict type-checking, tests, and production build

## Requirements

- Node.js `>=24 <25`
- npm

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
npm run verify
```

## Health Endpoint

```http
GET /api/v1/health
```

Example response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "mypetmart-backend",
    "version": "0.1.0",
    "timestamp": "2026-08-06T00:00:00.000Z"
  },
  "meta": {
    "requestId": "..."
  }
}
```

## Current Folder Structure

```text
src/
  app.ts
  server.ts
  constants/
  middlewares/
  models/HealthModels/
  routes/v1/
  types/
  utils/
tests/
```

## Request Flow

```text
Express app
  -> helmet
  -> compression
  -> body parsers
  -> request ID
  -> structured HTTP logger
  -> /api/v1 routes
  -> not-found middleware
  -> error middleware
```

## Current Limitations

- MySQL and Sequelize are not implemented yet.
- Authentication is not implemented yet.
- Cloudflare R2 is not implemented yet.
- Payment and shipping are not implemented yet.
- Swagger/OpenAPI is not implemented yet.
- CORS and typed environment validation belong to Stage 3.
- Sequelize migrations will be used instead of production `sequelize.sync()`.

## Next Stage

Stage 3, Environment and Configuration.

Git initialization, remote configuration, and the initial commit will happen after this verified foundation is reviewed.
