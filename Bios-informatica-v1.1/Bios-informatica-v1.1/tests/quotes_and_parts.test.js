'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bios-quotes-tests-'));
const dbPath = path.join(temp, 'database.sqlite');
let child, base, cookie;
const password = 'SenhaForteSegura-' + crypto.randomBytes(8).toString('hex');

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
      PORT: '18763',
      JWT_SECRET: crypto.randomBytes(40).toString('hex'),
      SITE_URL: 'http://127.0.0.1:18763',
      COOKIE_SECURE: 'false',
      DB_PATH: database,
      ...extra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = 'http://127.0.0.1:18763';
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

test('Bios: Catálogo de Peças, Orçamentos Detalhados, Versionamento e Aprovação', { timeout: 90000 }, async t => {
  t.after(async () => {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  await boot(dbPath, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password });
  await login();

  let clientA, clientB;
  let partSSD, partRAM, serviceMontagem;

  await t.test('Cadastro de clientes e serviços base', async () => {
    const c1 = await call('/api/clients', { method: 'POST', body: { name: 'Lucas Ferreira', phone: '(13) 99111-2233', city: 'Guarujá' } });
    assert.equal(c1.res.status, 201);
    clientA = c1.data.id;

    const c2 = await call('/api/clients', { method: 'POST', body: { name: 'Mariana Souza', phone: '(13) 98222-3344', city: 'Santos' } });
    assert.equal(c2.res.status, 201);
    clientB = c2.data.id;

    const s = await call('/api/services', { method: 'POST', body: { name: 'Montagem Completa & Cable Management', category: 'Computadores', price: 180, desc: 'Montagem de PC' } });
    assert.equal(s.res.status, 201);
    serviceMontagem = s.data.id;
  });

  await t.test('1. Catálogo de Peças: cadastro, status real, busca e inativação preservando histórico', async () => {
    // Cadastro com status válidos: em_estoque, sob_encomenda, a_confirmar
    const p1 = await call('/api/parts', {
      method: 'POST',
      body: {
        category: 'Armazenamento',
        brand: 'Kingston',
        model: 'SSD NV2 1TB NVMe M.2 2280',
        sku: 'SSD-KNG-1TB',
        specs: 'Leitura 3500MB/s, Gravação 2100MB/s PCIe 4.0',
        supplier: 'Kabum',
        cost: 260.00,
        price: 379.90,
        status: 'em_estoque',
        notes: 'Garantia 3 anos com fabricante'
      }
    });
    assert.equal(p1.res.status, 201);
    partSSD = p1.data.id;

    const p2 = await call('/api/parts', {
      method: 'POST',
      body: {
        category: 'Memória RAM',
        brand: 'Corsair',
        model: 'Vengeance LPX 16GB (2x8GB) DDR4 3200MHz',
        sku: 'RAM-COR-16GB-DDR4',
        specs: 'DDR4 3200MHz CL16 1.35V',
        supplier: 'Pichau',
        cost: 210.00,
        price: 310.00,
        status: 'sob_encomenda',
        notes: 'Previsão fornecedor 3 dias úteis'
      }
    });
    assert.equal(p2.res.status, 201);
    partRAM = p2.data.id;

    const p3 = await call('/api/parts', {
      method: 'POST',
      body: {
        category: 'Placa de Vídeo',
        brand: 'ASUS',
        model: 'GeForce RTX 4060 Dual OC 8GB',
        sku: 'GPU-RTX4060-ASUS',
        specs: '8GB GDDR6 DLSS 3 Ray Tracing',
        supplier: 'All Nations',
        cost: 1850.00,
        price: 2299.00,
        status: 'a_confirmar',
        notes: 'Consultar cotação no dia do fechamento'
      }
    });
    assert.equal(p3.res.status, 201);

    // Listagem e busca
    const all = await call('/api/parts');
    assert.equal(all.data.length, 3);

    const searchRAM = await call('/api/parts?q=Corsair');
    assert.equal(searchRAM.data.length, 1);
    assert.equal(searchRAM.data[0].brand, 'Corsair');

    const filterStatus = await call('/api/parts?status=sob_encomenda');
    assert.equal(filterStatus.data.length, 1);
    assert.equal(filterStatus.data[0].id, partRAM);

    // Inativação sem apagar peça
    const toggle = await call('/api/parts/' + p3.data.id + '/toggle', { method: 'POST', body: {} });
    assert.equal(toggle.res.status, 200);

    const activeList = await call('/api/parts?active=1');
    assert.equal(activeList.data.length, 2);
    assert.ok(!activeList.data.some(x => x.id === p3.data.id));

    // Exclusão / inativação suave via DELETE
    const del = await call('/api/parts/' + p3.data.id, { method: 'DELETE', body: {} });
    assert.equal(del.res.status, 200);
    const checkAll = await call('/api/parts');
    const inactivePart = checkAll.data.find(x => x.id === p3.data.id);
    assert.equal(inactivePart.active, 0, 'Peça deve permanecer no banco inativada para manter histórico');
  });

  await t.test('Tipos enviados pelo painel preservam peças, serviços e centavos ao reabrir', async () => {
    const payload = { title: 'Regressão do painel', shippingTotal: 20, items: [
      {type:'part',name:'Peça',quantity:2,unitPrice:0.10,unitCost:0.05},
      {type:'service',name:'Montagem',quantity:1,unitPrice:100},
      {type:'custom',name:'Adicional',quantity:1,unitPrice:15}
    ]};
    const result=await call('/api/quotes',{method:'POST',body:payload});
    assert.equal(result.res.status,201,JSON.stringify(result.data));
    const saved=await call('/api/quotes/'+result.data.id);
    assert.deepEqual(saved.data.items.map(x=>x.type),['peca','servico','avulso']);
    assert.equal(saved.data.partsTotal,0.20);assert.equal(saved.data.servicesTotal,100);
    assert.equal(saved.data.customTotal,15);assert.equal(saved.data.total,135.20);
    assert.equal(saved.data.profit,115.10);
    for(const quantity of [0,-1,1.5,10000]) {
      const invalid=await call('/api/quotes',{method:'POST',body:{...payload,items:[{...payload.items[0],quantity}]}});
      assert.equal(invalid.res.status,400);
    }
    await call('/api/quotes/'+result.data.id,{method:'DELETE',body:{}});
  });

  let quoteId, quotePublicCode, quoteTrackingToken;

  await t.test('2. Orçamento detalhado com vários itens, cálculo exato no servidor e custo restrito', async () => {
    const quotePayload = {
      clientId: clientA,
      title: 'Upgrade Gamer & Otimização Térmica',
      device: 'Desktop Gamer Ryzen 5',
      validUntil: '2026-11-15',
      paymentTerms: 'À vista com 5% de desconto no Pix ou até 10x sem juros no cartão',
      deliveryTime: '2 a 4 dias úteis',
      shippingTotal: 30.00,
      discountTotal: 50.00,
      notes: 'Garantia total de 90 dias nos serviços e garantia dos fabricantes para componentes.',
      internalNotes: 'Margem estimada em 35%. Comprador é cliente antigo.',
      status: 'aguardando_aprovacao',
      items: [
        {
          type: 'peca',
          itemId: partSSD,
          name: 'SSD Kingston NV2 1TB NVMe',
          details: 'Gen 4x4 M.2 2280',
          quantity: 1,
          unitCost: 260.00,
          unitPrice: 379.90
        },
        {
          type: 'peca',
          itemId: partRAM,
          name: 'Memória Corsair Vengeance 16GB (2x8GB) DDR4',
          details: '3200MHz Dual Channel',
          quantity: 2,
          unitCost: 210.00,
          unitPrice: 310.00 // 2 * 310 = 620
        },
        {
          type: 'servico',
          itemId: serviceMontagem,
          name: 'Montagem Completa & Cable Management',
          details: 'Higienização, troca de pasta térmica e organização de cabos',
          quantity: 1,
          unitCost: 0.00,
          unitPrice: 180.00
        },
        {
          type: 'avulso',
          name: 'Pasta Térmica Arctic MX-4 (Aplicação)',
          details: 'Alta condutividade térmica 8.5W/mK',
          quantity: 1,
          unitCost: 20.00,
          unitPrice: 45.00
        }
      ]
    };

    const res = await call('/api/quotes', { method: 'POST', body: quotePayload });
    assert.equal(res.res.status, 201);
    assert.ok(res.data.id);
    assert.match(res.data.publicCode, /^ORC-[A-F0-9]{12}$/);
    assert.match(res.data.trackingToken, /^[a-f0-9]{64}$/);

    quoteId = res.data.id;
    quotePublicCode = res.data.publicCode;
    quoteTrackingToken = res.data.trackingToken;

    // Verificar cálculos exatos no servidor:
    // Peças: 379.90 + 620.00 = 999.90
    // Serviços: 180.00
    // Avulsos: 45.00
    // Frete: 30.00
    // Desconto: 50.00
    // Total: 999.90 + 180.00 + 45.00 + 30.00 - 50.00 = 1204.90
    // Custo Total: 260 + (2 * 210 = 420) + 0 + 20 = 700.00
    // Lucro: 1204.90 - 700 - 30 = 474.90
    const fetched = await call('/api/quotes/' + quoteId);
    assert.equal(fetched.res.status, 200);
    assert.equal(fetched.data.partsTotal, 999.90);
    assert.equal(fetched.data.servicesTotal, 180.00);
    assert.equal(fetched.data.customTotal, 45.00);
    assert.equal(fetched.data.shippingTotal, 30.00);
    assert.equal(fetched.data.discountTotal, 50.00);
    assert.equal(fetched.data.total, 1204.90);
    assert.equal(fetched.data.totalCost, 700.00);
    assert.equal(fetched.data.profit, 474.90);
    assert.equal(fetched.data.version, 1);
    assert.equal(fetched.data.approvedVersion, null);
    assert.equal(fetched.data.internalNotes, 'Margem estimada em 35%. Comprador é cliente antigo.');

    // 3. Snapshotting: alterar preço da peça no catálogo NÃO pode modificar o orçamento existente!
    await call('/api/parts/' + partSSD, {
      method: 'PUT',
      body: {
        category: 'Armazenamento',
        brand: 'Kingston',
        model: 'SSD NV2 1TB NVMe M.2 2280 - Preço Aumentou',
        cost: 300.00,
        price: 499.00,
        status: 'em_estoque'
      }
    });

    const quoteCheck = await call('/api/quotes/' + quoteId);
    assert.equal(quoteCheck.data.partsTotal, 999.90, 'Preço no orçamento antigo deve permanecer inalterado');
    const ssdItem = quoteCheck.data.items.find(x => x.itemId === partSSD);
    assert.equal(ssdItem.unitPrice, 379.90, 'Snapshot de preço unitário deve ser estritamente preservado');
    assert.equal(ssdItem.name, 'SSD Kingston NV2 1TB NVMe', 'Snapshot de descrição deve ser preservado');
  });

  await t.test('3. Link público exclusivo, segurança contra vazamento de custos/PII e aprovação versionada', async () => {
    // Consulta pública sem autenticação
    const pub = await call('/api/proposta/' + quoteTrackingToken, { auth: false });
    assert.equal(pub.res.status, 200);
    assert.equal(pub.data.publicCode, quotePublicCode);
    assert.equal(pub.data.totals.total, 1204.90);
    assert.equal(pub.data.totals.partsTotal, 999.90);
    assert.equal(pub.data.approved, false);

    // CUSTO, LUCRO, NOTAS INTERNAS NÃO PODEM EXISTIR NO LINK PÚBLICO!
    assert.equal(pub.data.totalCost, undefined);
    assert.equal(pub.data.profit, undefined);
    assert.equal(pub.data.profitMargin, undefined);
    assert.equal(pub.data.internalNotes, undefined);
    for (const item of pub.data.items) {
      assert.equal(item.unitCost, undefined);
      assert.equal(item.costSubtotal, undefined);
    }

    // PII não deve ser exposto (apenas o primeiro nome / nome amigável para saudação)
    assert.equal(pub.data.client.phone, undefined);
    assert.equal(pub.data.client.email, undefined);
    assert.equal(pub.data.client.doc, undefined);
    assert.equal(pub.data.client.address, undefined);

    // Aprovação pelo cliente da versão 1
    const approveV1 = await call('/api/proposta/' + quoteTrackingToken + '/approve', {
      method: 'POST',
      auth: false,
      body: { version: 1, accepted: true }
    });
    assert.equal(approveV1.res.status, 200);

    const pubApproved = await call('/api/proposta/' + quoteTrackingToken, { auth: false });
    assert.equal(pubApproved.data.approved, true);
    assert.equal(pubApproved.data.status, 'aprovado');
    assert.equal(pubApproved.data.approvedVersion, 1);

    // Tentar aprovar versão incorreta falha
    const badVersion = await call('/api/proposta/' + quoteTrackingToken + '/approve', {
      method: 'POST',
      auth: false,
      body: { version: 999, accepted: true }
    });
    assert.equal(badVersion.res.status, 409);
  });

  await t.test('4. Alterar proposta aprovada exige NOVA versão e NOVA aprovação', async () => {
    const current = (await call('/api/quotes/' + quoteId)).data;
    assert.equal(current.version, 1);
    assert.equal(current.approvedVersion, 1);

    // Modificar a proposta aprovada (ex: cliente pediu para trocar para 1 pente de 16GB em vez de 2)
    const updatedItems = current.items.map(it => {
      if (it.itemId === partRAM) return { ...it, quantity: 1 };
      return it;
    });

    const editRes = await call('/api/quotes/' + quoteId, {
      method: 'PUT',
      body: {
        ...current,
        items: updatedItems
      }
    });
    assert.equal(editRes.res.status, 200);
    assert.equal(editRes.data.version, 2, 'Versão deve incrementar para 2');
    assert.equal(editRes.data.requiresNewApproval, true, 'Deve sinalizar exigência de nova aprovação');

    // Verificar estado após alteração
    const refreshed = (await call('/api/quotes/' + quoteId)).data;
    assert.equal(refreshed.version, 2);
    assert.equal(refreshed.approvedVersion, null, 'Aprovação anterior deve ser revogada para a nova versão');
    assert.equal(refreshed.status, 'aguardando_aprovacao');
    // Novo total recalculado: 999.90 - 310 = 689.90 de peças; total 1204.90 - 310 = 894.90
    assert.equal(refreshed.total, 894.90);

    // No link público, proposta não está mais aprovada
    const pubV2 = (await call('/api/proposta/' + quoteTrackingToken, { auth: false })).data;
    assert.equal(pubV2.version, 2);
    assert.equal(pubV2.approved, false, 'Cliente deve aprovar a nova versão explicitamente');

    // Cliente aprova a versão 2
    const approveV2 = await call('/api/proposta/' + quoteTrackingToken + '/approve', {
      method: 'POST',
      auth: false,
      body: { version: 2, accepted: true }
    });
    assert.equal(approveV2.res.status, 200);

    const pubV2Approved = (await call('/api/proposta/' + quoteTrackingToken, { auth: false })).data;
    assert.equal(pubV2Approved.approved, true);
    assert.equal(pubV2Approved.approvedVersion, 2);

    // Histórico de aprovações preservado
    const fullQuote = (await call('/api/quotes/' + quoteId)).data;
    assert.ok(fullQuote.approvals.length >= 2, 'Histórico de aprovações deve armazenar ambas as versões');
    assert.equal(fullQuote.approvals[0].version, 2);
    assert.equal(fullQuote.approvals[1].version, 1);
  });

  await t.test('5. Duplicação de proposta para configurações alternativas', async () => {
    const dupRes = await call('/api/quotes/' + quoteId + '/duplicate', {
      method: 'POST',
      body: { title: 'Opção 2: Configuração High-End / Alta Performance' }
    });
    assert.equal(dupRes.res.status, 201);
    assert.ok(dupRes.data.id);
    assert.notEqual(dupRes.data.id, quoteId);
    assert.match(dupRes.data.publicCode, /^ORC-[A-F0-9]{12}$/);
    assert.notEqual(dupRes.data.publicCode, quotePublicCode);
    assert.notEqual(dupRes.data.trackingToken, quoteTrackingToken);

    const dupDetails = (await call('/api/quotes/' + dupRes.data.id)).data;
    assert.equal(dupDetails.title, 'Opção 2: Configuração High-End / Alta Performance');
    assert.equal(dupDetails.version, 1);
    assert.equal(dupDetails.approvedVersion, null);
    assert.equal(dupDetails.status, 'rascunho');
    assert.equal(dupDetails.items.length, 4);
    assert.equal(dupDetails.total, 894.90);
  });

  await t.test('6. Conversão de proposta em Ordem de Serviço (OS) sem duplicação', async () => {
    const convRes = await call('/api/quotes/' + quoteId + '/convert-to-os', {
      method: 'POST',
      body: {}
    });
    assert.equal(convRes.res.status, 201);
    assert.ok(convRes.data.orderId);
    assert.match(convRes.data.orderId, /^OS\d{3,}$/);
    assert.match(convRes.data.publicCode, /^BIOS-[A-F0-9]{12}$/);

    const orderId = convRes.data.orderId;

    // Verificar se OS foi criada com os dados e valores do orçamento
    const orders = (await call('/api/orders')).data;
    const os = orders.find(x => x.id === orderId);
    assert.ok(os);
    assert.equal(os.clientId, clientA);
    assert.equal(os.value, 894.90);
    assert.equal(os.quoteId, quoteId);

    // Verificar se o orçamento foi atualizado com o vínculo e status
    const quoteAfter = (await call('/api/quotes/' + quoteId)).data;
    assert.equal(quoteAfter.orderId, orderId);
    assert.equal(quoteAfter.status, 'convertido_os');

    // Conversão idempotente: chamar novamente retorna a mesma OS sem duplicar
    const duplicateConversion = await call('/api/quotes/' + quoteId + '/convert-to-os', {
      method: 'POST',
      body: {}
    });
    assert.equal(duplicateConversion.res.status, 200);
    assert.equal(duplicateConversion.data.alreadyConverted, true);
    assert.equal(duplicateConversion.data.orderId, orderId);

    // Contagem de ordens não deve ter aumentado
    const ordersFinal = (await call('/api/orders')).data;
    assert.equal(ordersFinal.filter(x => x.quoteId === quoteId).length, 1);
  });

  await t.test('7. Configurações da empresa: dados comerciais reais sem CNPJ fictício', async () => {
    const settings = (await call('/api/company-settings')).data;
    assert.equal(settings.company_name, 'Bios Informática');
    assert.equal(settings.phone, '(13) 99622-2130');
    assert.equal(settings.cnpj, undefined, 'Não deve conter CNPJ fictício configurado');

    const updateSettings = await call('/api/company-settings', {
      method: 'PUT',
      body: {
        trade_name: 'Bios Informática - Assistência Técnica & Montagem',
        warranty_terms: 'Garantia legal de 90 dias (CDC) e garantia do fabricante.'
      }
    });
    assert.equal(updateSettings.res.status, 200);

    const updated = (await call('/api/company-settings')).data;
    assert.equal(updated.trade_name, 'Bios Informática - Assistência Técnica & Montagem');
  });
});
