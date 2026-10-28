'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const {
  validateUrlSecurity,
  parseKabumProduct,
  parsePichauProduct,
  parseTerabyteProduct,
  searchStoreProducts,
  parseKabumSearchHtml,
  parsePichauSearchHtml,
  parseTerabyteSearchHtml,
  fetchSupplierPreview
} = require('../scripts/suppliers');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bios-suppliers-tests-'));
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
      ...process.env,
      DATABASE_URL: '',
      NODE_ENV: 'test',
      PORT: '18766',
      JWT_SECRET: crypto.randomBytes(40).toString('hex'),
      SITE_URL: 'http://127.0.0.1:18766',
      COOKIE_SECURE: 'false',
      DB_PATH: database,
      ...extra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = 'http://127.0.0.1:18766';
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
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

test('Suppliers: 1. Validação de segurança, proteção estrita contra SSRF e domínios permitidos', async () => {
  // Domínios não autorizados devem ser rejeitados imediatamente
  await assert.rejects(
    validateUrlSecurity('https://google.com/search?q=rtx'),
    /Domínio não autorizado/
  );
  await assert.rejects(
    validateUrlSecurity('https://attacker.com/malicious'),
    /Domínio não autorizado/
  );
  await assert.rejects(
    validateUrlSecurity('http://www.kabum.com.br/produto/123'),
    /Apenas conexões seguras HTTPS/
  );
  await assert.rejects(
    validateUrlSecurity('not-a-valid-url'),
    /URL inválida/
  );

  // IPs privados e loopbacks devem ser bloqueados
  await assert.rejects(
    validateUrlSecurity('https://localhost:8000/internal'),
    /Domínio não autorizado/
  );
  await assert.rejects(
    validateUrlSecurity('https://127.0.0.1/admin'),
    /Domínio não autorizado/
  );
  await assert.rejects(
    validateUrlSecurity('https://169.254.169.254/latest/meta-data'),
    /Domínio não autorizado/
  );
});

test('Suppliers: 2. Parsers de KaBuM! e Pichau extraem dados estruturados (LD+JSON e vitrine)', () => {
  const htmlKabum = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Processador AMD Ryzen 5 5600 | KaBuM!</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Processador AMD Ryzen 5 5600, 3.5GHz (4.4GHz Max Turbo), Cache 35MB, AM4",
          "sku": "320794",
          "gtin13": "0730143312345",
          "mpn": "100-100000927BOX",
          "offers": {
            "@type": "Offer",
            "price": "899.99",
            "priceCurrency": "BRL",
            "availability": "https://schema.org/InStock",
            "seller": {
              "@type": "Organization",
              "name": "KaBuM!"
            }
          }
        }
        </script>
      </head>
      <body>
        <div class="card-price">10x de R$ 102,99</div>
      </body>
    </html>
  `;

  const parsedK = parseKabumProduct(htmlKabum, 'https://www.kabum.com.br/produto/320794/amd-ryzen-5-5600');
  assert.equal(parsedK.supplier, 'kabum');
  assert.equal(parsedK.storeSku, '320794');
  assert.equal(parsedK.ean, '0730143312345');
  assert.equal(parsedK.manufacturerCode, '100-100000927BOX');
  assert.equal(parsedK.pricePix, 899.99);
  assert.equal(parsedK.priceCard, 1029.90);
  assert.equal(parsedK.availability, 'em_estoque');
  assert.equal(parsedK.seller, 'KaBuM!');
  assert.equal(parsedK.shippingConsulted, 0);
  assert.equal(parsedK.shippingFee, null, 'Frete desconhecido deve ser nulo/não consultado, nunca zero');

  const htmlPichau = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Memoria Kingston Fury Beast 16GB DDR4 3200MHz | Pichau</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Memória Kingston Fury Beast, 16GB, DDR4, 3200MHz, CL16, Preto",
          "sku": "KF432C16BB1-16",
          "gtin13": "740617319880",
          "offers": {
            "@type": "Offer",
            "price": "289.90",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
      </head>
      <body>
        <div>12x de R$ 27,99 sem juros</div>
      </body>
    </html>
  `;

  const parsedP = parsePichauProduct(htmlPichau, 'https://www.pichau.com.br/memoria-kingston-fury-beast-16gb-ddr4-3200mhz-kf432c16bb1-16');
  assert.equal(parsedP.supplier, 'pichau');
  assert.equal(parsedP.storeSku, 'KF432C16BB1-16');
  assert.equal(parsedP.pricePix, 289.90);
  assert.equal(parsedP.priceCard, 335.88);
  assert.equal(parsedP.availability, 'em_estoque');
  assert.equal(parsedP.shippingConsulted, 0);
});

test('Suppliers: 3. Parser de Terabyte extrai dados estruturados e preserva status pendente', () => {
  const htmlTerabyte = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Placa de Video Galax GeForce RTX 4060 1-Click OC 2X 8GB | TerabyteShop</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Placa de Vídeo Galax GeForce RTX 4060 1-Click OC 2X, 8GB, GDDR6, 128bit",
          "sku": "46NSL8MD8ZOC",
          "gtin13": "4895147154213",
          "offers": {
            "@type": "Offer",
            "price": "1899.99",
            "priceCurrency": "BRL",
            "availability": "https://schema.org/InStock",
            "seller": {
              "@type": "Organization",
              "name": "TerabyteShop"
            }
          }
        }
        </script>
      </head>
      <body>
        <h1 class="tit-prod">Placa de Vídeo Galax GeForce RTX 4060 1-Click OC 2X, 8GB, GDDR6, 128bit</h1>
        <div id="val-prod">R$ 1.899,99 à vista</div>
        <div class="val-cartao">12x de R$ 186,27 sem juros</div>
      </body>
    </html>
  `;

  const parsedT = parseTerabyteProduct(htmlTerabyte, 'https://www.terabyteshop.com.br/produto/25890/placa-de-video-galax-geforce-rtx-4060');
  assert.equal(parsedT.supplier, 'terabyte');
  assert.equal(parsedT.storeSku, '46NSL8MD8ZOC');
  assert.equal(parsedT.ean, '4895147154213');
  assert.equal(parsedT.pricePix, 1899.99);
  assert.equal(parsedT.priceCard, 2235.24);
  assert.equal(parsedT.availability, 'em_estoque');
  assert.equal(parsedT.isPending, true, 'Deve manter status pendente conforme especificação');
  assert.equal(parsedT.validationStatus, 'pendente');
  assert.equal(parsedT.shippingConsulted, 0);
  assert.equal(parsedT.shippingFee, null);
});

test('Suppliers: 4. Descoberta de produtos com fixtures simuladas de KaBuM!, Pichau e Terabyte', () => {
  // 1. Fixture KaBuM com Next.js JSON
  const htmlKabumSearch = `
    <!DOCTYPE html>
    <html>
      <head>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "data": {
                "catalogServer": {
                  "data": [
                    {
                      "code": "412345",
                      "name": "Placa de Vídeo RTX 4060 ASUS Dual OC",
                      "friendlyName": "placa-de-video-rtx-4060-asus",
                      "price": 1949.99,
                      "regularPrice": 2199.90,
                      "available": true,
                      "sellerName": "KaBuM!",
                      "ean": "4711387222333"
                    }
                  ]
                }
              }
            }
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const kabumFound = parseKabumSearchHtml(htmlKabumSearch, 5);
  assert.equal(kabumFound.length, 1);
  assert.equal(kabumFound[0].supplier, 'kabum');
  assert.equal(kabumFound[0].storeSku, '412345');
  assert.equal(kabumFound[0].pricePix, 1949.99);
  assert.equal(kabumFound[0].priceCard, 2199.90);
  assert.equal(kabumFound[0].availability, 'em_estoque');
  assert.equal(kabumFound[0].shippingConsulted, 0);

  // 2. Fixture Pichau Search
  const htmlPichauSearch = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@type": "ItemList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "item": {
                "@type": "Product",
                "name": "Placa de Video Gigabyte GeForce RTX 4060 Eagle OC",
                "sku": "GV-N4060EAGLE-OC-8GD",
                "url": "https://www.pichau.com.br/placa-de-video-gigabyte-rtx-4060",
                "offers": {
                  "@type": "Offer",
                  "price": "1999.00"
                }
              }
            }
          ]
        }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const pichauFound = parsePichauSearchHtml(htmlPichauSearch, 5);
  assert.equal(pichauFound.length, 1);
  assert.equal(pichauFound[0].supplier, 'pichau');
  assert.equal(pichauFound[0].storeSku, 'GV-N4060EAGLE-OC-8GD');
  assert.equal(pichauFound[0].pricePix, 1999.00);
  assert.equal(pichauFound[0].shippingConsulted, 0);

  // 3. Fixture Terabyte Search
  const htmlTerabyteSearch = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="commerce-item">
          <a href="/produto/25890/placa-de-video-rtx-4060" title="Placa de Video Inno3D GeForce RTX 4060 Twin X2 8GB">
            <h2 class="prod-name">Placa de Video Inno3D GeForce RTX 4060 Twin X2 8GB</h2>
            <div class="prod-price">R$ 1.849,90</div>
          </a>
        </div>
      </body>
    </html>
  `;
  const terabyteFound = parseTerabyteSearchHtml(htmlTerabyteSearch, 5);
  assert.equal(terabyteFound.length, 1);
  assert.equal(terabyteFound[0].supplier, 'terabyte');
  assert.equal(terabyteFound[0].storeSku, '25890');
  assert.equal(terabyteFound[0].pricePix, 1849.90);
  assert.equal(terabyteFound[0].isPending, true);
  assert.equal(terabyteFound[0].shippingConsulted, 0);
});

test('Suppliers: 5. Integração com Terabyte mantém suporte a cotação manual e tratamento de bloqueios', async () => {
  const terabytePreview = await fetchSupplierPreview('https://www.terabyteshop.com.br/produto/12345/placa-de-video-geforce-rtx-4060');
  assert.equal(terabytePreview.supplier, 'terabyte');
  assert.equal(terabytePreview.isPending, true);
  assert.equal(terabytePreview.shippingConsulted, 0);
  assert.equal(terabytePreview.shippingFee, null);
});

test('Suppliers: 4. Ciclo completo de API de fornecedores, ofertas e atualização de preços de orçamentos', async (t) => {
  await boot(dbPath, {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: password
  });

  t.after(async () => {
    if (child) {
      child.kill('SIGINT');
      await new Promise(r => child.on('exit', r));
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });

  // 1. Login
  await login('admin', password);

  // 2. Consulta fornecedores padrão
  const supsRes = await call('/api/suppliers');
  assert.equal(supsRes.res.status, 200);
  assert.ok(Array.isArray(supsRes.data));
  const kabum = supsRes.data.find(s => s.id === 'kabum');
  const pichau = supsRes.data.find(s => s.id === 'pichau');
  const terabyte = supsRes.data.find(s => s.id === 'terabyte');

  assert.ok(kabum && kabum.status === 'ativo');
  assert.ok(pichau && pichau.status === 'ativo');
  assert.ok(terabyte && terabyte.status === 'integracao_pendente');

  // Alternar status de fornecedor
  const patchSup = await call('/api/suppliers/kabum', {
    method: 'PATCH',
    body: { status: 'inativo' }
  });
  assert.equal(patchSup.res.status, 200);

  const supsAfter = (await call('/api/suppliers')).data;
  assert.equal(supsAfter.find(s => s.id === 'kabum').status, 'inativo');

  // Reativar
  await call('/api/suppliers/kabum', { method: 'PATCH', body: { status: 'ativo' } });

  // 3. Cadastrar peça no catálogo
  const partRes = await call('/api/parts', {
    method: 'POST',
    body: {
      category: 'Processadores',
      brand: 'AMD',
      model: 'Ryzen 5 5600',
      sku: '0730143312345',
      specs: '6 núcleos, 12 threads',
      cost: 750.00,
      price: 999.00,
      status: 'em_estoque'
    }
  });
  const partId = partRes.data.id;

  // 4. Cadastrar oferta vinculada a esta peça
  const offerRes = await call('/api/supplier-offers', {
    method: 'POST',
    body: {
      partId,
      supplierId: 'kabum',
      storeSku: '320794',
      ean: '0730143312345',
      title: 'Processador AMD Ryzen 5 5600 Box',
      url: 'https://www.kabum.com.br/produto/320794/amd-ryzen-5-5600',
      seller: 'KaBuM!',
      pricePix: 799.90,
      priceCard: 899.90,
      cardInstallments: '10x sem juros',
      availability: 'em_estoque',
      shippingConsulted: 0,
      shippingFee: null
    }
  });
  assert.equal(offerRes.res.status, 201);
  const offerId = offerRes.data.id;

  // Listar ofertas
  const offersList = await call('/api/supplier-offers?partId=' + partId);
  assert.equal(offersList.res.status, 200);
  assert.equal(offersList.data.length, 1);
  assert.equal(offersList.data[0].pricePix, 799.90);
  assert.equal(offersList.data[0].partSellPrice, 999.00);

  // 5. Criar orçamento com esta peça
  const clientRes = await call('/api/clients', {
    method: 'POST',
    body: { name: 'Cliente Cotação', phone: '13999998888' }
  });
  const clientId = clientRes.data.id;

  const quoteRes = await call('/api/quotes', {
    method: 'POST',
    body: {
      clientId,
      title: 'Upgrade Ryzen 5',
      items: [
        {
          type: 'peca',
          itemId: partId,
          name: 'Processador AMD Ryzen 5 5600',
          quantity: 1,
          unitCost: 750.00,
          unitPrice: 999.00
        }
      ],
      shippingTotal: 0,
      discountTotal: 0,
      status: 'aguardando_aprovacao'
    }
  });
  const quoteId = quoteRes.data.id;
  const quoteToken = quoteRes.data.trackingToken;

  // 6. Comparar preços do orçamento com fornecedores
  const checkRes = await call('/api/quotes/' + quoteId + '/check-supplier-prices', { method: 'POST', body: {} });
  assert.equal(checkRes.res.status, 200);
  assert.equal(checkRes.data.comparisons.length, 1);
  const comp = checkRes.data.comparisons[0];
  assert.equal(comp.currentUnitCost, 750.00);
  assert.ok(comp.supplierOffer);
  assert.equal(comp.supplierOffer.pricePix, 799.90);
  assert.equal(comp.hasDiff, true);

  // 7. Aplicar novo preço sugerido: deve gerar versão v2 e preservar imutabilidade da v1
  const applyRes = await call('/api/quotes/' + quoteId + '/apply-supplier-prices', {
    method: 'POST',
    body: {
      updates: [
        {
          quoteItemId: comp.quoteItemId,
          newUnitCost: 799.90,
          newUnitPrice: 1049.90
        }
      ]
    }
  });
  assert.equal(applyRes.res.status, 200);
  assert.equal(applyRes.data.version, 2, 'Aplicar preços a uma proposta já enviada deve gerar versão v2');
  assert.equal(applyRes.data.requiresNewApproval, true);

  // Verificar na API de detalhes se o histórico de versões foi preservado
  const quoteDetails = (await call('/api/quotes/' + quoteId)).data;
  assert.equal(quoteDetails.version, 2);
  assert.equal(quoteDetails.versions.length, 1, 'Versão v1 deve estar arquivada em quote_versions');
  assert.equal(quoteDetails.versions[0].version, 1);
  assert.equal(quoteDetails.versions[0].total, 999.00);

  // 8. Checagem de isolamento da proposta pública
  const publicProp = (await call('/api/proposta/' + quoteToken, { auth: false })).data;
  assert.equal(publicProp.version, 2);
  assert.equal(publicProp.approved, false);
  // Custos e fornecedores nunca vazam na proposta pública
  assert.equal(publicProp.totalCost, undefined);
  assert.equal(publicProp.items[0].unitCost, undefined);

  // 9. Configurações de agendamento de fornecedores
  const supSettings = (await call('/api/supplier-settings')).data;
  assert.equal(supSettings.daily_sync_enabled, '0', 'Agendamento em produção deve permanecer desativado');
  assert.equal(supSettings.timezone, 'America/Sao_Paulo');

  // 10. Busca de produtos nas lojas (GET /api/suppliers/search)
  const searchApiRes = await call('/api/suppliers/search?q=rtx&limit=3');
  assert.equal(searchApiRes.res.status, 200);
  assert.equal(searchApiRes.data.query, 'rtx');
  assert.ok(Array.isArray(searchApiRes.data.results));
  assert.ok(Array.isArray(searchApiRes.data.sources));

  // 11. Importação em lote com deduplicação (POST /api/suppliers/import-batch)
  const batchItems = [
    {
      supplier: 'kabum',
      storeSku: 'SKU-BATCH-001',
      ean: '7891234567890',
      title: 'Placa de Vídeo RTX 4060 Teste Batch 1',
      url: 'https://www.kabum.com.br/produto/999001/rtx-4060-teste',
      pricePix: 1850.00,
      priceCard: 2050.00,
      availability: 'em_estoque'
    },
    {
      supplier: 'pichau',
      storeSku: 'SKU-BATCH-002',
      title: 'SSD NVMe 1TB Teste Batch 2',
      url: 'https://www.pichau.com.br/ssd-nvme-1tb-teste-999002',
      pricePix: 450.00,
      priceCard: 510.00,
      availability: 'em_estoque'
    }
  ];

  const importBatchRes1 = await call('/api/suppliers/import-batch', {
    method: 'POST',
    body: { items: batchItems }
  });
  assert.equal(importBatchRes1.res.status, 200);
  assert.equal(importBatchRes1.data.imported, 2);
  assert.equal(importBatchRes1.data.updated, 0);

  // Reimportar os mesmos itens com preço atualizado para validar deduplicação estrita
  batchItems[0].pricePix = 1799.00;
  const importBatchRes2 = await call('/api/suppliers/import-batch', {
    method: 'POST',
    body: { items: batchItems }
  });
  assert.equal(importBatchRes2.res.status, 200);
  assert.equal(importBatchRes2.data.imported, 0, 'Itens com mesma URL/SKU não devem ser duplicados');
  assert.equal(importBatchRes2.data.updated, 2, 'Itens existentes devem ser atualizados');

  // 12. Preservação de preços anteriores em caso de falha de coleta
  const offersAfterBatch = (await call('/api/supplier-offers')).data;
  const pichauOffer = offersAfterBatch.find(o => o.storeSku === 'SKU-BATCH-002');
  assert.ok(pichauOffer);
  assert.equal(pichauOffer.pricePix, 450.00);

  // Tentativa de sincronizar oferta com bloqueio WAF / erro: o preço original deve ser preservado e marcado isStale=1
  const syncFailRes = await call(`/api/supplier-offers/${pichauOffer.id}/sync`, {
    method: 'POST',
    body: {}
  });
  assert.equal(syncFailRes.res.status, 502);
  assert.ok(syncFailRes.data.isStale);

  const offerAfterFail = (await call('/api/supplier-offers')).data.find(o => o.id === pichauOffer.id);
  assert.equal(offerAfterFail.pricePix, 450.00, 'Preço Pix anterior deve ser rigorosamente preservado após falha');
  assert.equal(offerAfterFail.isStale, 1, 'Oferta deve ser marcada como desatualizada (isStale=1)');
  assert.ok(offerAfterFail.lastError, 'Mensagem de erro explicativa deve ser registrada');
});
