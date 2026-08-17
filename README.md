# MyPetMart Backend

MyPetMart backend is the standalone Node.js and Express API for the customer storefront and admin panel.

## Locked Stack

- Runtime: Node.js 24 LTS
- Framework: Express 5
- Language: TypeScript
- Module system: ES modules
- Database target: MySQL 8.4
- ORM target: Sequelize with Umzug-backed migrations and seeders
- Image storage target: Cloudflare R2
- API base path: `/api/v1`

## Stage 6 Capabilities

- Express application foundation with versioned `/api/v1` routing
- Liveness and readiness health endpoints
- Typed environment validation with Zod
- CORS allowlist for storefront and admin origins
- One central Sequelize/MySQL connection
- Eighteen registered Sequelize model classes and associations
- Explicit Umzug migration runner using SequelizeStorage table `SequelizeMeta`
- Eighteen initial MySQL migrations for the approved business tables
- Read-only schema verifier for tables, columns, indexes, FKs, checks, generated helper columns, pending migrations, and optional seeder metadata
- MySQL advisory migration lock: `mypetmart_schema_migrations`
- Local migration rollback drill command with production block and required confirmation flag
- Secure bootstrap admin seeder using ignored environment values, bcrypt hashing, Umzug metadata table `SequelizeSeedMeta`, and MySQL advisory seeder lock `mypetmart_data_seeders`
- Seeder status, up, down, and local down-all commands with production rollback blocks
- No automatic schema synchronization, startup migrations, or startup seeders
- No catalog seed data, auth APIs, business APIs, R2, payment, shipping, or Swagger/OpenAPI yet

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

Seeder metadata uses `SequelizeSeedMeta`; migration metadata uses `SequelizeMeta`.

## Requirements

- Node.js `>=24 <25`
- npm
- Local MySQL compatible with the architecture target, MySQL 8.4

## Environment

Use `.env.example` as the template. The local `.env` file is intentionally ignored by Git.

Required values:

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

Bootstrap admin seeding also requires local ignored values before `npm run db:seed` can apply the seeder:

```bash
SEED_SUPER_ADMIN_NAME=Admin
SEED_SUPER_ADMIN_EMAIL=admin@example.com
SEED_SUPER_ADMIN_PASSWORD=StrongPassword#123
ALLOW_PRODUCTION_SEED=false
```

Do not commit real seed admin names, emails, passwords, or generated password hashes. The seeder reads them only from local environment, validates password strength, lowercases the email, and stores only a bcrypt hash.

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
npm run db:seed:status
npm run db:seed
npm run test:seeders
```

Rollback commands for a local/disposable database only:

```bash
npm run db:migrate:down
npm run db:migrate:down:all -- --confirm-local-schema-reset
npm run db:schema:verify -- --expect-empty
npm run db:seed:down
npm run db:seed:down:all -- --confirm-local-seed-reset
```

`db:migrate:down:all` is blocked when `NODE_ENV=production`, requires the confirmation flag, verifies the connected database name, rejects unexpected tables, and drops `SequelizeMeta` after all Stage 5 tables are reverted.

Seeder rollback commands are blocked in production, verify the connected database name, and only remove the owned bootstrap admin when the seeder metadata and safety checks match.

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

## Seeder Operations

Seeders are explicit operator commands. Backend startup does not run seeders.

The seeder runner uses:

- `umzug`
- Sequelize query interface context
- `SequelizeStorage` with metadata table `SequelizeSeedMeta`
- MySQL advisory lock `mypetmart_data_seeders`
- `bcrypt` for bootstrap admin password hashing

`npm run db:seed` is blocked in production unless `ALLOW_PRODUCTION_SEED=true`. Seeder rollback remains blocked in production.

The bootstrap admin seeder creates one active admin user from `SEED_ADMIN_*` values. It is idempotent when the existing admin row already matches the configured ID, normalized email, role, and status. It fails safely on ID/email conflicts, non-admin role conflicts, disabled admin conflicts, missing seed config, pending migrations, and unsafe rollback dependencies.

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
  seeders/
  tables/
```

## Current Limitations

- Live local bootstrap admin seed has not been applied until ignored `.env` contains `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`.
- Authentication is not implemented yet.
- Cloudflare R2 is not implemented yet.
- Payment and shipping providers are not implemented yet.
- Swagger/OpenAPI is not implemented yet.
- Category/product/cart/order/return/contact/settings APIs are not implemented yet.
- Catalog/product/order demo seed data is not implemented yet.

## Next Stage

Fill local ignored bootstrap admin seed values and rerun the Stage 6 live seeding drill; after that, continue to Stage 8, Standard API responses.
