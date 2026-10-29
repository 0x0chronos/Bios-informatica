import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from scripts.catalog_publisher import CatalogPublisher
from scripts.catalog_pc import due_slot


class PublisherTests(unittest.TestCase):
    def test_offline_queue_survives_restart_and_keeps_latest_offer(self):
        with tempfile.TemporaryDirectory() as directory:
            database=Path(directory)/'queue.sqlite'
            def offline(body): raise URLError('offline')
            publisher=CatalogPublisher(database,'https://example.invalid','x'*43,transport=offline)
            p={'supplierId':'kabum','url':'https://www.kabum.com.br/produto/1','pricePix':100}
            publisher.save([p]);publisher.save([{**p,'pricePix':90}]);publisher.close()
            delivered=[]
            def online(body):
                batch=json.loads(body)['products'];delivered.extend(batch)
                return {'success':True,'acknowledged':len(batch)}
            publisher=CatalogPublisher(database,'https://example.invalid','x'*43,transport=online)
            try:
                self.assertEqual(publisher.pending(),1)
                self.assertTrue(publisher.flush())
                self.assertEqual(delivered[0]['pricePix'],90)
                self.assertEqual(publisher.pending(),0)
            finally:publisher.close()

    def test_missing_acknowledgement_keeps_products_and_unicode_batches_fit_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            batches=[]
            def send(body):
                batches.append(body)
                return {'success':True,'acknowledged':len(json.loads(body)['products'])}
            publisher=CatalogPublisher(Path(directory)/'queue.sqlite','https://example.invalid','x'*43,transport=lambda body:{'success':True})
            try:
                products=[{'supplierId':'pichau','url':'https://www.pichau.com.br/item-'+str(i),'specs':'á'*4000} for i in range(9)]
                publisher.save(products)
                self.assertEqual(publisher.pending(),9)
                publisher.transport=send
                self.assertTrue(publisher.flush())
                self.assertTrue(all(len(b)<=40000 and len(json.loads(b)['products'])<=8 for b in batches))
                self.assertEqual(sum(len(json.loads(b)['products']) for b in batches),9)
            finally:publisher.close()

    def test_catchup_slot_uses_brasilia_even_across_utc_midnight(self):
        self.assertEqual(due_slot(datetime(2026,10,29,2,59,tzinfo=timezone.utc)),'2026-10-28T12:00:00-03:00')
        self.assertEqual(due_slot(datetime(2026,10,29,3,tzinfo=timezone.utc)),'2026-10-29T00:00:00-03:00')
        self.assertEqual(due_slot(datetime(2026,10,29,15,tzinfo=timezone.utc)),'2026-10-29T12:00:00-03:00')


if __name__=='__main__':unittest.main()
