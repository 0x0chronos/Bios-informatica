#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bios Informática — Crawler Central de Fornecedores de Hardware (KaBuM!, TerabyteShop, Pichau)
Extrai produtos, preços (Pix e Cartão), fotos em alta resolução, SKUs, links oficiais
e sincroniza com o banco de dados (Supabase PostgreSQL ou SQLite local).

Projetado para rodar localmente ou via GitHub Actions (CRON: 00:00 e 12:00 BRT).
"""

import asyncio
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

sys.stdout.reconfigure(encoding='utf-8')

# Lista de caminhos para banco SQLite local caso DATABASE_URL não esteja definido
DEFAULT_DB_PATHS = [
    os.path.join(os.path.dirname(__file__), "..", "database.sqlite"),
    os.path.join(os.path.dirname(__file__), "..", "Bios-informatica-producao", "database.sqlite"),
    os.path.join(os.path.dirname(__file__), "..", "Bios-informatica-redesign", "database.sqlite"),
    os.path.join(os.path.dirname(__file__), "..", "Bios-informatica-v1.1", "database.sqlite")
]

# Categorias completas de montagem de computadores e peças
ALL_CATEGORIES = {
    "Processador": [
        "Ryzen 5 5600",
        "Ryzen 7 5700X",
        "Ryzen 5 7600",
        "Ryzen 7 7800X3D",
        "Core i5 12400F",
        "Core i5 13400F",
        "Core i5 14600K",
        "Core i3 12100F"
    ],
    "Placa de Vídeo": [
        "RTX 4060",
        "RTX 4060 Ti",
        "RTX 4070 Super",
        "RTX 3060",
        "RX 6600",
        "RX 7600"
    ],
    "Placa-Mãe": [
        "B550M",
        "A520M",
        "B450M",
        "B650M",
        "H610M",
        "B760M"
    ],
    "Memória RAM": [
        "Memoria 16GB DDR4",
        "Memoria 8GB DDR4",
        "Memoria 16GB DDR5",
        "Memoria 32GB DDR5"
    ],
    "Armazenamento / SSD": [
        "SSD NVMe 1TB",
        "SSD NVMe 500GB",
        "SSD NVMe 2TB",
        "SSD Kingston 480GB"
    ],
    "Fonte": [
        "Fonte 500W 80 Plus",
        "Fonte 600W 80 Plus",
        "Fonte 650W 80 Plus",
        "Fonte 750W 80 Plus"
    ],
    "Gabinete": [
        "Gabinete Gamer Aquario",
        "Gabinete Gamer Mesh",
        "Gabinete Micro ATX",
        "Gabinete Montech"
    ],
    "Refrigeração / Cooler": [
        "Air Cooler 120mm",
        "Water Cooler 240mm",
        "Water Cooler 360mm"
    ],
    "Periféricos & Monitores": [
        "Monitor Gamer 144Hz",
        "Monitor Gamer 180Hz",
        "Teclado Mecanico",
        "Mouse Gamer"
    ]
}

BRANDS = [
    "ASUS", "GIGABYTE", "MSI", "ASROCK", "AMD", "INTEL", "NVIDIA", "CORSAIR",
    "KINGSTON", "XPG", "ADATA", "CRUCIAL", "GALAX", "PNY", "PALIT", "INNO3D",
    "PCYES", "MANCER", "PICHAU", "SUPERFRAME", "REDRAGON", "DEEPCOOL", "COOLER MASTER",
    "THERMALRIGHT", "MONTECH", "RISE MODE", "HUSKY", "SAMSUNG", "WESTERN DIGITAL", "SEAGATE",
    "LOGITECH", "RAZER", "TGT", "AOC", "LG", "ACER", "DELL", "GAMEMAX", "COUGAR"
]

def detect_brand(title):
    t_upper = title.upper()
    for b in BRANDS:
        if re.search(r'\b' + re.escape(b) + r'\b', t_upper):
            return b
    return "Bios"

def detect_category(title, fallback="Hardware"):
    t_lower = title.lower()
    if any(k in t_lower for k in ["rtx", "gtx", "rx 6", "rx 7", "radeon", "geforce", "placa de vídeo", "placa de video"]):
        return "Placa de Vídeo"
    if any(k in t_lower for k in ["ryzen", "core i3", "core i5", "core i7", "core i9", "processador", "athlon", "pentium"]):
        return "Processador"
    if any(k in t_lower for k in ["placa-mãe", "placa mãe", "placa mae", "b550", "b450", "a520", "h610", "b760", "b650", "a620", "z790"]):
        return "Placa-Mãe"
    if any(k in t_lower for k in ["memória", "memoria", "ddr4", "ddr5"]) and "ssd" not in t_lower:
        return "Memória RAM"
    if any(k in t_lower for k in ["ssd", "nvme", "m.2", "sata", "disco rígido", "hd 1tb", "hd 2tb"]):
        return "Armazenamento / SSD"
    if any(k in t_lower for k in ["fonte", "80 plus", "atx 600w", "atx 500w", "atx 650w", "atx 750w", "watts"]):
        return "Fonte"
    if any(k in t_lower for k in ["gabinete", "aquário", "aquario", "mid tower", "micro atx"]):
        return "Gabinete"
    if any(k in t_lower for k in ["water cooler", "air cooler", "cooler", "fan 120mm", "ventoinha"]):
        return "Refrigeração / Cooler"
    if any(k in t_lower for k in ["monitor", "teclado", "mouse", "headset"]):
        return "Periféricos & Monitores"
    return fallback

def parse_money(text):
    if not text:
        return None
    m = re.search(r'R\$\s*([\d\.,]+)', text)
    if not m:
        m = re.search(r'(\d{1,3}(?:\.\d{3})*,\d{2})', text)
    if m:
        val_str = m.group(1).replace('.', '').replace(',', '.')
        try:
            return float(val_str)
        except:
            return None
    return None

def clean_image_url(url, base_url=""):
    if not url or url.startswith('data:') or 'placeholder' in url:
        return None
    url = url.strip()
    if url.startswith('//'):
        return 'https:' + url
    if url.startswith('/'):
        return base_url.rstrip('/') + url
    return url

def clean_title(title):
    if not title:
        return ""
    # Remove unicode private area icons (ex: rating stars / heart symbols)
    title = re.sub(r'[\ue000-\uf8ff]', '', title)
    title = re.sub(r'Avalia[çc][ãa]o\s*[\d\.,]+\s*de\s*[\d\.,]+', '', title, flags=re.I)
    title = re.sub(r'\s+', ' ', title).strip()
    return title

def parse_kabum(html):
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    
    # 1. Tentar ler script __NEXT_DATA__
    next_script = soup.find('script', id='__NEXT_DATA__')
    if next_script:
        try:
            data = json.loads(next_script.string)
            pp = data.get('props', {}).get('pageProps', {})
            raw_data = pp.get('data')
            if isinstance(raw_data, str):
                try:
                    raw_data = json.loads(raw_data)
                except Exception:
                    pass
            
            prod_list = []
            if isinstance(raw_data, dict):
                prod_list = (raw_data.get('catalogServer', {}).get('data') or
                             raw_data.get('initialData', {}).get('data') or
                             raw_data.get('data') or [])
            elif isinstance(raw_data, list):
                prod_list = raw_data
            elif isinstance(pp, dict):
                prod_list = (pp.get('catalogServer', {}).get('data') or
                             pp.get('initialData', {}).get('data') or
                             pp.get('data') or [])

            if isinstance(prod_list, list):
                for p in prod_list:
                    code = str(p.get('code') or p.get('id') or '')
                    friendly = p.get('friendlyName') or ''
                    url = f"https://www.kabum.com.br/produto/{code}/{friendly}" if code else ""
                    price_pix = float(p.get('price') or p.get('offer', {}).get('price') or 0) or None
                    name = clean_title(p.get('name') or '')
                    img_url = p.get('image') or (p.get('images', [None])[0] if isinstance(p.get('images'), list) else None)
                    if name and price_pix and price_pix > 20:
                        items.append({
                            "supplierId": "kabum",
                            "store": "KaBuM!",
                            "sku": code,
                            "title": name,
                            "pricePix": price_pix,
                            "priceCard": round(price_pix * 1.12, 2),
                            "url": url,
                            "imageUrl": clean_image_url(img_url, "https://www.kabum.com.br"),
                            "available": p.get('available', True)
                        })
        except Exception:
            pass
            
    # 2. Fallback por tags HTML
    if not items:
        cards = soup.select('article, .productCard, a[href*="/produto/"]')
        for card in cards:
            a_tag = card if card.name == 'a' and '/produto/' in card.get('href', '') else card.find('a', href=re.compile(r'/produto/\d+'))
            if not a_tag:
                continue
            href = a_tag.get('href', '')
            url = href if href.startswith('http') else f"https://www.kabum.com.br{href}"
            
            title_el = card.find(class_=re.compile(r'nameCard|title|heading', re.I)) or card.find(['h2', 'h3'])
            raw_title = title_el.get_text(strip=True) if title_el else a_tag.get_text(strip=True)
            title = clean_title(raw_title)
            if not title or len(title) < 6:
                continue
                
            price_el = card.find(class_=re.compile(r'price|valor', re.I)) or card
            price_pix = parse_money(price_el.get_text()) if price_el else None
            
            sku_m = re.search(r'/produto/(\d+)', url)
            sku = sku_m.group(1) if sku_m else ''
            
            img_tag = card.find('img')
            img_url = None
            if img_tag:
                img_url = img_tag.get('src') or img_tag.get('data-src') or img_tag.get('srcset', '').split(' ')[0]
            
            if title and price_pix and price_pix > 20 and not any(it['url'] == url for it in items):
                items.append({
                    "supplierId": "kabum",
                    "store": "KaBuM!",
                    "sku": sku,
                    "title": title[:220].strip(),
                    "pricePix": price_pix,
                    "priceCard": round(price_pix * 1.12, 2),
                    "url": url,
                    "imageUrl": clean_image_url(img_url, "https://www.kabum.com.br"),
                    "available": True
                })
    return items

def parse_terabyte(html):
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    
    cards = soup.select('.pbox, .product-item, div[data-id], a[href*="/produto/"]')
    for c in cards:
        a_tag = c if c.name == 'a' and '/produto/' in c.get('href', '') else c.find('a', href=re.compile(r'/produto/\d+'))
        if not a_tag:
            continue
        href = a_tag.get('href', '')
        url = href if href.startswith('http') else f"https://www.terabyteshop.com.br{href}"
        
        title_el = c.find(class_=re.compile(r'prod-name|product-title', re.I)) or c.find(['h2', 'h3']) or a_tag
        raw_title = title_el.get_text(strip=True) if title_el else ''
        title = clean_title(raw_title)
        if not title or len(title) < 6:
            continue
            
        sku_m = re.search(r'/produto/(\d+)', url)
        sku = sku_m.group(1) if sku_m else ''
        
        price_pix = parse_money(c.get_text())
        
        img_tag = c.find('img')
        img_url = None
        if img_tag:
            img_url = img_tag.get('data-src') or img_tag.get('src') or img_tag.get('data-original')
            
        if title and price_pix and price_pix > 20 and not any(it['url'] == url for it in items):
            items.append({
                "supplierId": "terabyte",
                "store": "TerabyteShop",
                "sku": sku,
                "title": title[:220].strip(),
                "pricePix": price_pix,
                "priceCard": round(price_pix * 1.15, 2),
                "url": url,
                "imageUrl": clean_image_url(img_url, "https://www.terabyteshop.com.br"),
                "available": True
            })
    return items

def parse_pichau(html):
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    
    links = soup.select('a[href*="-"]')
    for a in links:
        href = a.get('href', '')
        if not href or href.startswith('#') or '/account' in href or '/cart' in href or 'support' in href:
            continue
        text = a.get_text(separator=' ', strip=True)
        if 'R$' not in text:
            continue
        price = parse_money(text)
        if not price or price < 30:
            continue
            
        url = href if href.startswith('http') else f"https://www.pichau.com.br{href}"
        h2 = a.find('h2')
        raw_title = h2.get_text(strip=True) if h2 else text.split('R$')[0].strip()
        title = clean_title(raw_title)
        if len(title) < 8 or 'carrinho' in title.lower():
            continue
            
        sku = href.strip('/').split('-')[-1]
        
        img_tag = a.find('img')
        img_url = None
        if img_tag:
            img_url = img_tag.get('src') or img_tag.get('data-src') or img_tag.get('srcset', '').split(' ')[0]
            
        if not any(it['url'] == url for it in items):
            items.append({
                "supplierId": "pichau",
                "store": "Pichau",
                "sku": sku,
                "title": title[:220].strip(),
                "pricePix": price,
                "priceCard": round(price * 1.15, 2),
                "url": url,
                "imageUrl": clean_image_url(img_url, "https://www.pichau.com.br"),
                "available": True
            })
    return items

def save_to_supabase(products, connection_string, margin=0.25):
    """Grava diretamente no Supabase PostgreSQL usando psycopg2."""
    import psycopg2
    from urllib.parse import urlparse
    
    print("\n🌐 Conectando ao Supabase (PostgreSQL)...")
    now_iso = datetime.now().isoformat()
    saved = 0
    
    try:
        conn = psycopg2.connect(connection_string)
        cur = conn.cursor()
        
        # Garante colunas no Supabase
        cur.execute("ALTER TABLE parts ADD COLUMN IF NOT EXISTS \"imageUrl\" TEXT;")
        cur.execute("ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS \"imageUrl\" TEXT;")
        
        for prod in products:
            title = prod['title']
            url = prod['url']
            store_sku = prod['sku'] or ''
            supplier_id = prod['supplierId']
            store_name = prod['store']
            cost = prod['pricePix']
            sale_price = round(cost * (1 + margin), 2)
            category = prod.get('category') or detect_category(title)
            brand = prod.get('brand') or detect_brand(title)
            image_url = prod.get('imageUrl')
            
            url_hash = hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]
            part_id = f"part_{supplier_id}_{url_hash}"
            offer_id = f"so_{supplier_id}_{url_hash}"
            installments_str = f"10x de R$ {round(prod['priceCard']/10, 2):.2f}".replace('.', ',')
            
            # Upsert em 'parts'
            cur.execute("""
                INSERT INTO parts (id, category, brand, model, sku, specs, supplier, cost, price, status, active, notes, "imageUrl", created, updated)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'em_estoque', 1, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    cost = EXCLUDED.cost,
                    price = EXCLUDED.price,
                    "imageUrl" = COALESCE(EXCLUDED."imageUrl", parts."imageUrl"),
                    status = 'em_estoque',
                    updated = EXCLUDED.updated;
            """, (part_id, category, brand, title, store_sku, f"Fornecedor: {store_name} | URL: {url}", store_name, cost, sale_price, url, image_url, now_iso, now_iso))
            
            # Upsert em 'supplier_offers'
            cur.execute("""
                INSERT INTO supplier_offers (
                    id, "partId", "supplierId", "storeSku", title, url, seller, "fulfillmentBy", condition,
                    "pricePix", "priceCard", "cardInstallments", availability, "imageUrl", "lastChecked", created, updated
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'novo', %s, %s, %s, 'em_estoque', %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    "pricePix" = EXCLUDED."pricePix",
                    "priceCard" = EXCLUDED."priceCard",
                    "cardInstallments" = EXCLUDED."cardInstallments",
                    "imageUrl" = COALESCE(EXCLUDED."imageUrl", supplier_offers."imageUrl"),
                    availability = 'em_estoque',
                    "lastChecked" = EXCLUDED."lastChecked",
                    updated = EXCLUDED.updated;
            """, (offer_id, part_id, supplier_id, store_sku, title, url, store_name, store_name, cost, prod['priceCard'], installments_str, image_url, now_iso, now_iso, now_iso))
            saved += 1
            
        conn.commit()
        conn.close()
        print(f"✅ [SUPABASE OK] {saved} produtos sincronizados na nuvem!")
    except Exception as e:
        print(f"❌ [SUPABASE ERRO] Falha ao sincronizar: {e}")
        
    return saved

def save_to_sqlite(products, db_paths=None, margin=0.25):
    """Grava nos bancos SQLite locais."""
    import sqlite3
    if db_paths is None:
        db_paths = [p for p in DEFAULT_DB_PATHS if os.path.exists(p)]
        
    if not db_paths:
        return 0

    now_iso = datetime.now().isoformat()
    total_saved = 0

    for db_path in db_paths:
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            
            # Garante colunas
            try:
                cur.execute("ALTER TABLE parts ADD COLUMN imageUrl TEXT")
            except:
                pass
            try:
                cur.execute("ALTER TABLE supplier_offers ADD COLUMN imageUrl TEXT")
            except:
                pass
                
            db_saved = 0
            for prod in products:
                title = prod['title']
                url = prod['url']
                store_sku = prod['sku'] or ''
                supplier_id = prod['supplierId']
                store_name = prod['store']
                cost = prod['pricePix']
                sale_price = round(cost * (1 + margin), 2)
                category = prod.get('category') or detect_category(title)
                brand = prod.get('brand') or detect_brand(title)
                image_url = prod.get('imageUrl')
                
                url_hash = hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]
                part_id = f"part_{supplier_id}_{url_hash}"
                offer_id = f"so_{supplier_id}_{url_hash}"
                installments_str = f"10x de R$ {round(prod['priceCard']/10, 2):.2f}".replace('.', ',')
                
                cur.execute("SELECT id FROM parts WHERE id = ?", (part_id,))
                row_part = cur.fetchone()
                if row_part:
                    cur.execute("""
                        UPDATE parts 
                        SET cost = ?, price = ?, imageUrl = COALESCE(?, imageUrl), status = 'em_estoque', updated = ?, notes = ?
                        WHERE id = ?
                    """, (cost, sale_price, image_url, now_iso, url, part_id))
                else:
                    cur.execute("""
                        INSERT INTO parts (id, category, brand, model, sku, specs, supplier, cost, price, status, active, notes, imageUrl, created, updated)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'em_estoque', 1, ?, ?, ?, ?)
                    """, (part_id, category, brand, title, store_sku, f"Fornecedor: {store_name} | URL: {url}", store_name, cost, sale_price, url, image_url, now_iso, now_iso))

                cur.execute("SELECT id FROM supplier_offers WHERE id = ?", (offer_id,))
                row_offer = cur.fetchone()
                if row_offer:
                    cur.execute("""
                        UPDATE supplier_offers
                        SET pricePix = ?, priceCard = ?, cardInstallments = ?, imageUrl = COALESCE(?, imageUrl), availability = 'em_estoque', lastChecked = ?, updated = ?
                        WHERE id = ?
                    """, (cost, prod['priceCard'], installments_str, image_url, now_iso, now_iso, offer_id))
                else:
                    cur.execute("""
                        INSERT INTO supplier_offers (
                            id, partId, supplierId, storeSku, title, url, seller, fulfillmentBy, condition,
                            pricePix, priceCard, cardInstallments, availability, imageUrl, lastChecked, created, updated
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?, 'em_estoque', ?, ?, ?, ?)
                    """, (offer_id, part_id, supplier_id, store_sku, title, url, store_name, store_name, cost, prod['priceCard'], installments_str, image_url, now_iso, now_iso, now_iso))
                db_saved += 1
                
            conn.commit()
            conn.close()
            print(f"📁 [SQLITE OK] {db_saved} itens sincronizados em: {os.path.basename(db_path)}")
            total_saved += db_saved
        except Exception as e:
            print(f"❌ [SQLITE ERRO] Falha em {db_path}: {e}")
            
    return total_saved

DEPARTMENTS = {
    "Processador": {
        "kabum": "https://www.kabum.com.br/hardware/processadores?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/hardware/processadores?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/processadores?page={page}"
    },
    "Placa de Vídeo": {
        "kabum": "https://www.kabum.com.br/hardware/placa-de-video-vga?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/hardware/placas-de-video?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/placa-de-video?page={page}"
    },
    "Placa-Mãe": {
        "kabum": "https://www.kabum.com.br/hardware/placas-mae?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/hardware/placas-mae?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/placa-m-e?page={page}"
    },
    "Memória RAM": {
        "kabum": "https://www.kabum.com.br/hardware/memoria-ram?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/hardware/memorias?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/memorias?page={page}"
    },
    "Armazenamento / SSD": {
        "kabum": "https://www.kabum.com.br/hardware/ssd-2-5?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/hardware/hard-disk/ssd?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/ssd-e-armazenamento?page={page}"
    },
    "Fonte": {
        "kabum": "https://www.kabum.com.br/hardware/fontes?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/hardware/fontes?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/fonte?page={page}"
    },
    "Gabinete": {
        "kabum": "https://www.kabum.com.br/perifericos/gabinetes?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/gabinete?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/gabinete?page={page}"
    },
    "Refrigeração / Cooler": {
        "kabum": "https://www.kabum.com.br/hardware/coolers?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/refrigeracao?pagina={page}",
        "pichau": "https://www.pichau.com.br/hardware/cooler-processador?page={page}"
    },
    "Periféricos & Monitores": {
        "kabum": "https://www.kabum.com.br/computadores/monitores?page_number={page}&page_size=100&sort=most_searched",
        "terabyte": "https://www.terabyteshop.com.br/monitores?pagina={page}",
        "pichau": "https://www.pichau.com.br/monitores?page={page}"
    }
}

LAST_REQUEST_TIME = {}

async def wait_cooldown(store_name, min_delay=None):
    if min_delay is None:
        min_delay = 4.0 if store_name == 'kabum' else 2.5
    now = datetime.now().timestamp()
    last = LAST_REQUEST_TIME.get(store_name, 0)
    elapsed = now - last
    if elapsed < min_delay:
        await asyncio.sleep(min_delay - elapsed)
    LAST_REQUEST_TIME[store_name] = datetime.now().timestamp()

async def crawl_term(crawler, query, category_label="Hardware", max_per_store=6):
    query_encoded_kabum = query.replace(' ', '%20')
    query_encoded_terabyte = query.replace(' ', '+')
    query_encoded_pichau = query.replace(' ', '%20')
    
    targets = [
        {"store": "kabum", "name": "KaBuM!", "url": f"https://www.kabum.com.br/busca/{query_encoded_kabum}", "parser": parse_kabum},
        {"store": "terabyte", "name": "TerabyteShop", "url": f"https://www.terabyteshop.com.br/busca?str={query_encoded_terabyte}", "parser": parse_terabyte},
        {"store": "pichau", "name": "Pichau", "url": f"https://www.pichau.com.br/search?q={query_encoded_pichau}", "parser": parse_pichau}
    ]
    
    run_cfg = CrawlerRunConfig(cache_mode=None)
    found_products = []
    
    print(f"\n🔍 Buscando: '{query}' -> Categoria: [{category_label}]")
    
    for t in targets:
        try:
            await wait_cooldown(t['store'])
            res = await crawler.arun(url=t['url'], config=run_cfg)
            if not res.success and getattr(res, 'status_code', None) == 403:
                await asyncio.sleep(4.0)
                res = await crawler.arun(url=t['url'], config=run_cfg)
                
            if not res.success:
                print(f"  ❌ [{t['name']}] Status: {getattr(res, 'status_code', 'N/A')}")
                continue
                
            items = t['parser'](res.html)
            for it in items[:max_per_store]:
                it['category'] = category_label
                it['brand'] = detect_brand(it['title'])
                found_products.append(it)
                
            img_count = sum(1 for it in items[:max_per_store] if it.get('imageUrl'))
            print(f"  ✅ [{t['name']}] {len(items[:max_per_store])} itens capturados ({img_count} com fotos).")
        except Exception as e:
            print(f"  ⚠️ [{t['name']}] Erro: {e}")
            
    return found_products

async def crawl_department(crawler, cat_name, dept_dict, page=1):
    found_products = []
    print(f"\n🏬 Varrendo Vitrine de [{cat_name}] (Página {page})")
    
    targets = [
        {"store": "kabum", "name": "KaBuM!", "url": dept_dict["kabum"].format(page=page), "parser": parse_kabum},
        {"store": "terabyte", "name": "TerabyteShop", "url": dept_dict["terabyte"].format(page=page), "parser": parse_terabyte},
        {"store": "pichau", "name": "Pichau", "url": dept_dict["pichau"].format(page=page), "parser": parse_pichau}
    ]
    
    run_cfg = CrawlerRunConfig(cache_mode=None)
    for t in targets:
        try:
            await wait_cooldown(t['store'])
            res = await crawler.arun(url=t['url'], config=run_cfg)
            if not res.success and getattr(res, 'status_code', None) == 403:
                await asyncio.sleep(4.0)
                res = await crawler.arun(url=t['url'], config=run_cfg)
                
            if not res.success:
                print(f"  ❌ [{t['name']}] Status: {getattr(res, 'status_code', 'N/A')}")
                continue
                
            items = t['parser'](res.html)
            for it in items:
                it['category'] = cat_name
                it['brand'] = detect_brand(it['title'])
                found_products.append(it)
                
            img_count = sum(1 for it in items if it.get('imageUrl'))
            print(f"  ✅ [{t['name']}] {len(items)} produtos capturados ({img_count} com fotos).")
        except Exception as e:
            print(f"  ⚠️ [{t['name']}] Erro: {e}")
            
    return found_products

async def run_crawler(depts_to_crawl=None, terms_dict=None, pages=1, max_per_store=6, margin=0.25):
    browser_cfg = BrowserConfig(
        headless=True,
        enable_stealth=True,
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    )
    all_collected = []
    
    print("==================================================================")
    print("   BIOS INFORMÁTICA - CRAWLER DE HARDWARE (CRAWL4AI STEALTH)    ")
    print("==================================================================")
    print(f"Lojas: KaBuM!, TerabyteShop, Pichau")
    print(f"Captura de fotos: ATIVADA")
    print(f"Links originais: ATIVADOS")
    
    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        # 1. Modo Departamento (Vitrine completa com paginação)
        if depts_to_crawl:
            for cat_name, dept_dict in depts_to_crawl.items():
                for p in range(1, pages + 1):
                    prods = await crawl_department(crawler, cat_name, dept_dict, page=p)
                    all_collected.extend(prods)
                    
        # 2. Modo Termos de Busca (Pesquisa específica)
        if terms_dict:
            for cat_name, queries in terms_dict.items():
                for q in queries:
                    prods = await crawl_term(crawler, q, category_label=cat_name, max_per_store=max_per_store)
                    all_collected.extend(prods)
                    
    print(f"\n📦 Total geral capturado: {len(all_collected)} produtos.")
    
    if all_collected:
        # Se DATABASE_URL estiver configurado, sincroniza com Supabase
        db_url = os.getenv("DATABASE_URL")
        if db_url and db_url.startswith("postgres"):
            save_to_supabase(all_collected, db_url, margin=margin)
            
        # Grava também nos bancos locais SQLite
        save_to_sqlite(all_collected, margin=margin)
        print("\n🎉 Sincronização concluída! Os itens com fotos e links estão prontos no catálogo interno.")

def main():
    parser = argparse.ArgumentParser(description="Crawler Bios Informática")
    parser.add_argument("--query", "-q", type=str, help="Termo específico (ex: 'RTX 4060')")
    parser.add_argument("--category", "-c", type=str, help="Categoria específica (ex: 'Processador')")
    parser.add_argument("--all", action="store_true", help="Varredura de todas as categorias e departamentos")
    parser.add_argument("--pages", "-p", type=int, default=1, help="Número de páginas por departamento (padrão: 1 = ~1.500 produtos)")
    parser.add_argument("--limit", type=int, default=5, help="Limite por loja no modo busca (padrão: 5)")
    parser.add_argument("--margin", type=float, default=0.25, help="Margem de lucro sugerida (padrão 0.25 = 25%)")
    args = parser.parse_args()
    
    depts = None
    terms = None
    
    if args.query:
        terms = {detect_category(args.query): [args.query]}
    elif args.category:
        matching_dept = {k: v for k, v in DEPARTMENTS.items() if args.category.lower() in k.lower()}
        if matching_dept:
            depts = matching_dept
        else:
            matching_terms = {k: v for k, v in ALL_CATEGORIES.items() if args.category.lower() in k.lower()}
            if matching_terms:
                terms = matching_terms
            else:
                print(f"Categoria '{args.category}' não encontrada.")
                return
    else:
        # Se passar --all ou rodar sem parâmetros (ex: cron), varre os departamentos completos!
        depts = DEPARTMENTS
        
    asyncio.run(run_crawler(depts_to_crawl=depts, terms_dict=terms, pages=args.pages, max_per_store=args.limit, margin=args.margin))

if __name__ == "__main__":
    main()
