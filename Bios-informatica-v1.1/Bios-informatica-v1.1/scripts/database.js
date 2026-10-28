'use strict';
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

// Translate SQL tokens only; leave values, comments and quoted identifiers intact.
function toPgSql(sql) {
  let index = 0;
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\b/i.test(sql);
  let translated = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\bINSERT\s+OR\s+IGNORE\b|\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b|\bBEGIN IMMEDIATE\b|\?|\b[A-Za-z_][A-Za-z_0-9]*\b/g, token => {
    if (/^INSERT\s+OR\s+IGNORE$/i.test(token)) return 'INSERT';
    if (/^INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT$/i.test(token)) return 'SERIAL PRIMARY KEY';
    if (/^BEGIN IMMEDIATE$/i.test(token)) return 'BEGIN';
    if (token === '?') return '$' + (++index);
    if (/^['"]|^--|^\/\*/.test(token)) return token;
    if (token === 'desc' || /[a-z][A-Z]/.test(token)) return '"' + token + '"';
    if (token.toUpperCase() === 'REAL') return 'DOUBLE PRECISION';
    return token;
  });
  if (ignore) translated = translated.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  return translated;
}
function postgresOptions(url) {
  const parsed = new URL(url);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) parsed.searchParams.delete(key);
  return { connectionString: parsed.toString(), ssl: process.env.DB_SSL === 'false' ? false : {
    rejectUnauthorized: true,
    ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {})
  }};
}
function postgresStore(pool) {
  const scope = new AsyncLocalStorage();
  const query = (sql, args = []) => (scope.getStore() || pool).query(toPgSql(sql), args);
  const columns = sql => {
    const match = sql.match(/^\s*PRAGMA table_info\(([A-Za-z_][A-Za-z_0-9]*)\)/i);
    return match && match[1];
  };
  const tableInfo = name => query("SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name=?", [name]);
  const pragma = sql => /^\s*PRAGMA\s+(foreign_keys|journal_mode|busy_timeout|user_version)\b/i.test(sql);
  const store = {
    isPostgres: true,
    async run(sql, args = []) {
      if (pragma(sql)) return { changes: 0, lastID: null };
      if (/^\s*(VACUUM|PRAGMA)/i.test(sql)) throw new Error('Operação SQLite indisponível no PostgreSQL. Use backup próprio do PostgreSQL.');
      const res = await query(sql, args);
      return { changes: res.rowCount, lastID: null };
    },
    async get(sql, args = []) {
      if (/^\s*PRAGMA user_version\b/i.test(sql)) return { user_version: 1 };
      if (columns(sql)) return (await tableInfo(columns(sql))).rows[0];
      if (/^\s*PRAGMA/i.test(sql)) throw new Error('Verificação SQLite indisponível no PostgreSQL.');
      return (await query(sql, args)).rows[0];
    },
    async all(sql, args = []) {
      if (columns(sql)) return (await tableInfo(columns(sql))).rows;
      return (await query(sql, args)).rows;
    },
    async exec(sql) {
      const statements = sql.match(/(?:'(?:''|[^'])*'|"(?:""|[^"])*"|[^;'"\n]+|\n)+;?/g) || [];
      for (const statement of statements) {
        const s = statement.trim();
        if (!s || pragma(s)) continue;
        await query(s);
      }
    },
    async transaction(action) {
      if (scope.getStore()) throw new Error('Transação aninhada não suportada.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await scope.run(client, action);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end()
  };
  return store;
}
async function openDatabase(target, { driver } = {}) {
  const url = driver === 'sqlite' ? null : process.env.DATABASE_URL || (/^postgres(?:ql)?:\/\//.test(target || '') ? target : null);
  if (url) return postgresStore(new Pool(postgresOptions(url)));
  const db = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(target, err => err ? reject(err) : resolve(d));
  });
  const store = {
    isPostgres: false,
    run: (sql, args = []) => new Promise((resolve, reject) => {
      db.run(sql, args, function(err) { if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID }); });
    }),
    get: (sql, args = []) => new Promise((resolve, reject) => { db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)); }),
    all: (sql, args = []) => new Promise((resolve, reject) => { db.all(sql, args, (err, rows) => err ? reject(err) : resolve(rows)); }),
    exec: sql => new Promise((resolve, reject) => { db.exec(sql, err => err ? reject(err) : resolve()); }),
    close: () => new Promise((resolve, reject) => { db.close(err => err ? reject(err) : resolve()); }),
    async transaction(action) {
      await store.run('BEGIN IMMEDIATE');
      try { const value = await action(); await store.run('COMMIT'); return value; }
      catch (error) { await store.run('ROLLBACK'); throw error; }
    }
  };
  return store;
}
module.exports = { openDatabase, toPgSql, postgresStore, postgresOptions };
