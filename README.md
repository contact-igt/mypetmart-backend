# MyPetMart Backend

MyPetMart backend is the standalone Node.js and Express API for the customer storefront and admin panel.

## Locked Stack

- Runtime: Node.js 24 LTS
- Framework: Express 5
- Language: TypeScript
- Module system: ES modules
- Database target: MySQL 8.4
- ORM target: Sequelize with Umzug-backed migrations and later Sequelize seeders
- Image storage target: Cloudflare R2
- API base path: `/api/v1`

## Stage 5 Capabilities

- Express application foundation with versioned `/api/v1` routing
- Liveness and readiness health endpoints
- Typed environment validation with Zod
- CORS allowlist for storefront and admin origins
- One central Sequelize/MySQL connection
- Eighteen registered Sequelize model classes and associations
- Explicit Umzug migration runner using SequelizeStorage table `SequelizeMeta`
- Eighteen initial MySQL migrations for the approved business tables
- Read-only schema verifier for tables, columns, indexes, FKs, checks, generated helper columns, and pending migrations
- MySQL advisory migration lock: `mypetmart_schema_migrations`
- Local rollback drill command with production block and required confirmation flag
- No automatic schema synchronization or startup migrations
- No seed data, auth, business APIs, R2, payment, shipping, or Swagger/OpenAPI yet

## Registered Tables

1. users
2. auth_sessions
3. addresses
4. categories
5. products
6. product_variants
7. product_images
8. carts
9. cart_items
10. orders
11. order_items
12. order_notes
13. payments
14. shipments
15. return_requests
16. return_notes
17. contact_enquiries
18. store_settings

## Requirements

- Node.js `>=24 <25`
- npm
- Local MySQL compatible with the architecture target, MySQL 8.4

## Environment

Use `.env.example` as the template. The local `.env` file is intentionally ignored by Git.

Required Stage 5 values:

```bash
NODE_ENV=development
PORT=5000
LOG_LEVEL=info
REQUEST_BODY_LIMIT=1mb
STOREFRONT_ORIGIN=http://localhost:3000
ADMIN_ORIGIN=http://localhost:4000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=mypetmart
DB_USER=root
DB_PASSWORD=
DB_LOGGING=false
DB_POOL_MAX=10
DB_POOL_MIN=0
DB_POOL_ACQUIRE_MS=30000
DB_POOL_IDLE_MS=10000
```

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
npm run db:check
npm run db:migrate:status
npm run db:migrate
npm run db:schema:verify
npm run test:migrations
```

Rollback commands for a local/disposable database only:

```bash
npm run db:migrate:down
npm run db:migrate:down:all -- --confirm-local-schema-reset
npm run db:schema:verify -- --expect-empty
```

`db:migrate:down:all` is blocked when `NODE_ENV=production`, requires the confirmation flag, verifies the connected database name, rejects unexpected tables, and drops `SequelizeMeta` after all Stage 5 tables are reverted.

## Migration Operations

Migrations are explicit operator commands. Backend startup authenticates the database but does not call `sequelize.sync()`, does not call Umzug, and does not mutate schema.

The migration runner uses:

- `umzug`
- Sequelize query interface context
- `SequelizeStorage` with metadata table `SequelizeMeta`
- MySQL advisory lock `mypetmart_schema_migrations`

Production migration checklist:

1. Confirm the target database and release version.
2. Take a database backup or snapshot.
3. Run `npm run db:migrate:status`.
4. Run `npm run db:migrate` during the approved deployment window.
5. Run `npm run db:schema:verify`.
6. Keep rollback SQL/down-migration plan and backup restore procedure ready before applying changes.

## Stage 5 Schema Decisions

Migration-owned generated helper columns are internal physical constraints, not public API fields:

- `addresses.default_user_id`: enforces one default address per user while allowing multiple non-default addresses.
- `product_images.primary_product_id`: enforces one primary image per product while allowing multiple non-primary images.
- `cart_items.variant_identity`: normalizes nullable variants for exact cart-line uniqueness.

Historical order item references use `ON DELETE SET NULL` for optional `product_id` and `product_variant_id` so immutable purchase snapshots survive catalog hard deletes. Audit/history tables use restrictive delete behavior. Cart items cascade only with their cart lifecycle.

## Health Endpoints

```http
GET /api/v1/health
GET /api/v1/health/ready
```

Readiness authenticates the configured MySQL connection and reports the configured database name without exposing credentials.

## Database Directory Structure

```text
src/database/
  index.ts
  associations.ts
  commands/
  migrations/
  tables/
```

## Current Limitations

- No seeders or seed data are implemented yet.
- Authentication is not implemented yet.
- Cloudflare R2 is not implemented yet.
- Payment and shipping providers are not implemented yet.
- Swagger/OpenAPI is not implemented yet.
- Category/product/cart/order/return/contact/settings APIs are not implemented yet.

## Next Stage

Stage 6, Seeders.
