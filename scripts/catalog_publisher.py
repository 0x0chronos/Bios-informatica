"""Durable public-product queue; the computer never needs database credentials."""
import json
import sqlite3
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the sync credential through a redirect.


class CatalogPublisher:
    def __init__(self, database, endpoint, token, transport=None):
        self.db = sqlite3.connect(database, timeout=30)
        self.db.executescript('''CREATE TABLE IF NOT EXISTS pending_products(
            supplier TEXT NOT NULL,url TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(supplier,url));
            CREATE TABLE IF NOT EXISTS catalog_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);''')
        self.endpoint, self.token = endpoint, token
        self.transport = transport or self._post
        self.last_error, self.deferred = None, False

    def _post(self, body):
        request = Request(self.endpoint, data=body, headers={
            'Authorization': 'Bearer ' + self.token, 'X-Bios-Request': '1', 'Content-Type': 'application/json'})
        with build_opener(NoRedirect).open(request, timeout=45) as response:
            return json.loads(response.read(100000))

    def pending(self):
        return self.db.execute('SELECT COUNT(*) FROM pending_products').fetchone()[0]

    def state(self, key, value=None):
        if value is None:
            row = self.db.execute('SELECT value FROM catalog_state WHERE key=?', (key,)).fetchone()
            return row[0] if row else None
        with self.db:
            self.db.execute('INSERT INTO catalog_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))

    def save(self, products):
        with self.db:
            self.db.executemany('INSERT INTO pending_products VALUES(?,?,?) ON CONFLICT(supplier,url) DO UPDATE SET payload=excluded.payload',
                [(p['supplierId'],p['url'],json.dumps(p,ensure_ascii=False)) for p in products])
        if not self.deferred:
            self.flush()

    def flush(self):
        self.deferred, self.last_error = False, None
        while True:
            rows = self.db.execute('SELECT supplier,url,payload FROM pending_products ORDER BY supplier,url LIMIT 8').fetchall()
            if not rows:
                return True
            batch, sent = [], []
            for row in rows:
                candidate = batch + [json.loads(row[2])]
                encoded = json.dumps({'products': candidate},ensure_ascii=False).encode('utf-8')
                if len(encoded) > 40000:
                    break
                batch, sent = candidate, sent + [row]
            if not sent:
                self.last_error, self.deferred = 'Produto excedeu o limite de envio', True
                return False
            try:
                result = self.transport(json.dumps({'products': batch},ensure_ascii=False).encode('utf-8'))
                if result.get('success') is not True or result.get('acknowledged') != len(sent):
                    raise ValueError('Resposta de sincronização inválida')
            except (HTTPError, URLError, OSError, ValueError) as error:
                self.last_error = 'HTTP ' + str(error.code) if isinstance(error,HTTPError) else type(error).__name__
                self.deferred = True
                return False
            with self.db:
                self.db.executemany('DELETE FROM pending_products WHERE supplier=? AND url=? AND payload=?', sent)
            print(json.dumps({'event':'published','products':len(sent),'pending':self.pending()}),flush=True)

    def close(self):
        self.db.close()
