CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('PASSENGER', 'DRIVER');
CREATE TYPE vehicle_status AS ENUM ('OFFLINE', 'ONLINE', 'ON_TRIP');
CREATE TYPE ride_status AS ENUM ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE pool_status AS ENUM ('MATCHING', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE payment_method AS ENUM ('CASH', 'TESLA_PAY');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  role user_role NOT NULL,
  wallet_balance_paisa integer NOT NULL DEFAULT 0 CHECK (wallet_balance_paisa >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  status vehicle_status NOT NULL DEFAULT 'OFFLINE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, driver_id)
);

CREATE TABLE ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pickup_zone varchar(40) NOT NULL,
  dropoff_zone varchar(40) NOT NULL,
  seats smallint NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 3),
  status ride_status NOT NULL DEFAULT 'REQUESTED',
  estimated_fare_paisa integer NOT NULL CHECK (estimated_fare_paisa >= 0),
  final_fare_paisa integer CHECK (final_fare_paisa IS NULL OR final_fare_paisa >= 0),
  payment_method payment_method NOT NULL DEFAULT 'CASH',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (pickup_zone <> dropoff_zone)
);

CREATE UNIQUE INDEX one_active_ride_per_passenger
  ON ride_requests(passenger_id)
  WHERE status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');

CREATE TABLE pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pickup_zone varchar(40) NOT NULL,
  status pool_status NOT NULL DEFAULT 'MATCHING',
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (vehicle_id, driver_id) REFERENCES vehicles(id, driver_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX one_active_pool_per_vehicle
  ON pools(vehicle_id)
  WHERE status IN ('MATCHING', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED');

CREATE TABLE pool_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  ride_request_id uuid NOT NULL UNIQUE REFERENCES ride_requests(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seats smallint NOT NULL CHECK (seats BETWEEN 1 AND 3),
  quoted_fare_paisa integer NOT NULL CHECK (quoted_fare_paisa >= 0),
  final_fare_paisa integer CHECK (final_fare_paisa IS NULL OR final_fare_paisa >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pool_id, passenger_id)
);

CREATE TABLE ride_events (
  id bigserial PRIMARY KEY,
  ride_request_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status ride_status,
  to_status ride_status NOT NULL,
  note varchar(240),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ride_request_id uuid REFERENCES ride_requests(id) ON DELETE SET NULL,
  amount_paisa integer NOT NULL,
  kind varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ride_requests_passenger_created_idx ON ride_requests(passenger_id, created_at DESC);
CREATE INDEX ride_requests_status_created_idx ON ride_requests(status, created_at);
CREATE INDEX pools_driver_status_idx ON pools(driver_id, status);
CREATE INDEX pool_members_pool_idx ON pool_members(pool_id);
CREATE INDEX ride_events_ride_created_idx ON ride_events(ride_request_id, created_at);
