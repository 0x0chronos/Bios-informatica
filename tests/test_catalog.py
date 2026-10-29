import asyncio
import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scripts.crawler_fornecedores import money, parse_page, product, save_products, collect_category


def kabum_html(code=123, following=0, available=True):
    catalog = {'data': [{'code':code,'name':'Processador AMD Ryzen de teste','friendlyName':'cpu-teste',
        'price':1000,'priceWithDiscount':850,'oldPrice':1900,'available':available,'sellerName':'Vendedor parceiro'}],
        'pagination': {'current':1 if code==123 else 2,'next':following}}
    return '<script id="__NEXT_DATA__">' + json.dumps({'props':{'pageProps':{'data':json.dumps({'catalogServer':catalog})}}}) + '</script>'


def terabyte_html(codes, total, more=True):
    return '<script id="tera-facet-counts" type="application/json">' + json.dumps({'total':total}) + '</script>' + ''.join(
        f'<div class="product-item"><a class="product-item__name" href="/produto/{code}/cpu">Processador AMD {code}</a>'
        '<div class="product-item__new-price"><span>R$ 999,99</span></div></div>' for code in codes
    ) + ('<a class="tfv2-more" role="button">Ver mais produtos</a>' if more else '')


class ExtractionTests(unittest.TestCase):
    def test_terabyte_unloaded_products_cannot_be_complete(self):
        url='https://www.terabyteshop.com.br/hardware/placas-de-video'
        _, following=parse_page(terabyte_html([1],2),'terabyte',url)
        self.assertEqual(following,url)
        with self.assertRaisesRegex(ValueError,'anunciou 2'):
            parse_page(terabyte_html([1],2,more=False),'terabyte',url)
        _, following=parse_page(terabyte_html([1,2],2,more=False),'terabyte',url)
        self.assertIsNone(following)

    def test_advertised_prices_not_old_price_or_percentage(self):
        items, following = parse_page(kabum_html(following=2,available=False),'kabum','https://www.kabum.com.br/hardware/processadores?page_number=1')
        self.assertEqual((items[0]['pricePix'],items[0]['priceCard']), (850,1000))
        self.assertEqual(items[0]['availability'],'esgotado')
        self.assertEqual(items[0]['seller'],'Vendedor parceiro')
        self.assertIn('page_number=2',following)

    def test_pichau_ignores_struck_out_price(self):
        html = '''<a data-cy="list-product" href="/cpu-teste"><h2>Processador de teste</h2>
            <div class="x-price_from">R$ 1.999,00</div><div class="x-price_vista">R$ 899,90</div>
            <div class="x-price_total">R$ 1.058,71</div></a>
            <a aria-label="Go to next page" href="/hardware/processadores?page=2"></a>'''
        items, following = parse_page(html,'pichau','https://www.pichau.com.br/hardware/processadores?page=1')
        self.assertEqual((items[0]['pricePix'],items[0]['priceCard']),(899.90,1058.71))
        self.assertEqual(items[0]['availability'],'sob_consulta')
        self.assertEqual(items[0]['sku'],'')
        self.assertTrue(following.endswith('page=2'))

    def test_kabum_last_page_does_not_follow_phantom_next(self):
        html = kabum_html(following=2).replace('\\"next\\": 2', '\\"next\\": 2, \\"total\\": 1')
        _, following = parse_page(html,'kabum','https://www.kabum.com.br/hardware/processadores?page_number=1')
        self.assertIsNone(following)

    def test_terabyte_does_not_invent_card_total(self):
        html = '''<div class="product-item"><a class="product-item__name" href="/produto/123/cpu">Processador AMD de teste</a>
            <div class="product-item__old-price">R$ 2.000,00</div><div class="product-item__new-price"><span>R$ 999,99</span></div>
            <div class="product-item__juros">12x de R$ 98,04 sem juros</div><button data-produto="123"></button></div>'''
        items, following = parse_page(html,'terabyte','https://www.terabyteshop.com.br/hardware/processadores')
        self.assertEqual(items[0]['pricePix'],999.99)
        self.assertIsNone(items[0]['priceCard'])
        self.assertEqual(items[0]['cardInstallments'],'12x de R$ 98,04 sem juros')
        self.assertEqual(items[0]['availability'],'em_estoque')
        self.assertIsNone(following)

    def test_block_page_and_external_urls_are_rejected(self):
        with self.assertRaises(ValueError): parse_page('<h1>Acesso negado</h1>','pichau','https://www.pichau.com.br/')
        with self.assertRaises(ValueError): product('kabum','Produto de teste','https://attacker.example/produto/1')
        for value in [None,0,-1,float('nan'),True,'sem preço']:
            self.assertIsNone(money(value))


SCHEMA = '''
CREATE TABLE suppliers(id TEXT PRIMARY KEY);
INSERT INTO suppliers VALUES('kabum');
CREATE TABLE parts(id TEXT PRIMARY KEY,category TEXT,brand TEXT,model TEXT,sku TEXT,specs TEXT,supplier TEXT,
 cost REAL,price REAL,status TEXT,active INTEGER,notes TEXT,imageUrl TEXT,created TEXT,updated TEXT);
CREATE TABLE supplier_offers(id TEXT PRIMARY KEY,partId TEXT REFERENCES parts(id),supplierId TEXT REFERENCES suppliers(id),
 storeSku TEXT,title TEXT,url TEXT,seller TEXT,fulfillmentBy TEXT,condition TEXT,pricePix REAL,priceCard REAL,
 cardInstallments TEXT,availability TEXT,imageUrl TEXT,lastChecked TEXT,isStale INTEGER,autoSync INTEGER,
 created TEXT,updated TEXT,lastPricePix REAL,lastError TEXT);
CREATE TABLE quotes(id TEXT PRIMARY KEY,total REAL);
INSERT INTO quotes VALUES('approved',2000);
'''


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.p = parse_page(kabum_html(),'kabum','https://www.kabum.com.br/hardware/processadores')[0][0]
        self.p['category']='Processador'

    def tearDown(self): self.db.close()

    def test_repeat_sync_preserves_sale_price_and_approved_quote(self):
        save_products(self.db,False,[self.p])
        self.db.execute('UPDATE parts SET price=1700')
        self.db.commit()
        self.p['pricePix']=700
        save_products(self.db,False,[self.p])
        self.assertEqual(self.db.execute('SELECT cost,price,status FROM parts').fetchone(),(700,1700,'sob_encomenda'))
        self.assertEqual(self.db.execute('SELECT pricePix,lastPricePix FROM supplier_offers').fetchone(),(700,850))
        self.assertEqual(self.db.execute('SELECT count(*) FROM supplier_offers').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT total FROM quotes').fetchone()[0],2000)

    def test_atomic_rollback_and_opt_out(self):
        save_products(self.db,False,[self.p])
        self.p['pricePix']=600
        invalid={**self.p,'supplierId':'missing','url':'https://www.kabum.com.br/produto/999/cpu','sku':'999'}
        with self.assertRaises(sqlite3.IntegrityError): save_products(self.db,False,[self.p,invalid])
        self.assertEqual(self.db.execute('SELECT pricePix FROM supplier_offers').fetchone()[0],850)
        self.db.execute('UPDATE supplier_offers SET autoSync=0')
        self.db.commit()
        save_products(self.db,False,[self.p])
        self.assertEqual(self.db.execute('SELECT pricePix FROM supplier_offers').fetchone()[0],850)

    def test_linked_manual_part_is_not_overwritten(self):
        save_products(self.db,False,[self.p])
        self.db.execute("INSERT INTO parts(id,cost,price,status) VALUES('manual',500,1200,'em_estoque')")
        self.db.execute("UPDATE supplier_offers SET partId='manual'")
        self.db.commit()
        self.p['pricePix']=600
        save_products(self.db,False,[self.p])
        self.assertEqual(self.db.execute("SELECT cost,price,status FROM parts WHERE id='manual'").fetchone(),(500,1200,'em_estoque'))


class CollectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_terabyte_clicks_more_and_only_publishes_new_products(self):
        class Crawler:
            def __init__(self): self.configs=[]
            async def arun(self,url,config):
                self.configs.append(config)
                codes=[1] if len(self.configs)==1 else [1,2]
                return SimpleNamespace(success=True,status_code=200,html=terabyte_html(codes,2,more=len(codes)<2))
        crawler=Crawler();saved=[]
        with patch('scripts.crawler_fornecedores.asyncio.sleep',return_value=None):
            products,report=await collect_category(crawler,'terabyte','Placa de Vídeo','https://www.terabyteshop.com.br/hardware/placas-de-video',save=lambda batch:saved.extend(batch))
        self.assertTrue(report['complete'])
        self.assertEqual((report['pages'],report['products'],len(saved)),(2,2,2))
        self.assertFalse(crawler.configs[0].js_only)
        self.assertTrue(crawler.configs[1].js_only)

    async def test_transient_navigation_failure_is_retried(self):
        class Crawler:
            def __init__(self): self.calls=0
            async def arun(self,**kwargs):
                self.calls+=1
                return SimpleNamespace(success=self.calls>1,status_code=200 if self.calls>1 else None,html=kabum_html())
        crawler=Crawler()
        with patch('scripts.crawler_fornecedores.asyncio.sleep',return_value=None):
            _,report=await collect_category(crawler,'kabum','Processador','https://www.kabum.com.br/hardware/processadores')
        self.assertTrue(report['complete'])
        self.assertEqual(crawler.calls,2)

    async def test_pagination_and_block_preserve_successful_batches(self):
        class Crawler:
            def __init__(self): self.urls=[]
            async def arun(self, url, config):
                self.urls.append(url)
                if len(self.urls)==1:return SimpleNamespace(success=True,status_code=200,html=kabum_html(following=2))
                return SimpleNamespace(success=False,status_code=403,html='blocked')
        crawler=Crawler();saved=[]
        with patch('scripts.crawler_fornecedores.asyncio.sleep',return_value=None):
            products,report=await collect_category(crawler,'kabum','Processador','https://www.kabum.com.br/hardware/processadores?page_number=1',save=lambda batch:saved.extend(batch))
        self.assertEqual(len(crawler.urls),2)
        self.assertEqual(len(saved),1)
        self.assertFalse(report['complete'])
        self.assertIn('403',report['error'])

    async def test_page_limit_is_reported_as_partial(self):
        class Crawler:
            async def arun(self,**kwargs):return SimpleNamespace(success=True,status_code=200,html=kabum_html(following=2))
        with patch('scripts.crawler_fornecedores.asyncio.sleep',return_value=None):
            _,report=await collect_category(Crawler(),'kabum','Processador','https://www.kabum.com.br/hardware/processadores?page_number=1',pages=1)
        self.assertFalse(report['complete'])
        self.assertEqual(report['pages'],1)
        self.assertTrue(report['limited'])


if __name__=='__main__': unittest.main()
