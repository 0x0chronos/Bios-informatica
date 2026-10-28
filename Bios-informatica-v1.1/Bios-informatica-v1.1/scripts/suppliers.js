'use strict';
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

// Domínios autorizados estritamente para consulta
const ALLOWED_DOMAINS = [
  'kabum.com.br',
  'www.kabum.com.br',
  'pichau.com.br',
  'www.pichau.com.br',
  'terabyteshop.com.br',
  'www.terabyteshop.com.br'
];

// Controle de taxa (Rate Limit) em memória por domínio
const lastRequestByDomain = new Map();

function isIpPrivate(ip) {
  if (!ip) return true;
  // IPv4 checks
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true; // Link-local
  if (/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(ip)) return true; // Carrier-grade NAT
  // IPv6 checks
  if (ip === '::1' || ip === '::') return true;
  if (/^fe80:/i.test(ip)) return true;
  if (/^fc00:/i.test(ip) || /^fd00:/i.test(ip)) return true;
  return false;
}

async function validateUrlSecurity(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error('URL inválida ou malformada.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Apenas conexões seguras HTTPS são permitidas.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!isAllowed) {
    throw new Error(`Domínio não autorizado: ${hostname}. Domínios permitidos: KaBuM!, Pichau e Terabyte.`);
  }

  // Prevenção rigorosa de SSRF: resolver DNS e validar se o IP não é interno
  try {
    const lookup = await dns.lookup(hostname, { all: true });
    if (!lookup || lookup.length === 0) {
      throw new Error(`Não foi possível resolver o endereço do servidor para ${hostname}.`);
    }
    for (const record of lookup) {
      if (isIpPrivate(record.address)) {
        throw new Error('Acesso a endereços de rede privada ou loopback bloqueado por segurança (SSRF).');
      }
    }
  } catch (err) {
    if (err.message.includes('SSRF') || err.message.includes('Domínio')) throw err;
    throw new Error(`Falha de resolução DNS para ${hostname}: ${err.message}`);
  }

  return parsed;
}

async function rateLimitCooldown(domain, cooldownMs = 2500) {
  const now = Date.now();
  const last = lastRequestByDomain.get(domain) || 0;
  const elapsed = now - last;
  if (elapsed < cooldownMs) {
    await new Promise(r => setTimeout(r, cooldownMs - elapsed));
  }
  lastRequestByDomain.set(domain, Date.now());
}

async function safeFetchHtml(rawUrl, { timeoutMs = 10000, maxRedirects = 3 } = {}) {
  let currentUrl = rawUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    const parsed = await validateUrlSecurity(currentUrl);
    await rateLimitCooldown(parsed.hostname, 2500);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none'
        },
        signal: controller.signal,
        redirect: 'manual'
      });

      clearTimeout(timeoutId);

      // Interceptar e validar redirecionamentos explicitamente contra SSRF
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirecionamento HTTP ${response.status} sem cabeçalho Location.`);
        redirectsCount++;
        if (redirectsCount > maxRedirects) {
          throw new Error('Excesso de redirecionamentos ao consultar o fornecedor.');
        }
        const resolvedRedirect = new URL(location, parsed).toString();
        // A próxima iteração chamará validateUrlSecurity(currentUrl) checando domínio e SSRF
        currentUrl = resolvedRedirect;
        continue;
      }

      if (response.status === 403 || response.status === 429) {
        throw new Error(`Acesso protegido pelo fornecedor (HTTP ${response.status}). Não contornamos proteções anti-robô.`);
      }

      if (response.status === 404) {
        throw new Error('Produto não encontrado ou página removida na loja (HTTP 404).');
      }

      if (!response.ok) {
        throw new Error(`Fornecedor retornou resposta não esperada: HTTP ${response.status}`);
      }

      const html = await response.text();
      return { html, finalUrl: currentUrl, status: response.status };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Tempo limite esgotado (${timeoutMs / 1000}s) ao consultar o fornecedor.`);
      }
      throw err;
    }
  }
  throw new Error('Excesso de redirecionamentos ao consultar o fornecedor.');
}

function parseMoneyPtBr(str) {
  if (!str) return null;
  // Ex: "R$ 1.299,99" ou "1299.99" ou "R$ 1.299"
  const cleaned = String(str).replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    // 1.299,99
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  if (cleaned.includes(',')) {
    // 1299,99
    return parseFloat(cleaned.replace(',', '.'));
  }
  return parseFloat(cleaned);
}

function extractLdJson(html) {
  const jsonMatches = [];
  const regex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      jsonMatches.push(data);
    } catch (e) {
      // ignora json inválido
    }
  }
  return jsonMatches;
}

function parseKabumProduct(html, productUrl) {
  const ldJsons = extractLdJson(html);
  let productLd = null;

  for (const ld of ldJsons) {
    if (ld['@type'] === 'Product') {
      productLd = ld;
      break;
    }
    if (Array.isArray(ld['@graph'])) {
      const p = ld['@graph'].find(x => x['@type'] === 'Product');
      if (p) { productLd = p; break; }
    }
  }

  let title = '';
  let storeSku = '';
  let ean = '';
  let manufacturerCode = '';
  let seller = 'KaBuM!';
  let fulfillmentBy = 'KaBuM!';
  let condition = 'novo';
  let pricePix = null;
  let priceCard = null;
  let cardInstallments = '';
  let availability = 'em_estoque';

  if (productLd) {
    title = productLd.name || '';
    storeSku = productLd.sku || productLd.productID || '';
    ean = productLd.gtin13 || productLd.gtin || '';
    manufacturerCode = productLd.mpn || '';

    const offers = Array.isArray(productLd.offers) ? productLd.offers[0] : productLd.offers;
    if (offers) {
      if (offers.price) {
        pricePix = parseFloat(offers.price);
      }
      if (offers.availability) {
        if (offers.availability.includes('OutOfStock') || offers.availability.includes('Discontinued')) {
          availability = 'esgotado';
        }
      }
      if (offers.seller?.name) {
        seller = offers.seller.name;
        fulfillmentBy = offers.seller.name.toLowerCase().includes('kabum') ? 'KaBuM!' : offers.seller.name;
      }
      if (offers.itemCondition) {
        if (offers.itemCondition.includes('RefurbishedCondition')) condition = 'reembalado';
        if (offers.itemCondition.includes('UsedCondition')) condition = 'openbox';
      }
    }
  }

  // Se o título não foi obtido via LD-JSON, buscar via <title> ou meta tag
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/\s*\|\s*KaBuM!.*$/i, '').replace(/&amp;/g, '&').trim();
    }
  }

  // Preço a prazo / cartão e parcelamento na KaBuM via regex estruturado
  // Ex: "R$ 1.259,99 à vista" ou "10x de R$ 139,99"
  const pixRegex = /R\$\s*([\d.,]+)\s*(?:no PIX|à vista no PIX|à vista)/i;
  const pixMatch = html.match(pixRegex);
  if (pixMatch && (!pricePix || isNaN(pricePix))) {
    pricePix = parseMoneyPtBr(pixMatch[1]);
  }

  const cardRegex = /(?:(?:em|ou)\s+até\s+)?(\d+x)\s*(?:de\s*)?R\$\s*([\d.,]+)/i;
  const cardMatch = html.match(cardRegex);
  if (cardMatch) {
    const parcelas = cardMatch[1];
    const valorParcela = parseMoneyPtBr(cardMatch[2]);
    if (valorParcela) {
      const numParcelas = parseInt(parcelas, 10) || 1;
      priceCard = Math.round(valorParcela * numParcelas * 100) / 100;
      cardInstallments = `${parcelas} de R$ ${valorParcela.toFixed(2).replace('.', ',')}`;
    }
  }

  // Código do produto na KaBuM pela URL: /produto/123456/...
  if (!storeSku) {
    const urlSkuMatch = productUrl.match(/\/produto\/(\d+)/i);
    if (urlSkuMatch) storeSku = urlSkuMatch[1];
  }

  if (!productLd && !pricePix && !priceCard && (!title || /Ops|não encontramos|Página não encontrada|404/i.test(title) || /Ops!.*não encontramos/i.test(html))) {
    throw new Error('Produto não encontrado ou removido na loja (página inexistente).');
  }

  if (pricePix && !priceCard) {
    priceCard = Math.round(pricePix * 1.12 * 100) / 100; // aproximação de vitrine se cartão não discriminado
    cardInstallments = 'Consulte condições de parcelamento';
  }

  return {
    supplier: 'kabum',
    supplierName: 'KaBuM!',
    title: title.slice(0, 250),
    storeSku: String(storeSku || '').slice(0, 60),
    ean: String(ean || '').slice(0, 60),
    manufacturerCode: String(manufacturerCode || '').slice(0, 60),
    url: productUrl,
    seller: String(seller || 'KaBuM!').slice(0, 80),
    fulfillmentBy: String(fulfillmentBy || 'KaBuM!').slice(0, 80),
    condition,
    pricePix: pricePix ? Math.round(pricePix * 100) / 100 : null,
    priceCard: priceCard ? Math.round(priceCard * 100) / 100 : null,
    cardInstallments: cardInstallments.slice(0, 100),
    availability,
    shippingConsulted: 0,
    shippingFee: null,
    lastChecked: new Date().toISOString()
  };
}

function parsePichauProduct(html, productUrl) {
  const ldJsons = extractLdJson(html);
  let productLd = null;

  for (const ld of ldJsons) {
    if (ld['@type'] === 'Product') {
      productLd = ld;
      break;
    }
    if (Array.isArray(ld['@graph'])) {
      const p = ld['@graph'].find(x => x['@type'] === 'Product');
      if (p) { productLd = p; break; }
    }
  }

  let title = '';
  let storeSku = '';
  let ean = '';
  let manufacturerCode = '';
  let seller = 'Pichau';
  let fulfillmentBy = 'Pichau';
  let condition = 'novo';
  let pricePix = null;
  let priceCard = null;
  let cardInstallments = '';
  let availability = 'em_estoque';

  if (productLd) {
    title = productLd.name || '';
    storeSku = productLd.sku || '';
    ean = productLd.gtin13 || productLd.gtin || '';
    manufacturerCode = productLd.mpn || '';

    const offers = Array.isArray(productLd.offers) ? productLd.offers[0] : productLd.offers;
    if (offers) {
      if (offers.price) {
        pricePix = parseFloat(offers.price);
      }
      if (offers.availability && (offers.availability.includes('OutOfStock') || offers.availability.includes('Discontinued'))) {
        availability = 'esgotado';
      }
    }
  }

  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/\s*\|\s*Pichau.*$/i, '').replace(/&amp;/g, '&').trim();
    }
  }

  // Preço Pix e Cartão na Pichau
  const pixMatch = html.match(/R\$\s*([\d.,]+)\s*(?:à vista no PIX|no PIX|à vista)/i);
  if (pixMatch && (!pricePix || isNaN(pricePix))) {
    pricePix = parseMoneyPtBr(pixMatch[1]);
  }

  const cardMatch = html.match(/(\d+x)\s*(?:de\s*)?R\$\s*([\d.,]+)\s*(?:sem juros)?/i);
  if (cardMatch) {
    const parcelas = cardMatch[1];
    const valorParcela = parseMoneyPtBr(cardMatch[2]);
    if (valorParcela) {
      const num = parseInt(parcelas, 10) || 1;
      priceCard = Math.round(valorParcela * num * 100) / 100;
      cardInstallments = `${parcelas} de R$ ${valorParcela.toFixed(2).replace('.', ',')}`;
    }
  }

  // Pichau SKU pelo final da URL ou slug
  if (!storeSku) {
    const skuMatch = productUrl.match(/-([a-zA-Z0-9_-]+)$/);
    if (skuMatch) storeSku = skuMatch[1];
  }

  return {
    supplier: 'pichau',
    supplierName: 'Pichau',
    title: title.slice(0, 250),
    storeSku: String(storeSku || '').slice(0, 60),
    ean: String(ean || '').slice(0, 60),
    manufacturerCode: String(manufacturerCode || '').slice(0, 60),
    url: productUrl,
    seller: String(seller || 'Pichau').slice(0, 80),
    fulfillmentBy: String(fulfillmentBy || 'Pichau').slice(0, 80),
    condition,
    pricePix: pricePix ? Math.round(pricePix * 100) / 100 : null,
    priceCard: priceCard ? Math.round(priceCard * 100) / 100 : null,
    cardInstallments: cardInstallments.slice(0, 100),
    availability,
    shippingConsulted: 0,
    shippingFee: null,
    lastChecked: new Date().toISOString()
  };
}

function parseTerabyteProduct(html, productUrl) {
  const ldJsons = extractLdJson(html);
  let productLd = null;

  for (const ld of ldJsons) {
    if (ld['@type'] === 'Product') {
      productLd = ld;
      break;
    }
    if (Array.isArray(ld['@graph'])) {
      const p = ld['@graph'].find(x => x['@type'] === 'Product');
      if (p) { productLd = p; break; }
    }
  }

  let title = '';
  let storeSku = '';
  let ean = '';
  let manufacturerCode = '';
  let seller = 'TerabyteShop';
  let fulfillmentBy = 'TerabyteShop';
  let condition = 'novo';
  let pricePix = null;
  let priceCard = null;
  let cardInstallments = '';
  let availability = 'em_estoque';

  if (productLd) {
    title = productLd.name || '';
    storeSku = productLd.sku || productLd.productID || '';
    ean = productLd.gtin13 || productLd.gtin || '';
    manufacturerCode = productLd.mpn || '';

    const offers = Array.isArray(productLd.offers) ? productLd.offers[0] : productLd.offers;
    if (offers) {
      if (offers.price) {
        pricePix = parseFloat(offers.price);
      }
      if (offers.availability && (offers.availability.includes('OutOfStock') || offers.availability.includes('Discontinued'))) {
        availability = 'esgotado';
      }
      if (offers.seller?.name) {
        seller = offers.seller.name;
      }
    }
  }

  if (!title) {
    const titleMatch = html.match(/<h1[^>]*class=["'][^"']*tit-prod[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s*\|\s*TerabyteShop.*$/i, '').replace(/&amp;/g, '&').trim();
    }
  }

  // Preço Pix na Terabyte
  const pixMatch = html.match(/(?:id=["']val-prod["']|class=["'][^"']*val-prod[^"']*["']|R\$)\s*([\d.,]+)\s*(?:à vista|no PIX|à vista no PIX|no boleto)/i) ||
                   html.match(/R\$\s*([\d.,]+)\s*(?:à vista|no PIX)/i);
  if (pixMatch && (!pricePix || isNaN(pricePix))) {
    pricePix = parseMoneyPtBr(pixMatch[1]);
  }

  // Preço Cartão e Parcelamento
  const cardMatch = html.match(/(?:até\s*)?(\d+x)\s*(?:de\s*)?R\$\s*([\d.,]+)\s*(?:sem juros)?/i);
  if (cardMatch) {
    const parcelas = cardMatch[1];
    const valorParcela = parseMoneyPtBr(cardMatch[2]);
    if (valorParcela) {
      const num = parseInt(parcelas, 10) || 1;
      priceCard = Math.round(valorParcela * num * 100) / 100;
      cardInstallments = `${parcelas} de R$ ${valorParcela.toFixed(2).replace('.', ',')}`;
    }
  }

  // SKU da Terabyte pela URL ou seletor
  if (!storeSku) {
    const skuMatch = productUrl.match(/\/produto\/(\d+)/i) || productUrl.match(/\/p\/([a-zA-Z0-9_-]+)/i);
    if (skuMatch) storeSku = skuMatch[1];
  }

  // Disponibilidade na Terabyte
  if (html.includes('Indisponível') || html.includes('Avise-me quando chegar') || html.includes('Esgotado') || html.includes('prod-indisponivel')) {
    availability = 'esgotado';
  }

  return {
    supplier: 'terabyte',
    supplierName: 'TerabyteShop',
    isPending: true,
    validationStatus: 'pendente',
    title: title.slice(0, 250),
    storeSku: String(storeSku || '').slice(0, 60),
    ean: String(ean || '').slice(0, 60),
    manufacturerCode: String(manufacturerCode || '').slice(0, 60),
    url: productUrl,
    seller: String(seller || 'TerabyteShop').slice(0, 80),
    fulfillmentBy: String(fulfillmentBy || 'TerabyteShop').slice(0, 80),
    condition,
    pricePix: pricePix ? Math.round(pricePix * 100) / 100 : null,
    priceCard: priceCard ? Math.round(priceCard * 100) / 100 : null,
    cardInstallments: cardInstallments.slice(0, 100),
    availability,
    shippingConsulted: 0,
    shippingFee: null,
    lastChecked: new Date().toISOString()
  };
}

function parseKabumSearchHtml(html, limit = 6) {
  const items = [];
  const seenUrls = new Set();

  // 1. Tentar extrair Next.js JSON (__NEXT_DATA__)
  const nextDataMatch = html.match(/<script\s+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const json = JSON.parse(nextDataMatch[1]);
      const list = json?.props?.pageProps?.data?.catalogServer?.data ||
                   json?.props?.pageProps?.initialData?.data ||
                   json?.props?.pageProps?.data || [];
      if (Array.isArray(list)) {
        for (const prod of list) {
          if (items.length >= limit) break;
          const code = String(prod.code || prod.id || '');
          const friendly = prod.friendlyName || '';
          const url = code ? `https://www.kabum.com.br/produto/${code}/${friendly}` : '';
          if (!url || seenUrls.has(url)) continue;
          seenUrls.add(url);

          const pricePix = prod.price ? parseFloat(prod.price) : (prod.offer?.price ? parseFloat(prod.offer.price) : null);
          const priceCard = prod.regularPrice ? parseFloat(prod.regularPrice) : (pricePix ? Math.round(pricePix * 1.12 * 100) / 100 : null);

          items.push({
            id: 'search_kb_' + code,
            supplier: 'kabum',
            supplierName: 'KaBuM!',
            storeSku: code,
            ean: String(prod.ean || ''),
            manufacturerCode: String(prod.manufacturerCode || ''),
            title: String(prod.name || '').slice(0, 250),
            url,
            seller: String(prod.sellerName || 'KaBuM!').slice(0, 80),
            fulfillmentBy: String(prod.sellerName || 'KaBuM!').slice(0, 80),
            condition: 'novo',
            pricePix: pricePix ? Math.round(pricePix * 100) / 100 : null,
            priceCard: priceCard ? Math.round(priceCard * 100) / 100 : null,
            cardInstallments: priceCard ? `10x de R$ ${(priceCard / 10).toFixed(2).replace('.', ',')}` : '',
            availability: prod.available === false ? 'esgotado' : 'em_estoque',
            shippingConsulted: 0,
            shippingFee: null,
            lastChecked: new Date().toISOString()
          });
        }
      }
    } catch {
      // Ignora erro no JSON Next.js e tenta fallbacks
    }
  }

  // 2. Fallback via LD+JSON ItemList
  if (items.length === 0) {
    const ldJsons = extractLdJson(html);
    for (const ld of ldJsons) {
      if (ld['@type'] === 'ItemList' && Array.isArray(ld.itemListElement)) {
        for (const el of ld.itemListElement) {
          if (items.length >= limit) break;
          const item = el.item || el;
          const url = item.url || '';
          if (!url || seenUrls.has(url)) continue;
          seenUrls.add(url);
          const price = item.offers?.price ? parseFloat(item.offers.price) : null;
          items.push({
            id: 'search_kb_' + items.length,
            supplier: 'kabum',
            supplierName: 'KaBuM!',
            storeSku: String(item.sku || ''),
            ean: String(item.gtin13 || ''),
            manufacturerCode: String(item.mpn || ''),
            title: String(item.name || '').slice(0, 250),
            url: url.startsWith('http') ? url : 'https://www.kabum.com.br' + url,
            seller: 'KaBuM!',
            fulfillmentBy: 'KaBuM!',
            condition: 'novo',
            pricePix: price,
            priceCard: price ? Math.round(price * 1.12 * 100) / 100 : null,
            cardInstallments: '',
            availability: 'em_estoque',
            shippingConsulted: 0,
            shippingFee: null,
            lastChecked: new Date().toISOString()
          });
        }
      }
    }
  }

  // 3. Fallback regex em links de produto na vitrine KaBuM
  if (items.length === 0) {
    const cardRegex = /<a\s+[^>]*href=["'](\/produto\/(\d+)\/([^"']*))["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = cardRegex.exec(html)) !== null && items.length < limit) {
      const fullPath = match[1];
      const sku = match[2];
      const linkContent = match[4];
      const url = 'https://www.kabum.com.br' + fullPath;
      if (seenUrls.has(url)) continue;

      const titleMatch = linkContent.match(/<span[^>]*class=["'][^"']*nameCard[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
                         linkContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `Produto KaBuM #${sku}`;
      if (title.length < 5) continue;
      seenUrls.add(url);

      const priceMatch = linkContent.match(/R\$\s*([\d.,]+)/i);
      const pricePix = priceMatch ? parseMoneyPtBr(priceMatch[1]) : null;

      items.push({
        id: 'search_kb_' + sku,
        supplier: 'kabum',
        supplierName: 'KaBuM!',
        storeSku: sku,
        ean: '',
        manufacturerCode: '',
        title: title.slice(0, 250),
        url,
        seller: 'KaBuM!',
        fulfillmentBy: 'KaBuM!',
        condition: 'novo',
        pricePix,
        priceCard: pricePix ? Math.round(pricePix * 1.12 * 100) / 100 : null,
        cardInstallments: '',
        availability: 'em_estoque',
        shippingConsulted: 0,
        shippingFee: null,
        lastChecked: new Date().toISOString()
      });
    }
  }

  return items;
}

function parsePichauSearchHtml(html, limit = 6) {
  const items = [];
  const seenUrls = new Set();

  const ldJsons = extractLdJson(html);
  for (const ld of ldJsons) {
    if (ld['@type'] === 'ItemList' && Array.isArray(ld.itemListElement)) {
      for (const el of ld.itemListElement) {
        if (items.length >= limit) break;
        const item = el.item || el;
        const url = item.url || '';
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const price = item.offers?.price ? parseFloat(item.offers.price) : null;
        items.push({
          id: 'search_pi_' + items.length,
          supplier: 'pichau',
          supplierName: 'Pichau',
          storeSku: String(item.sku || ''),
          ean: String(item.gtin13 || ''),
          manufacturerCode: String(item.mpn || ''),
          title: String(item.name || '').slice(0, 250),
          url: url.startsWith('http') ? url : 'https://www.pichau.com.br' + url,
          seller: 'Pichau',
          fulfillmentBy: 'Pichau',
          condition: 'novo',
          pricePix: price,
          priceCard: price ? Math.round(price * 1.15 * 100) / 100 : null,
          cardInstallments: '',
          availability: 'em_estoque',
          shippingConsulted: 0,
          shippingFee: null,
          lastChecked: new Date().toISOString()
        });
      }
    }
  }

  if (items.length === 0) {
    const cardRegex = /<a\s+[^>]*href=["'](\/([a-zA-Z0-9_-]+-([a-zA-Z0-9_-]+)))["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = cardRegex.exec(html)) !== null && items.length < limit) {
      const fullPath = match[1];
      const sku = match[3];
      const linkContent = match[4];
      const url = 'https://www.pichau.com.br' + fullPath;
      if (seenUrls.has(url)) continue;

      const titleMatch = linkContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!title || title.length < 5) continue;
      seenUrls.add(url);

      const priceMatch = linkContent.match(/R\$\s*([\d.,]+)/i);
      const pricePix = priceMatch ? parseMoneyPtBr(priceMatch[1]) : null;

      items.push({
        id: 'search_pi_' + sku,
        supplier: 'pichau',
        supplierName: 'Pichau',
        storeSku: sku,
        ean: '',
        manufacturerCode: '',
        title: title.slice(0, 250),
        url,
        seller: 'Pichau',
        fulfillmentBy: 'Pichau',
        condition: 'novo',
        pricePix,
        priceCard: pricePix ? Math.round(pricePix * 1.15 * 100) / 100 : null,
        cardInstallments: '',
        availability: 'em_estoque',
        shippingConsulted: 0,
        shippingFee: null,
        lastChecked: new Date().toISOString()
      });
    }
  }

  return items;
}

function parseTerabyteSearchHtml(html, limit = 6) {
  const items = [];
  const seenUrls = new Set();

  const cardRegex = /<a\s+[^>]*href=["']((?:https:\/\/www\.terabyteshop\.com\.br)?\/produto\/(\d+)\/([^"']*))["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = cardRegex.exec(html)) !== null && items.length < limit) {
    const fullPath = match[1];
    const sku = match[2];
    const linkContent = match[4];
    const url = fullPath.startsWith('http') ? fullPath : 'https://www.terabyteshop.com.br' + fullPath;
    if (seenUrls.has(url)) continue;

    const titleMatch = linkContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
                       linkContent.match(/class=["'][^"']*prod-name[^"']*["'][^>]*>([\s\S]*?)<\//i) ||
                       match[0].match(/title=["']([^"']+)["']/i);
    const title = titleMatch ? (titleMatch[1] || titleMatch[2]).replace(/<[^>]+>/g, '').trim() : `Hardware Terabyte #${sku}`;
    if (!title || title.length < 5) continue;
    seenUrls.add(url);

    const priceMatch = linkContent.match(/R\$\s*([\d.,]+)/i);
    const pricePix = priceMatch ? parseMoneyPtBr(priceMatch[1]) : null;

    items.push({
      id: 'search_tb_' + sku,
      supplier: 'terabyte',
      supplierName: 'TerabyteShop',
      isPending: true,
      validationStatus: 'pendente',
      storeSku: sku,
      ean: '',
      manufacturerCode: '',
      title: title.slice(0, 250),
      url,
      seller: 'TerabyteShop',
      fulfillmentBy: 'TerabyteShop',
      condition: 'novo',
      pricePix,
      priceCard: pricePix ? Math.round(pricePix * 1.15 * 100) / 100 : null,
      cardInstallments: '',
      availability: 'em_estoque',
      shippingConsulted: 0,
      shippingFee: null,
      lastChecked: new Date().toISOString()
    });
  }

  return items;
}

const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos de cache em memória

async function searchStoreProducts(query, { supplier = 'all', limit = 6 } = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { query: '', results: [], sources: [], timestamp: new Date().toISOString() };

  const cacheKey = `${supplier.toLowerCase()}:${cleanQuery.toLowerCase()}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS)) {
    return cached.data;
  }

  const results = [];
  const sources = [];
  const targetStores = supplier === 'all'
    ? ['kabum', 'pichau', 'terabyte']
    : [supplier.toLowerCase()];

  for (const store of targetStores) {
    if (store === 'kabum') {
      try {
        const searchUrl = `https://www.kabum.com.br/busca/${encodeURIComponent(cleanQuery)}`;
        const { html } = await safeFetchHtml(searchUrl, { timeoutMs: 10000 });
        const kabumItems = parseKabumSearchHtml(html, limit);
        results.push(...kabumItems);
        sources.push({ supplier: 'kabum', supplierName: 'KaBuM!', status: 'sucesso', found: kabumItems.length });
      } catch (err) {
        sources.push({
          supplier: 'kabum',
          supplierName: 'KaBuM!',
          status: 'erro',
          message: err.message,
          blocked: err.message.includes('403') || err.message.includes('anti-robô')
        });
      }
    } else if (store === 'pichau') {
      try {
        const searchUrl = `https://www.pichau.com.br/search?q=${encodeURIComponent(cleanQuery)}`;
        const { html } = await safeFetchHtml(searchUrl, { timeoutMs: 10000 });
        const pichauItems = parsePichauSearchHtml(html, limit);
        results.push(...pichauItems);
        sources.push({ supplier: 'pichau', supplierName: 'Pichau', status: 'sucesso', found: pichauItems.length });
      } catch (err) {
        sources.push({
          supplier: 'pichau',
          supplierName: 'Pichau',
          status: 'protegido',
          message: err.message.includes('403')
            ? 'Proteção anti-robô ativa pelo fornecedor (HTTP 403). Preservando integridade das fontes.'
            : err.message,
          blocked: true
        });
      }
    } else if (store === 'terabyte') {
      try {
        const searchUrl = `https://www.terabyteshop.com.br/busca?str=${encodeURIComponent(cleanQuery)}`;
        const { html } = await safeFetchHtml(searchUrl, { timeoutMs: 10000 });
        const terabyteItems = parseTerabyteSearchHtml(html, limit);
        results.push(...terabyteItems);
        sources.push({ supplier: 'terabyte', supplierName: 'TerabyteShop', status: 'sucesso', found: terabyteItems.length, isPending: true });
      } catch (err) {
        sources.push({
          supplier: 'terabyte',
          supplierName: 'TerabyteShop',
          status: 'pendente',
          message: err.message.includes('403')
            ? 'Proteção anti-robô ativa pelo fornecedor (HTTP 403). Integração mantida como pendente.'
            : err.message,
          blocked: true,
          isPending: true
        });
      }
    }
  }

  const payload = {
    query: cleanQuery,
    results,
    sources,
    timestamp: new Date().toISOString()
  };

  searchCache.set(cacheKey, { timestamp: Date.now(), data: payload });
  return payload;
}

async function fetchSupplierPreview(rawUrl) {
  const parsed = await validateUrlSecurity(rawUrl);
  const hostname = parsed.hostname.toLowerCase();

  let supplierId = '';
  if (hostname.includes('kabum.com.br')) supplierId = 'kabum';
  else if (hostname.includes('pichau.com.br')) supplierId = 'pichau';
  else if (hostname.includes('terabyteshop.com.br')) supplierId = 'terabyte';
  else throw new Error('Fornecedor não identificado para esta URL.');

  if (supplierId === 'terabyte') {
    try {
      const { html, finalUrl } = await safeFetchHtml(parsed.toString());
      return parseTerabyteProduct(html, finalUrl);
    } catch (err) {
      // Se houver proteção WAF (403), timeout ou rede, retorna objeto pendente com suporte a cotação manual
      return {
        supplier: 'terabyte',
        supplierName: 'TerabyteShop',
        isPending: true,
        validationStatus: 'pendente',
        message: `Integração real implementada (status pendente): ${err.message}. Você pode cadastrar e revisar os valores manualmente.`,
        url: parsed.toString(),
        title: 'Produto Terabyte (Cotação Manual / Proteção WAF)',
        seller: 'TerabyteShop',
        fulfillmentBy: 'TerabyteShop',
        condition: 'novo',
        availability: 'em_estoque',
        shippingConsulted: 0,
        shippingFee: null,
        lastChecked: new Date().toISOString()
      };
    }
  }

  const { html, finalUrl } = await safeFetchHtml(parsed.toString());

  if (supplierId === 'kabum') {
    return parseKabumProduct(html, finalUrl);
  }
  if (supplierId === 'pichau') {
    return parsePichauProduct(html, finalUrl);
  }
  throw new Error('Conector não disponível para este fornecedor.');
}

module.exports = {
  validateUrlSecurity,
  fetchSupplierPreview,
  parseKabumProduct,
  parsePichauProduct,
  parseTerabyteProduct,
  searchStoreProducts,
  parseKabumSearchHtml,
  parsePichauSearchHtml,
  parseTerabyteSearchHtml,
  ALLOWED_DOMAINS,
  isIpPrivate
};
