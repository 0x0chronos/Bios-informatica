'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const TEST_PORT = 18777;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bios-quote-table-tests-'));
const DB_PATH = path.join(temp, 'database.sqlite');
const testPassword = 'SenhaForteSegura-' + crypto.randomBytes(8).toString('hex');

async function startServer() {
  const child = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DB_PATH: DB_PATH,
      NODE_ENV: 'test',
      SITE_URL: BASE_URL,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: testPassword,
      JWT_SECRET: crypto.randomBytes(40).toString('hex'),
      COOKIE_SECURE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', d => output += d);
  child.stderr.on('data', d => output += d);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server spawn timeout: ' + output)), 15000);
    const check = () => {
      if (output.includes('Bios disponível')) {
        clearTimeout(timer);
        resolve();
      } else if (child.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error(output));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });

  return child;
}

test('Quote Table: Orçamento com 15 itens, descrições longas, status bilíngue e SSRF', async (t) => {
  const child = await startServer();
  let sessionCookie = '';

  t.after(async () => {
    if (child) {
      child.kill('SIGINT');
      await new Promise(r => child.on('exit', r));
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });

  async function req(route, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'X-Bios-Request': '1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && sessionCookie) headers['Cookie'] = sessionCookie;
    headers['Origin'] = BASE_URL;

    const res = await fetch(`${BASE_URL}${route}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/bios_session=[^;]+/);
      if (m) sessionCookie = m[0];
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  // 1. Login inicial
  const loginRes = await req('/api/login', {
    method: 'POST',
    body: { username: 'admin', password: testPassword }
  });
  assert.equal(loginRes.status, 200, JSON.stringify(loginRes.data));

  // 2. Criar cliente base
  const clientRes = await req('/api/clients', {
    method: 'POST',
    body: {
      name: 'Cliente Empresa de TI Ltda',
      phone: '13999998888',
      email: 'contato@empresati.com.br'
    }
  });
  assert.equal(clientRes.status, 201);
  const clientId = clientRes.data.id;

  // 3. Montar orçamento com 15 itens reais e descrições técnicas longas
  const items15 = [];
  for (let i = 1; i <= 15; i++) {
    items15.push({
      type: i % 3 === 0 ? 'servico' : (i % 5 === 0 ? 'avulso' : 'peca'),
      name: `Componente Técnico #${i} — Workstation Pro High End V${i}`,
      details: `Especificação detalhada do item #${i}: arquitetura multi-core de alta precisão, dissipação térmica avançada, garantia estendida com suporte presencial em Peruíbe e litoral paulista. Número de lote HW-${i * 1111}, conformidade com normas ABNT NBR 5410.`,
      quantity: i,
      unitCost: 100.50 + i * 10,
      unitPrice: 150.75 + i * 15,
      position: i - 1
    });
  }

  const createRes = await req('/api/quotes', {
    method: 'POST',
    body: {
      clientId,
      title: 'Workstation Completa 15 Módulos',
      device: 'Gabinete Torre Estação de Trabalho',
      status: 'sent', // Testando compatibilidade com status em inglês 'sent'
      shippingTotal: 75.00,
      discountTotal: 50.00,
      validUntil: '2026-11-30',
      deliveryTime: '5 dias úteis',
      paymentTerms: 'À vista com 5% de desconto via Pix ou até 12x no cartão',
      notes: 'Equipamento testado em bancada por 24 horas consecutivas com relatório de temperatura.',
      internalNotes: 'Margem comercial calculada com base nos fornecedores oficiais KaBuM e Pichau.',
      items: items15
    }
  });

  assert.equal(createRes.status, 201);
  const quoteId = createRes.data.id;
  const trackingToken = createRes.data.trackingToken;
  assert.ok(quoteId);

  // 4. Verificar orçamento carregado: status normalizado para 'aguardando_aprovacao'
  const getRes = await req(`/api/quotes/${quoteId}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.status, 'aguardando_aprovacao');
  assert.equal(getRes.data.version, 1);
  assert.equal(getRes.data.items.length, 15);
  assert.ok(getRes.data.total > 0);
  assert.ok(getRes.data.profit > 0);

  // 5. Verificar proposta pública: 15 itens presentes, sem vazar custos ou notas internas
  const publicRes = await req(`/api/proposta/${trackingToken}`, { auth: false });
  assert.equal(publicRes.status, 200);
  assert.equal(publicRes.data.items.length, 15);
  assert.equal(publicRes.data.internalNotes, undefined);
  assert.equal(publicRes.data.totalCost, undefined);
  assert.equal(publicRes.data.profit, undefined);
  assert.equal(publicRes.data.profitMargin, undefined);
  assert.equal(publicRes.data.items[0].unitCost, undefined);

  // 6. Aprovar proposta online
  const approveRes = await req(`/api/proposta/${trackingToken}/approve`, {
    method: 'POST',
    auth: false,
    body: {
      version: 1,
      accepted: true
    }
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.data.success, true);

  // 7. Modificar proposta já aprovada usando status 'approved' ou 'aprovado'
  // Deve criar automaticamente snapshot na tabela quote_versions e incrementar para versão 2
  const editRes = await req(`/api/quotes/${quoteId}`, {
    method: 'PUT',
    body: {
      clientId,
      title: 'Workstation Completa 15 Módulos (Revisada v2)',
      device: 'Gabinete Torre Estação de Trabalho',
      status: 'approved',
      shippingTotal: 80.00,
      discountTotal: 60.00,
      validUntil: '2026-12-15',
      deliveryTime: '7 dias úteis',
      items: items15.slice(0, 14) // 14 itens na versão 2
    }
  });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.data.version, 2);
  assert.equal(editRes.data.requiresNewApproval, true);

  // 8. Verificar que a versão v1 foi salva em quote_versions
  const refreshed = await req(`/api/quotes/${quoteId}`);
  assert.equal(refreshed.data.version, 2);
  assert.equal(refreshed.data.approvedVersion, null); // Aprovação foi revogada
  assert.equal(refreshed.data.versions.length, 1);
  assert.equal(refreshed.data.versions[0].version, 1);
  const v1Items = JSON.parse(refreshed.data.versions[0].itemsSnapshot);
  assert.equal(v1Items.length, 15);

  // 9. Conversão idempotente em OS
  const conv1 = await req(`/api/quotes/${quoteId}/convert-to-os`, { method: 'POST', body: {} });
  assert.equal(conv1.status, 201);
  const orderId = conv1.data.orderId;

  const conv2 = await req(`/api/quotes/${quoteId}/convert-to-os`, { method: 'POST', body: {} });
  assert.equal(conv2.status, 200);
  assert.equal(conv2.data.alreadyConverted, true);
  assert.equal(conv2.data.orderId, orderId);

  // 10. Teste de segurança SSRF em scripts/suppliers.js:
  const suppliers = require('../scripts/suppliers');
  
  // a) Rejeição de domínio não autorizado
  await assert.rejects(
    () => suppliers.validateUrlSecurity('https://google.com/search?q=gpu'),
    /Domínio não autorizado/
  );

  // b) Rejeição de protocolo inseguro HTTP
  await assert.rejects(
    () => suppliers.validateUrlSecurity('http://www.kabum.com.br/produto/123'),
    /Apenas conexões seguras HTTPS/
  );

  // c) Rejeição de IP privado/loopback (SSRF direto)
  assert.equal(suppliers.isIpPrivate('127.0.0.1'), true);
  assert.equal(suppliers.isIpPrivate('10.0.0.5'), true);
  assert.equal(suppliers.isIpPrivate('192.168.1.100'), true);
  assert.equal(suppliers.isIpPrivate('169.254.169.254'), true);
  assert.equal(suppliers.isIpPrivate('100.64.1.1'), true);
  assert.equal(suppliers.isIpPrivate('::1'), true);
  assert.equal(suppliers.isIpPrivate('8.8.8.8'), false);
});
