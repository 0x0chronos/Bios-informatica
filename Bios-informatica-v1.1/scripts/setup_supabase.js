'use strict';
// Historical import utility. It is not required to update an existing deployment.
if(process.env.BIOS_RUN_LEGACY_IMPORT !== 'reviewed') throw new Error('Importação legada desativada. Não execute no banco em uso. Revise backup e destino separado antes de definir BIOS_RUN_LEGACY_IMPORT=reviewed.');
const { Client } = require('pg');

require('dotenv').config();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Defina DATABASE_URL no ambiente.');

const ddl = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  doc TEXT,
  city TEXT,
  neighborhood TEXT,
  address TEXT,
  obs TEXT,
  created TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  "desc" TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  "publicCode" TEXT UNIQUE,
  "clientId" TEXT NOT NULL REFERENCES clients(id),
  device TEXT NOT NULL,
  brand TEXT,
  "serviceId" TEXT NOT NULL REFERENCES services(id),
  status TEXT DEFAULT 'recebido',
  value DOUBLE PRECISION DEFAULT 0,
  problem TEXT,
  solution TEXT,
  "payStatus" TEXT DEFAULT 'pendente',
  "payMethod" TEXT,
  "dueDate" TEXT,
  "payDate" TEXT,
  "payObs" TEXT,
  created TEXT,
  updated TEXT,
  "trackingToken" TEXT UNIQUE,
  "quoteVersion" INTEGER NOT NULL DEFAULT 0,
  "quoteDescription" TEXT NOT NULL DEFAULT '',
  "quoteEnabled" INTEGER NOT NULL DEFAULT 0,
  "approvedVersion" INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  "authVersion" INTEGER NOT NULL DEFAULT 0,
  "mustChange" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  created TEXT NOT NULL,
  actor TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES orders(id),
  version INTEGER NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  description TEXT NOT NULL,
  created TEXT NOT NULL,
  UNIQUE("orderId", version)
);

CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders("trackingToken");
CREATE INDEX IF NOT EXISTS idx_orders_public_code ON orders("publicCode");
`;

(async () => {
  console.log('Connecting to Supabase PostgreSQL...');
  const client = new Client({ connectionString, ...require('./database').postgresOptions(connectionString) });
  await client.connect();
  console.log('Connected! Executing DDL...');
  await client.query(ddl);
  console.log('Tables and indexes created successfully in Supabase PostgreSQL!');

  const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('Public tables in Supabase:', tables.rows.map(r => r.table_name));
  await client.end();
})().catch(err => {
  console.error('Error setting up Supabase schema:', err);
  process.exit(1);
});
