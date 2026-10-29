#!/usr/bin/env python3
"""Coleta ofertas públicas, sem estimar preços ou alterar orçamentos existentes."""
import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit
from bs4 import BeautifulSoup
try:
    from .catalog_sources import DEPARTMENTS, BRANDS
except ImportError:
    from catalog_sources import DEPARTMENTS, BRANDS

STORES = {'kabum': ('KaBuM!', 'www.kabum.com.br'), 'pichau': ('Pichau', 'www.pichau.com.br'),
          'terabyte': ('TerabyteShop', 'www.terabyteshop.com.br')}


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def clean_text(value, limit=4000):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


def money(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        match = re.search(r'(?:R\$\s*)?([\d.]+,\d{2}|\d+(?:\.\d+)?)', value.replace('\u00a0', ' '))
        if not match:
            return None
        value = match[1]
        if ',' in value:
            value = value.replace('.', '').replace(',', '.')
    try:
        amount = Decimal(str(value))
        return float(amount.quantize(Decimal('.01'))) if amount.is_finite() and amount > 0 else None
    except (InvalidOperation, ValueError):
        return None


def node_text(node):
    return clean_text(node.get_text(' ', strip=True)) if node else ''


def canonical_url(value, store):
    parsed = urlsplit(urljoin('https://' + STORES[store][1], str(value or '')))
    if parsed.scheme != 'https' or parsed.hostname not in {STORES[store][1], STORES[store][1][4:]} or parsed.username or parsed.port:
        raise ValueError('Link de produto fora da loja')
    return urlunsplit(('https', STORES[store][1], parsed.path.rstrip('/'), '', ''))


def image_url(value, store):
    if not value:
        return None
    url = urljoin('https://' + STORES[store][1], str(value))
    parsed = urlsplit(url)
    return url if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.port and 'placeholder' not in url else None


def product(store, title, url, **fields):
    title = clean_text(title, 250)
    if len(title) < 5:
        raise ValueError('Título de produto ausente')
    return {'supplierId': store, 'store': STORES[store][0], 'title': title, 'url': canonical_url(url, store),
            'sku': '', 'pricePix': None, 'priceCard': None, 'cardInstallments': '',
            'availability': 'sob_consulta', 'imageUrl': None, 'seller': STORES[store][0],
            'brand': next((b for b in BRANDS if re.search(r'\b' + re.escape(b) + r'\b', title, re.I)), 'Não informado'), **fields}


def kabum_catalog(soup):
    script = soup.find('script', id='__NEXT_DATA__')
    if not script:
        raise ValueError('Dados estruturados KaBuM não encontrados')
    raw = json.loads(script.string)['props']['pageProps']['data']
    return (json.loads(raw) if isinstance(raw, str) else raw)['catalogServer']


def parse_kabum(soup):
    items = []
    for p in kabum_catalog(soup)['data']:
        code, available = str(p['code']), p.get('available')
        items.append(product('kabum', p['name'], '/produto/' + code + '/' + p.get('friendlyName', ''), sku=code,
            pricePix=money(p.get('priceWithDiscount')), priceCard=money(p.get('price')),
            cardInstallments=clean_text(p.get('maxInstallment'), 100),
            availability='em_estoque' if available is True else ('esgotado' if available is False else 'sob_consulta'),
            imageUrl=image_url(p.get('image'), 'kabum'), seller=clean_text(p.get('sellerName') or STORES['kabum'][0], 80),
            brand=clean_text((p.get('manufacturer') or {}).get('name'), 80) or 'Não informado',
            specs=node_text(BeautifulSoup(p.get('description') or '', 'html.parser')) if '<' in (p.get('description') or '') else clean_text(p.get('description'))))
    return items


def card_availability(card):
    if re.search(r'esgotad|indisponível|indisponivel|avise.me', node_text(card), re.I):
        return 'esgotado'
    return 'em_estoque' if card.select_one('button[aria-label="Comprar"], button[data-produto], [class*="availability_span_available"]') else 'sob_consulta'


def parse_pichau(soup):
    items = []
    for card in soup.select('a[data-cy="list-product"]'):
        img = card.find('img')
        items.append(product('pichau', node_text(card.find('h2')) or (img.get('alt', '') if img else ''), card['href'],
            pricePix=money(node_text(card.select_one('[class*="price_vista"]'))),
            priceCard=money(node_text(card.select_one('[class*="price_total"]'))),
            cardInstallments=node_text(card.select_one('[class*="price_parcelado_text"]'))[:100],
            availability=card_availability(card), imageUrl=image_url(img.get('src') or img.get('data-src'), 'pichau') if img else None))
    return items


def parse_terabyte(soup):
    items = []
    for card in soup.select('.product-item'):
        link = card.select_one('a.product-item__name')
        if not link:
            continue
        img, url = card.select_one('.product-item__image img'), link.get('href', '')
        sku = re.search(r'/produto/(\d+)', url)
        items.append(product('terabyte', link.get('title') or node_text(link), url, sku=sku[1] if sku else '',
            pricePix=money(node_text(card.select_one('.product-item__new-price span'))),
            # Instalments are advertised separately; do not invent a total from rounding.
            priceCard=money(node_text(card.select_one('.product-item__card-price, [data-price-card]'))),
            cardInstallments=node_text(card.select_one('.product-item__juros'))[:100],
            availability=card_availability(card), imageUrl=image_url(img.get('src') or img.get('data-src'), 'terabyte') if img else None))
    return items


def next_page(soup, store, current_url):
    if store == 'kabum':
        pagination = kabum_catalog(soup)['pagination']
        page = int(pagination.get('next') or 0)
        if not page or page <= int(pagination['current']) or int(pagination['current']) >= int(pagination.get('total') or page):
            return None
        parsed = urlsplit(current_url)
        query = parse_qs(parsed.query)
        query['page_number'] = [str(page)]
        return urlunsplit(parsed._replace(query=urlencode(query, doseq=True)))
    for link in soup.select('a[rel="next"], a[aria-label*="next page"], a[aria-label*="próxima"], .pagination a.next, .paginacao a.proximo'):
        if link.get('aria-disabled') == 'true' or link.get('disabled') is not None:
            continue
        target = urljoin(current_url, link.get('href') or '')
        parsed, current = urlsplit(target), urlsplit(current_url)
        if parsed.hostname != current.hostname or parsed.path != current.path:
            raise ValueError('Paginação fora da categoria')
        if target != current_url:
            return target
    return None


def parse_page(html, store, url):
    soup = BeautifulSoup(html or '', 'html.parser')
    items = {'kabum': parse_kabum, 'pichau': parse_pichau, 'terabyte': parse_terabyte}[store](soup)
    if not items or not any(p['pricePix'] or p['priceCard'] or p['availability'] == 'esgotado' for p in items):
        raise ValueError('Nenhum produto/preço reconhecido; catálogo anterior preservado')
    return list({p['url']: p for p in items}.values()), next_page(soup, store, url)


def open_database(database=None):
    if database:
        conn = sqlite3.connect(database, timeout=30)
        conn.execute('PRAGMA foreign_keys=ON')
        return conn, False
    connection = os.getenv('DATABASE_URL', '')
    if not connection.startswith(('postgres://', 'postgresql://')):
        raise ValueError('Configure DATABASE_URL ou use --database para SQLite de teste; --dry-run não grava')
    import psycopg2
    return psycopg2.connect(connection, connect_timeout=15, sslmode='require'), True


def save_products(conn, postgres, products, margin=.25):
    """Atomic batch. Preserve custom sale prices, manual parts and existing quotes."""
    stamp = utcnow()
    def execute(cursor, sql, args):
        cursor.execute(sql.replace('?', '%s') if postgres else sql, args)
    with conn:
        cursor = conn.cursor()
        try:
            for p in products:
                supplier = p['supplierId']
                digest = hashlib.sha256(p['url'].encode()).hexdigest()[:12]
                part_id, offer_id = f'part_{supplier}_{digest}', f'so_{supplier}_{digest}'
                execute(cursor, 'SELECT id,"partId","autoSync" FROM supplier_offers WHERE "supplierId"=? AND (url=? OR (? != \'\' AND "storeSku"=?)) ORDER BY created ASC LIMIT 1',
                        (supplier, p['url'], p['sku'], p['sku']))
                existing = cursor.fetchone()
                if existing:
                    offer_id, linked_part, auto_sync = existing
                    if not auto_sync:
                        continue
                    part_id = linked_part or part_id
                cost = p['pricePix'] or p['priceCard']
                status = 'sob_encomenda' if p['availability'] == 'em_estoque' else 'a_confirmar'
                if part_id == f'part_{supplier}_{digest}':
                    execute(cursor, '''INSERT INTO parts(id,category,brand,model,sku,specs,supplier,cost,price,status,active,notes,"imageUrl",created,updated)
                        VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                        cost=COALESCE(?,parts.cost),status=excluded.status,model=excluded.model,
                        "imageUrl"=COALESCE(excluded."imageUrl",parts."imageUrl"),updated=excluded.updated''',
                        (part_id,p['category'],p['brand'],p['title'],p['sku'],p.get('specs',''),p['store'],cost or 0,
                         round((cost or 0)*(1+margin),2),status,p['url'],p.get('imageUrl'),stamp,stamp,cost))
                execute(cursor, '''INSERT INTO supplier_offers(id,"partId","supplierId","storeSku",title,url,seller,"fulfillmentBy",condition,
                    "pricePix","priceCard","cardInstallments",availability,"imageUrl","lastChecked","isStale","autoSync",created,updated)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?) ON CONFLICT(id) DO UPDATE SET
                    "partId"=COALESCE(supplier_offers."partId",excluded."partId"),title=excluded.title,url=excluded.url,seller=excluded.seller,
                    "pricePix"=excluded."pricePix","priceCard"=excluded."priceCard","cardInstallments"=excluded."cardInstallments",
                    availability=excluded.availability,"lastPricePix"=supplier_offers."pricePix",
                    "imageUrl"=COALESCE(excluded."imageUrl",supplier_offers."imageUrl"),"lastChecked"=excluded."lastChecked",
                    "isStale"=0,"lastError"=NULL,updated=excluded.updated''',
                     (offer_id,part_id,supplier,p['sku'],p['title'],p['url'],p['seller'],p.get('fulfillmentBy',''),'novo',p['pricePix'],p['priceCard'],
                     p['cardInstallments'],p['availability'],p.get('imageUrl'),stamp,stamp,stamp))
        finally:
            cursor.close()
    return len(products)


def save_log(conn, postgres, supplier, status, message):
    sql = 'INSERT INTO supplier_sync_logs("supplierId",trigger,status,message,created) VALUES(?,?,?,?,?)'
    with conn:
        cursor = conn.cursor()
        try:
            cursor.execute(sql.replace('?', '%s') if postgres else sql, (supplier,'crawler',status,message[:1000],utcnow()))
        finally:
            cursor.close()


async def collect_category(crawler, store, category, url, *, pages=0, max_pages=100, save=None):
    from crawl4ai import CacheMode, CrawlerRunConfig
    report = {'store':store,'category':category,'pages':0,'products':0,'complete':False}
    visited, known, products = set(), set(), []
    try:
        while url:
            if url in visited:
                raise ValueError('Paginação repetiu uma URL')
            visited.add(url)
            await asyncio.sleep(5)
            result = await crawler.arun(url=url, config=CrawlerRunConfig(
                session_id='catalog-' + store,cache_mode=CacheMode.BYPASS,page_timeout=60000,delay_before_return_html=2,verbose=False))
            if not result.success or (getattr(result,'status_code',0) or 0) >= 400:
                raise ValueError('Loja indisponível ou bloqueada (HTTP ' + str(getattr(result,'status_code',None)) + ')')
            items, following = parse_page(result.html, store, url)
            fresh = [p for p in items if p['url'] not in known]
            if not fresh:
                raise ValueError('Loja repetiu os produtos da página anterior')
            for p in fresh:
                p.update(category=category,lastChecked=utcnow())
            if save:
                save(fresh)
            known.update(p['url'] for p in fresh)
            products.extend(fresh)
            report['pages'] += 1
            report['products'] += len(fresh)
            print(json.dumps({**report,'event':'page'}),flush=True)
            if not following:
                report['complete'] = True
                break
            if report['pages'] >= (pages or max_pages):
                if pages:
                    report['limited'] = True
                    report['message'] = 'Limite solicitado de páginas atingido; coleta parcial'
                else:
                    report['error'] = 'Limite de segurança atingido; coleta parcial'
                break
            url = following
    except Exception as error:
        # Database exception strings can contain connection credentials.
        report['error'] = str(error) if isinstance(error,ValueError) else type(error).__name__
    return products, report


async def run(args, publisher=None):
    from crawl4ai import AsyncWebCrawler, BrowserConfig
    selected = {k:v for k,v in DEPARTMENTS.items() if not args.category or args.category.casefold() in k.casefold()}
    if not selected:
        raise ValueError('Categoria não encontrada')
    stores = getattr(args,'stores',None) or (list(STORES) if args.store == 'all' else [args.store])
    conn, postgres = (None,False) if args.dry_run or publisher else open_database(args.database)
    reports, products, started = [], {}, utcnow()
    try:
        async with AsyncWebCrawler(config=BrowserConfig(headless=True,enable_stealth=True,verbose=False)) as crawler:
            for store in stores:
                failures = 0
                for category, paths in selected.items():
                    if failures >= 3:
                        reports.append({'store':store,'category':category,'pages':0,'products':0,'complete':False,
                                        'error':'Coleta interrompida após três falhas consecutivas da loja'})
                        continue
                    url = paths[store].format(page=1)
                    if store != 'kabum':
                        url = urlunsplit(urlsplit(url)._replace(query=''))
                    items, report = await collect_category(crawler,store,category,url,pages=args.pages,max_pages=args.max_pages,
                        save=publisher.save if publisher else ((lambda batch:save_products(conn,postgres,batch,args.margin)) if conn else None))
                    reports.append(report)
                    print(json.dumps(report),flush=True)
                    failures = failures + 1 if report['pages'] == 0 else 0
                    products.update(((p['supplierId'],p['url']),p) for p in items)
                store_reports = [r for r in reports if r['store']==store]
                if conn:
                    save_log(conn,postgres,store,'sucesso' if all(r['complete'] for r in store_reports) else 'parcial',json.dumps(store_reports,ensure_ascii=False))
    finally:
        if conn:
            conn.close()
        output = {'started':started,'finished':utcnow(),'dryRun':args.dry_run,'complete':bool(reports) and all(r['complete'] for r in reports),
                  'reports':reports,'products':list(products.values())}
        target = Path(args.output)
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(target),'products':len(products),'complete':output['complete']}),flush=True)
    return 0 if reports and all(r['complete'] or r.get('limited') for r in reports) else 1


def main():
    parser = argparse.ArgumentParser(description='Atualiza o catálogo salvo de fornecedores')
    parser.add_argument('--all',action='store_true')
    parser.add_argument('--store',choices=['all',*STORES],default='all')
    parser.add_argument('--category',default='')
    parser.add_argument('--pages',type=int,default=0,help='0 percorre até o fim; >0 limita a coleta')
    parser.add_argument('--max-pages',type=int,default=100)
    parser.add_argument('--database',help='SQLite explícito para teste local; em produção use DATABASE_URL')
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--publish',action='store_true',help='Envia ao site sem acesso direto ao banco')
    parser.add_argument('--queue-db',default='scratch/catalog-upload.sqlite')
    parser.add_argument('--output',default='scratch/catalog-report.json')
    parser.add_argument('--margin',type=float,default=.25,help='Acréscimo inicial; preços de venda existentes são preservados')
    args = parser.parse_args()
    if args.pages < 0 or args.max_pages < 1 or not math.isfinite(args.margin) or not 0 <= args.margin <= 10:
        parser.error('Limites ou acréscimo inválidos')
    if args.publish and args.dry_run:
        parser.error('--publish não pode ser combinado com --dry-run')
    publisher = None
    try:
        if args.publish:
            try:
                from .catalog_publisher import CatalogPublisher
            except ImportError:
                from catalog_publisher import CatalogPublisher
            token = os.environ.get('CATALOG_SYNC_TOKEN','')
            if len(token) < 40:
                raise ValueError('Configure CATALOG_SYNC_TOKEN para enviar ofertas ao site')
            Path(args.queue_db).parent.mkdir(parents=True,exist_ok=True)
            publisher = CatalogPublisher(args.queue_db,'https://biosinformatica.store/api/suppliers/catalog-sync',token)
            publisher.flush()
        result = asyncio.run(run(args,publisher=publisher))
        if publisher:
            publisher.flush()
            if publisher.pending():
                print(json.dumps({'pending':publisher.pending(),'uploadError':publisher.last_error}),file=sys.stderr)
                return 1
        return result
    except Exception as error:
        print('Falha: ' + (str(error) if isinstance(error,ValueError) else type(error).__name__),file=sys.stderr)
        return 1
    finally:
        if publisher: publisher.close()


if __name__ == '__main__':
    if hasattr(sys.stdout,'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
