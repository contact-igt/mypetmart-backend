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

## Stage 4 Capabilities

- Express application foundation
- Versioned `/api/v1` routing
- Liveness and readiness health endpoints
- Typed environment validation with Zod
- CORS allowlist for storefront and admin origins
- One central Sequelize/MySQL connection
- Central Sequelize model initialization
- Central Sequelize association initialization
- Eighteen registered Sequelize model classes
- Explicit table names, snake_case columns, timestamp policy, paranoid policy, enum constants, validation metadata, and index metadata
- Sensitive model serialization protection for password/session/cart token hashes
- Server startup initializes model metadata, authenticates MySQL, then listens
- No automatic schema synchronization
- No migrations or seeders yet
- No CRUD/business APIs yet

## Registered Models

1. User
2. AuthSession
3. Address
4. Category
5. Product
6. ProductVariant
7. ProductImage
8. Cart
9. CartItem
10. Order
11. OrderItem
12. OrderNote
13. Payment
14. Shipment
15. ReturnRequest
16. ReturnNote
17. ContactEnquiry
18. StoreSetting

## Requirements

- Node.js `>=24 <25`
- npm
- Local MySQL compatible with the architecture target, MySQL 8.4

## Environment

Use `.env.example` as the template. The local `.env` file is intentionally ignored by Git.

Required Stage 4 values:

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
```

## Health Endpoints

```http
GET /api/v1/health
GET /api/v1/health/ready
```

Readiness authenticates the configured MySQL connection and reports the configured database name without exposing credentials.

## Database Model Directory Structure

```text
src/database/
  index.ts
  associations.ts
  tables/
    index.ts
    UserTable/
    AuthSessionTable/
    AddressTable/
    CategoryTable/
    ProductTable/
    ProductVariantTable/
    ProductImageTable/
    CartTable/
    CartItemTable/
    OrderTable/
    OrderItemTable/
    OrderNoteTable/
    PaymentTable/
    ShipmentTable/
    ReturnRequestTable/
    ReturnNoteTable/
    ContactEnquiryTable/
    StoreSettingTable/
```

## Model Definitions vs Migrations

Stage 4 model definitions describe the application-side Sequelize metadata: attributes, validation, indexes, table names, timestamps, paranoid behavior, and associations.

They do not create MySQL tables or indexes. Physical schema changes belong to Stage 5 migrations. Backend startup must never call `sequelize.sync()`.

The local database remains connected and schema-empty unless it already contained unrelated tables.

## Startup Flow

```text
load .env if present
  -> validate typed environment
  -> create one Sequelize instance
  -> initialize model metadata
  -> initialize associations
  -> authenticate MySQL connection
  -> start HTTP listener
  -> shutdown closes HTTP server and Sequelize
```

## Current Limitations

- No database tables have been created by the backend.
- No migrations or seeders are implemented yet.
- Authentication is not implemented yet.
- Cloudflare R2 is not implemented yet.
- Payment and shipping providers are not implemented yet.
- Swagger/OpenAPI is not implemented yet.
- Category/product/cart/order/return/contact/settings APIs are not implemented yet.

## Next Stage

Stage 5, Initial Sequelize migrations.