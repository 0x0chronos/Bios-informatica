# Catálogo de fornecedores

Escopo aprovado: coletar componentes e periféricos da KaBuM!, Pichau e Terabyte, guardar as ofertas e pesquisá-las no painel para montar orçamentos. O GitHub Actions inicia a coleta às 00h e 12h de Brasília; a publicação ocorre após a coleta e pode sofrer atrasos do agendador.

## Critérios de aceitação

- Percorrer as páginas anunciadas pela loja, com limite de segurança e detecção de páginas repetidas. Uma coleta limitada deve ser identificada como parcial.
- Extrair preços Pix e cartão separadamente. Não estimar preço no cartão, parcelas, estoque ou fabricante ausentes.
- Preservar os dados anteriores se uma loja bloquear ou se a extração falhar. Gravar cada lote em uma transação e registrar o resultado por loja.
- Atualizar custo e oferta sem alterar preços de venda já configurados ou orçamentos existentes. Disponibilidade no fornecedor não significa estoque próprio.
- Oferecer busca paginada autenticada no catálogo salvo, exibindo loja, vendedor, disponibilidade, imagem, URL e última conferência.
- Rodar em banco PostgreSQL persistente. O Actions nunca deve versionar ou publicar bancos SQLite com dados de clientes.

## Estrutura e validação

`scripts/crawler_fornecedores.py` faz a coleta com Crawl4AI; `scripts/catalog.js` consulta o banco pela API Express existente. `public/js/panel.js` conecta a busca ao orçamento. As versões das dependências Python ficam em `requirements-crawler.txt`.

Instalação: `python -m pip install -r requirements-crawler.txt` e `python -m playwright install --with-deps chromium`.

Testes: `python -m unittest discover -s tests -p "test_catalog*.py"` e `node --test tests/catalog.test.js`.

Coleta de verificação sem escrita: `python scripts/crawler_fornecedores.py --all --pages 1 --dry-run --output scratch/catalogo-teste.json`.

## Publicação

Usar o mesmo banco PostgreSQL do site. Configurar a conexão no secret `DATABASE_URL` do GitHub Actions; a configuração da Hostinger já contém essa variável, mas seu valor não pode ser lido pela API de hospedagem. Não incluir `.env`, bancos, backups ou credenciais no pacote de publicação.

Confirmar o domínio antes da primeira publicação e validar o aplicativo localmente antes de substituí-lo. Não substituir o conjunto de variáveis de ambiente da Hostinger por valores mascarados.

## Ambiente de coleta

Os testes no Actions confirmaram que a KaBuM responde no runner hospedado pelo GitHub. Pichau e Terabyte recusaram o acesso nesse ambiente (HTTP 403 e 307), mesmo com a configuração original do navegador. No computador local, foram coletadas páginas das três lojas; a paginação da Pichau também foi validada.

Para usar um servidor próprio, instalar um runner do GitHub Actions no servidor e definir a variável de repositório `CATALOG_RUNNER` com o rótulo desse runner, por exemplo `self-hosted`. O agendamento permanece no GitHub, mas a coleta usa a rede do servidor escolhido. O servidor precisa estar ligado nos horários previstos e ter Python 3.11 e os requisitos do Chromium. Não deixar a coleta dependente de um computador desligado.

Validação na nova rede: executar manualmente o workflow com `dry_run=true`, `category=Processador` e `pages=1`. Só considerar a integração operacional após obter produtos das três lojas nesse ambiente e validar a gravação no mesmo banco do site. O primeiro teste é limitado a uma página e não comprova cobertura de todo o catálogo.

## Estado da publicação

Interface e API publicadas em `biosinformatica.store`, com leitura do banco existente confirmada. Os testes locais cobrem extração, paginação, transações, preços de venda, ofertas desatualizadas e inclusão no orçamento. A carga automática depende do secret de conexão e de um ambiente de coleta aceito pelas três lojas.
