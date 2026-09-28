# Dhaka Tesla Pool

**Share a seat. Split the fare. Survive Dhaka traffic.**

A full-stack ride-pooling MVP around three actors: passengers, drivers/Teslas, and pools. The implementation intentionally keeps geography simple and puts most of the engineering effort into state transitions, authorization, capacity integrity, auditable history, Docker reproducibility, and a clear passenger/driver UI.

## Demo accounts

All seeded users use `password123`.

| Name | Role | Email | Notes |
|---|---|---|---|
| Jashim | Driver | `jashim@tesla.dhaka` | Owns **Bullet**, capacity 3 |
| Nusrat | Passenger | `nusrat@tesla.dhaka` | Banani → Mohakhali demo |
| Rafiq | Passenger | `rafiq@tesla.dhaka` | Banani → Gulshan 1 demo |
| Shirin | Passenger | `shirin@tesla.dhaka` | Useful for last-seat concurrency testing |

## Features

- Passenger registration/login with an httpOnly JWT session cookie.
- Fare estimate before booking.
- Ride request with pickup, destination, seats, and Cash/TeslaPay choice.
- Automatic matching when an online Tesla is available.
- Waiting queue when no compatible Tesla is available; drivers can claim those requests later.
- Explicit lifecycle: `REQUESTED → MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED`, plus valid cancellation.
- Pooling rule that allows overlapping-but-not-identical trips.
- Database-enforced one-active-pool-per-vehicle rule plus transaction-level vehicle locking.
- Capacity derived from pool membership instead of a mutable `occupiedSeats` counter.
- Passenger-specific fare and status privacy.
- Ride event history for later explanation/audit.
- Driver online/offline toggle, waiting requests, pool membership, arrival/start/complete controls, and history API.
- Cash or simulated TeslaPay wallet settlement.

## Architecture

```mermaid
flowchart LR
  B[Browser] --> W[Next.js App Router]
  W -->|REST + cookie| A[Express API]
  A --> V[Zod validation]
  A --> S[Ride/Pool domain services]
  S -->|SQL transactions + row locks| P[(PostgreSQL)]
```

The backend is a single Node.js service. That keeps the MVP small enough to reason about while still giving transaction boundaries one clear owner.

### ERD

```mermaid
erDiagram
  USERS ||--o| VEHICLES : owns
  USERS ||--o{ RIDE_REQUESTS : requests
  USERS ||--o{ POOL_MEMBERS : rides_as
  VEHICLES ||--o{ POOLS : serves
  POOLS ||--o{ POOL_MEMBERS : contains
  RIDE_REQUESTS ||--o| POOL_MEMBERS : joins
  RIDE_REQUESTS ||--o{ RIDE_EVENTS : records
  USERS ||--o{ WALLET_TRANSACTIONS : has
  RIDE_REQUESTS ||--o{ WALLET_TRANSACTIONS : settles
```

## Matching rule

This MVP does not use a routing provider. A request can join an existing pool when:

1. the Tesla is `ONLINE`;
2. the pool is still `MATCHING` (the driver has not accepted it yet);
3. pickup zones are identical;
4. all destinations belong to the same predefined corridor; and
5. the sum of reserved seats plus the new request does not exceed vehicle capacity.

This intentionally matches Nusrat's **Banani → Mohakhali** ride with Rafiq's **Banani → Gulshan 1** ride because both destinations are in the `north-central` corridor.

## Fare model

All money is stored as **integer paisa** to avoid floating-point rounding errors.

```text
soloFare = baseFare + (routeUnits × perRouteUnitCharge)
pooledFare = soloFare × 80%   // only when pool has 2+ members
```

Constants:

- base fare: `4,500 paisa` = **৳45**
- per route unit: `1,800 paisa` = **৳18**
- pool discount: **20%**

Hand-checkable demo:

- Nusrat, Banani → Mohakhali: 2 route units → `45 + (2 × 18) = ৳81`; pooled final fare = **৳64.80**.
- Rafiq, Banani → Gulshan 1: 1 route unit → `45 + (1 × 18) = ৳63`; pooled final fare = **৳50.40**.

The quote stored at request time is the solo fare. The final fare is written only at completion, after the final pool member count is known.

## Concurrency and data integrity

Capacity is protected by a PostgreSQL transaction and a row lock on the selected vehicle. After acquiring the lock, the service re-reads the active pool and recomputes reserved seats from `pool_members`. Two simultaneous passengers can both see one seat available before the transaction begins, but only one transaction can reserve the final seat.

A partial unique index also prevents two active pools from existing for the same vehicle. This means capacity safety does not depend on an application-only mutex and still works if multiple API replicas are added later.

At larger scale, the same transaction boundary could be retained while candidate discovery moves to geospatial indexes/caching and matching work is partitioned by city/zone.

## Tech choices and alternatives

| Concern | Choice | Why it fits this MVP | Realistic alternative / switch point |
|---|---|---|---|
| Frontend | Next.js App Router + React | Required React-family stack, straightforward routing, production build | Plain React/Vite if SSR and file routing are unnecessary |
| API | Express + TypeScript | Small surface area, easy to inspect live, large ecosystem | Fastify/NestJS if schema-driven throughput or stronger framework structure becomes valuable |
| DB | PostgreSQL | Transactions, row locks, constraints, partial indexes suit pooling/capacity | MySQL is viable; SQLite becomes limiting for concurrent writers |
| Data access | `pg` + explicit SQL | Makes lock/transaction behavior visible and easy to explain | Prisma/Drizzle if CRUD volume grows and migrations/model generation outweigh explicit SQL benefits |
| Validation | Zod | Shared mental model for request validation | JSON Schema/Ajv for generated API schemas |
| Auth | JWT in httpOnly cookie | Simple stateless MVP session with XSS-resistant token storage | Server-side sessions if revocation/session administration becomes important |
| Styling | Plain CSS | No UI dependency; easy to inspect and customize | Tailwind/component library for a larger product/design system |
| Tests | Vitest | Fast TypeScript unit/integration tests | Node test runner/Jest based on team standards |
| Hosting | Docker-first | Reproducible and provider-neutral | A free-tier container host if one is available at submission time |

## Project structure

```text
.
├── apps
│   ├── api
│   │   ├── migrations/001_init.sql
│   │   ├── scripts/{migrate,seed}.ts
│   │   ├── src
│   │   │   ├── domain
│   │   │   ├── middleware
│   │   │   ├── routes
│   │   │   └── services
│   │   └── tests
│   └── web
│       ├── app
│       └── lib
├── .env.example
├── docker-compose.yml
└── README.md
```

## Run with Docker

Prerequisite: Docker with Compose v2.

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

The API container runs migrations and idempotent seed data before starting.

## Run without Docker

Prerequisites: Node.js 22+ and PostgreSQL 16+.

```bash
npm install
cp .env.example .env
# change DATABASE_URL in .env so the host is localhost
npm --workspace apps/api run migrate
npm --workspace apps/api run seed
npm run dev:api
# second terminal
npm run dev:web
```

## Tests

Unit tests cover fare calculations, route compatibility, and invalid state transitions.

```bash
npm test
npm run typecheck
npm run build
```

The concurrency integration test uses a real PostgreSQL instance:

```bash
docker compose --profile test up -d test-db
cd apps/api
DATABASE_URL=postgresql://tesla:tesla@localhost:5433/dhaka_tesla_test npm run migrate
RUN_DB_TESTS=true DATABASE_URL=postgresql://tesla:tesla@localhost:5433/dhaka_tesla_test npm test -- concurrency.integration.test.ts
```

That test fills two of Bullet's three seats and fires two one-seat requests concurrently. Exactly one may be matched; total reserved seats must remain 3.

## API overview

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register passenger/driver |
| `POST` | `/auth/login` | Public | Sign in |
| `POST` | `/auth/logout` | Any | Clear session |
| `GET` | `/auth/me` | Any | Current account |
| `GET` | `/rides/zones` | Any | Supported zones + fare constants |
| `POST` | `/rides/estimate` | Any | Fare preview |
| `POST` | `/rides` | Passenger | Request ride + attempt auto-match |
| `GET` | `/rides` | Passenger | Own ride history |
| `GET` | `/rides/:id` | Owner/assigned driver | Ride + audit events |
| `POST` | `/rides/:id/cancel` | Passenger | Cancel while valid |
| `GET` | `/driver/vehicle` | Driver | Tesla status |
| `POST` | `/driver/online` | Driver | Go online |
| `POST` | `/driver/offline` | Driver | Go offline if safe |
| `GET` | `/driver/waiting-requests` | Driver | Unmatched requests |
| `POST` | `/driver/waiting-requests/:rideId/match` | Driver | Claim a compatible waiting request |
| `GET` | `/driver/pools` | Driver | Active pools with passengers |
| `POST` | `/driver/pools/:id/accept` | Driver | Accept pool |
| `POST` | `/driver/pools/:id/arrive` | Driver | Mark driver arrived |
| `POST` | `/driver/pools/:id/start` | Driver | Start trip |
| `POST` | `/driver/pools/:id/complete` | Driver | Complete and settle fares |
| `GET` | `/driver/history` | Driver | Completed/cancelled pools |

## Security notes

- Passwords are hashed with bcrypt.
- JWT is stored in an httpOnly cookie.
- CORS is restricted to `WEB_ORIGIN` and requests use credentials.
- Helmet is enabled and the API has a basic rate limiter.
- Authorization is checked server-side on ride and driver actions.
- No secrets are committed; `.env` is ignored.

For a production deployment where web and API are on different sites, cookie settings and CSRF protection should be revisited together rather than simply changing `SameSite`.

## Screenshots / GIFs

Add real screenshots or a short GIF from the running build here before submission. This repository does not include fabricated screenshots. Recommended captures: passenger request + fare estimate, driver pool with Nusrat/Rafiq, and the completed passenger history state.

## Deployment

**Public URL:** _add after deploying to a free/free-tier provider._

The Docker setup is the reproducible fallback if a free backend host is unavailable.

## Known limitations / next improvements

- No real routing, ETA, map, or geospatial search.
- No WebSocket/SSE updates; dashboards refresh on demand.
- No password-reset/email-verification flow.
- TeslaPay is simulated and does not connect to a payment gateway.
- A driver has exactly one Tesla in the MVP.
- Pool matching is intentionally deterministic and local, not globally optimized.
- Production deployment URL and screenshots should be added after deployment.

## If it grows to 1M passengers / 100k drivers

Keep the API stateless behind a load balancer; partition matching by geography; add PostGIS for candidate search; cache slowly changing zone/vehicle metadata; move non-critical notifications/audit fan-out to a queue; add idempotency keys to mutation endpoints; add read replicas for history; keep capacity reservations in strongly consistent transactions; instrument p95/p99 latency, lock waits, matching failures, and state-transition errors; use structured logs/traces; and apply per-user/device rate limits.

```mermaid
flowchart LR
  C[Clients] --> LB[Load balancer]
  LB --> API1[API replicas]
  LB --> API2[API replicas]
  API1 --> PG[(Primary Postgres + PostGIS)]
  API2 --> PG
  PG --> RR[(Read replicas)]
  API1 --> CACHE[(Cache)]
  API2 --> CACHE
  API1 --> Q[Queue / events]
  API2 --> Q
  Q --> N[Notifications / async workers]
```

## Git workflow

Recommended repository flow:

```text
feature/* → master → pre-release → release/v1.0.0
```

Commit format:

```text
<type>(<scope>): <short description>
```

Examples: `feat(pool): lock vehicle before reserving seats`, `test(pool): cover concurrent last-seat claims`, `build(docker): add database health check`.

## AI Usage

The challenge brief requires an accurate AI-usage disclosure. Before submission, replace this paragraph with the tools actually used, what each tool was used for, one suggestion that was accepted, and one suggestion that was rejected or changed. Do not claim that no AI tooling was used if that would be inaccurate.

## Demo video

Add the final ≤6 minute demo-video URL here before submission.
