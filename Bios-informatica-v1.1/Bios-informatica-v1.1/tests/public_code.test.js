'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bios-publiccode-tests-'));
const dbPath = path.join(temp, 'database.sqlite');
let child, base, cookie;
const password = 'UmaSenhaDeTeste-' + crypto.randomBytes(8).toString('hex');

async function call(route, { method = 'GET', body, auth = true, origin, header = true } = {}) {
  const headers = {};
  if (auth && cookie) headers.cookie = cookie;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    if (header) headers['X-Bios-Request'] = '1';
  }
  if (origin) headers.origin = origin;
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { res, data };
}

async function login(user = 'admin', pass = password) {
  const { res, data } = await call('/api/login', { method: 'POST', body: { username: user, password: pass }, auth: false });
  assert.equal(res.status, 200, JSON.stringify(data));
  const set = res.headers.get('set-cookie');
  cookie = set.split(';')[0];
  return data;
}

async function boot(database, extra = {}) {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env, DATABASE_URL: '', NODE_ENV: 'test',
      PORT: '18762',
      JWT_SECRET: crypto.randomBytes(40).toString('hex'),
      SITE_URL: 'http://127.0.0.1:18762',
      COOKIE_SECURE: 'false',
      DB_PATH: database,
      ...extra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = 'http://127.0.0.1:18762';
  let output = '';
  child.stdout.on('data', x => output += x);
  child.stderr.on('data', x => output += x);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout: ' + output)), 15000);
    const check = () => {
      if (output.includes('Bios disponível')) {
        clearTimeout(timer);
        resolve();
      } else if (child.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error(output));
      } else setTimeout(check, 30);
    };
    check();
  });
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(r => child.once('exit', r));
  child = null;
}

test('Bios: publicCode aleatório, imutabilidade e consultas', { timeout: 60000 }, async t => {
  t.after(async () => {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  await boot(dbPath, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password });
  await login();

  const c = await call('/api/clients', { method: 'POST', body: { name: 'Cliente Código OS', phone: '(13) 98888-7777' } });
  const s = await call('/api/services', { method: 'POST', body: { name: 'Troca de SSD', category: 'Notebook', price: 250, desc: 'Instalação' } });

  let orderId, publicCode, trackingToken;

  await t.test('Criação da OS gera publicCode único no formato BIOS-XXXXXXXXXXXX', async () => {
    const res = await call('/api/orders', {
      method: 'POST',
      body: {
        clientId: c.data.id,
        serviceId: s.data.id,
        device: 'Dell Inspiron 15',
        value: 250,
        status: 'recebido'
      }
    });

    assert.equal(res.res.status, 201);
    assert.ok(res.data.id);
    assert.match(res.data.publicCode, /^BIOS-[A-F0-9]{12}$/);
    orderId = res.data.id;
    publicCode = res.data.publicCode;

    const orders = await call('/api/orders');
    const saved = orders.data.find(x => x.id === orderId);
    assert.equal(saved.publicCode, publicCode);
    trackingToken = saved.trackingToken;
  });

  await t.test('Edição da OS nunca altera o publicCode existente', async () => {
    const edit = await call('/api/orders/' + orderId, {
      method: 'PUT',
      body: {
        clientId: c.data.id,
        serviceId: s.data.id,
        device: 'Dell Inspiron 15 - Atualizado',
        value: 300,
        status: 'analise'
      }
    });
    assert.equal(edit.res.status, 200);

    const orders = await call('/api/orders');
    const saved = orders.data.find(x => x.id === orderId);
    assert.equal(saved.publicCode, publicCode, 'publicCode deve ser estritamente imutável após a criação');
    assert.equal(saved.device, 'Dell Inspiron 15 - Atualizado');
  });

  await t.test('publicCode não autoriza consulta direta sem token secreto', async () => {
    // /api/os/:code returns 410 Gone
    const byCode = await call('/api/os/' + publicCode, { auth: false });
    assert.equal(byCode.res.status, 410);

    // /api/tracking/:token with publicCode returns 404
    const trackingByCode = await call('/api/tracking/' + publicCode, { auth: false });
    assert.equal(trackingByCode.res.status, 404);

    // Only secret 64-char trackingToken works
    const trackingValid = await call('/api/tracking/' + trackingToken, { auth: false });
    assert.equal(trackingValid.res.status, 200);
    assert.equal(trackingValid.data.publicCode, publicCode);
  });
});
