"""Windows entry point: catch up the latest Brasília slot, queue and publish."""
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from .catalog_publisher import CatalogPublisher
    from .crawler_fornecedores import run
except ImportError:
    from catalog_publisher import CatalogPublisher
    from crawler_fornecedores import run


def due_slot(now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(timezone(timedelta(hours=-3)))
    return local.replace(hour=12 if local.hour >= 12 else 0,minute=0,second=0,microsecond=0).isoformat()


def main():
    parser = argparse.ArgumentParser(description='Coleta e publica ofertas a partir deste computador')
    parser.add_argument('--data-dir',required=True)
    parser.add_argument('--category',default='')
    parser.add_argument('--pages',type=int,default=0)
    parser.add_argument('--stores',nargs='+',choices=['kabum','pichau','terabyte'],default=['pichau','terabyte'])
    parser.add_argument('--force',action='store_true')
    args = parser.parse_args()
    token = os.environ.get('CATALOG_SYNC_TOKEN','')
    if len(token) < 40:
        print('Chave local de sincronização não configurada.',file=sys.stderr)
        return 1
    directory = Path(args.data_dir)
    directory.mkdir(parents=True,exist_ok=True)
    # The OS releases this lock after a crash or shutdown; no stale PID file.
    import msvcrt
    lock = (directory/'worker.lock').open('a+b')
    lock.seek(0)
    if not lock.read(1): lock.write(b'0'); lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    except OSError:
        lock.close()
        print('Outra coleta já está em execução.')
        return 0
    publisher = CatalogPublisher(directory/'queue.sqlite','https://biosinformatica.store/api/suppliers/catalog-sync',token)
    try:
        slot = due_slot()
        publisher.flush()
        if not args.force and publisher.state('collectedSlot') == slot:
            print(json.dumps({'event':'already_collected','slot':slot,'pending':publisher.pending()}),flush=True)
            return 0 if publisher.pending()==0 else 1
        options = argparse.Namespace(category=args.category,store='all',dry_run=False,database=None,pages=args.pages,
            stores=args.stores,max_pages=100,margin=.25,output=str(directory/'last-report.json'))
        result = asyncio.run(run(options,publisher=publisher))
        if result==0 and not args.pages and not args.category:
            publisher.state('collectedSlot',slot)
        publisher.flush()
        print(json.dumps({'event':'finished','slot':slot,'pending':publisher.pending(),'uploadError':publisher.last_error}),flush=True)
        return result if publisher.pending()==0 else 1
    finally:
        publisher.close()
        lock.seek(0)
        msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
        lock.close()


if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    try:
        sys.exit(main())
    except Exception as error:
        print('Falha na coleta local: '+type(error).__name__,file=sys.stderr)
        sys.exit(1)
