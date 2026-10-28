'use strict';
// Historical import utility. It is not required to update an existing deployment.
if(process.env.BIOS_RUN_LEGACY_IMPORT !== 'reviewed') throw new Error('Importação legada desativada. Não execute no banco em uso. Revise backup e destino separado antes de definir BIOS_RUN_LEGACY_IMPORT=reviewed.');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();

const scratch = process.cwd();
const sqlitePath = process.env.DB_PATH || path.join(scratch, 'homologacao.sqlite');

require('dotenv').config();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Defina DATABASE_URL no ambiente.');

function generatePublicCode() {
  return 'BIOS-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

async function runMigration() {
  console.log('--- Iniciando Migração para Supabase PostgreSQL ---');
  console.log('Origem SQLite:', sqlitePath);

  // 1. Abrir SQLite
  const sdb = await new Promise((res, rej) => {
    const d = new sqlite3.Database(sqlitePath, err => err ? rej(err) : res(d));
  });
  const sAll = (q, args = []) => new Promise((res, rej) => sdb.all(q, args, (err, rows) => err ? rej(err) : res(rows)));

  // 2. Conectar Postgres
  const pg = new Client({ connectionString, ...require('./database').postgresOptions(connectionString) });
  await pg.connect();
  console.log('Conectado com sucesso ao Supabase PostgreSQL!');

  // 3. Migrar Clientes
  const clients = await sAll('SELECT * FROM clients');
  console.log(`Migrando ${clients.length} clientes...`);
  for (const c of clients) {
    await pg.query(`
      INSERT INTO clients (id, name, phone, email, doc, city, neighborhood, address, obs, created)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        doc = EXCLUDED.doc,
        city = EXCLUDED.city,
        neighborhood = EXCLUDED.neighborhood,
        address = EXCLUDED.address,
        obs = EXCLUDED.obs
    `, [c.id, c.name, c.phone, c.email, c.doc, c.city, c.neighborhood, c.address, c.obs, c.created]);
  }

  // 4. Migrar Serviços
  const services = await sAll('SELECT * FROM services');
  console.log(`Migrando ${services.length} serviços...`);
  for (const s of services) {
    await pg.query(`
      INSERT INTO services (id, name, category, price, "desc")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        price = EXCLUDED.price,
        "desc" = EXCLUDED."desc"
    `, [s.id, s.name, s.category, s.price, s.desc]);
  }

  // 5. Migrar Usuários
  const users = await sAll('SELECT * FROM users');
  console.log(`Migrando ${users.length} usuários...`);
  for (const u of users) {
    await pg.query(`
      INSERT INTO users (username, password, "authVersion", "mustChange")
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO UPDATE SET
        password = EXCLUDED.password,
        "authVersion" = EXCLUDED."authVersion",
        "mustChange" = EXCLUDED."mustChange"
    `, [u.username, u.password, u.authVersion || 0, u.mustChange || 0]);
  }

  // 6. Migrar Contadores
  const counters = await sAll('SELECT * FROM counters');
  console.log(`Migrando ${counters.length} contadores...`);
  for (const cnt of counters) {
    await pg.query(`
      INSERT INTO counters (name, value)
      VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET
        value = GREATEST(counters.value, EXCLUDED.value)
    `, [cnt.name, cnt.value]);
  }

  // 7. Migrar Ordens de Serviço (garantindo publicCode)
  const cols = await sAll("PRAGMA table_info(orders)");
  if (!cols.some(c => c.name === 'publicCode')) {
    await new Promise((res, rej) => sdb.run("ALTER TABLE orders ADD COLUMN publicCode TEXT", err => err ? rej(err) : res()));
  }
  const orders = await sAll('SELECT * FROM orders');
  console.log(`Migrando ${orders.length} ordens de serviço...`);
  for (const o of orders) {
    let pCode = o.publicCode;
    if (!pCode) {
      pCode = generatePublicCode();
      // Atualiza também no SQLite para manter paridade
      sdb.run('UPDATE orders SET publicCode = ? WHERE id = ?', [pCode, o.id]);
    }

    await pg.query(`
      INSERT INTO orders (
        id, "publicCode", "clientId", device, brand, "serviceId",
        status, value, problem, solution, "payStatus", "payMethod",
        "dueDate", "payDate", "payObs", created, updated,
        "trackingToken", "quoteVersion", "quoteDescription", "quoteEnabled", "approvedVersion"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22
      )
      ON CONFLICT (id) DO UPDATE SET
        "publicCode" = COALESCE(orders."publicCode", EXCLUDED."publicCode"),
        status = EXCLUDED.status,
        value = EXCLUDED.value,
        problem = EXCLUDED.problem,
        solution = EXCLUDED.solution,
        "payStatus" = EXCLUDED."payStatus",
        "payMethod" = EXCLUDED."payMethod",
        "dueDate" = EXCLUDED."dueDate",
        "payDate" = EXCLUDED."payDate",
        "payObs" = EXCLUDED."payObs",
        updated = EXCLUDED.updated,
        "trackingToken" = EXCLUDED."trackingToken",
        "quoteVersion" = EXCLUDED."quoteVersion",
        "quoteDescription" = EXCLUDED."quoteDescription",
        "quoteEnabled" = EXCLUDED."quoteEnabled",
        "approvedVersion" = EXCLUDED."approvedVersion"
    `, [
      o.id, pCode, o.clientId, o.device, o.brand, o.serviceId,
      o.status, o.value || 0, o.problem, o.solution, o.payStatus, o.payMethod,
      o.dueDate, o.payDate, o.payObs, o.created, o.updated,
      o.trackingToken, o.quoteVersion || 0, o.quoteDescription || '', o.quoteEnabled || 0, o.approvedVersion
    ]);
  }

  // 8. Migrar Eventos de OS
  const events = await sAll('SELECT * FROM order_events');
  console.log(`Migrando ${events.length} eventos de histórico...`);
  for (const ev of events) {
    await pg.query(`
      INSERT INTO order_events ("orderId", status, created, actor)
      VALUES ($1, $2, $3, $4)
    `, [ev.orderId, ev.status, ev.created, ev.actor]);
  }

  // 9. Migrar Aprovações
  const approvals = await sAll('SELECT * FROM approvals');
  console.log(`Migrando ${approvals.length} aprovações...`);
  for (const ap of approvals) {
    await pg.query(`
      INSERT INTO approvals ("orderId", version, value, description, created)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("orderId", version) DO NOTHING
    `, [ap.orderId, ap.version, ap.value, ap.description, ap.created]);
  }

  // 10. Validação final de contagens
  const checkClients = await pg.query('SELECT COUNT(*) n FROM clients');
  const checkServices = await pg.query('SELECT COUNT(*) n FROM services');
  const checkOrders = await pg.query('SELECT COUNT(*) n FROM orders');
  const checkUsers = await pg.query('SELECT COUNT(*) n FROM users');

  console.log('--- Migração Concluída com Sucesso! ---');
  console.log('Validação no Supabase PostgreSQL:');
  console.log(`- Clientes: ${checkClients.rows[0].n} (SQLite: ${clients.length})`);
  console.log(`- Serviços: ${checkServices.rows[0].n} (SQLite: ${services.length})`);
  console.log(`- Ordens de Serviço: ${checkOrders.rows[0].n} (SQLite: ${orders.length})`);
  console.log(`- Usuários: ${checkUsers.rows[0].n} (SQLite: ${users.length})`);

  await pg.end();
  await new Promise(r => sdb.close(r));
}

runMigration().catch(err => {
  console.error('Falha na migração:', err);
  process.exit(1);
});
