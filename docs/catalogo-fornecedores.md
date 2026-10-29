# Catálogo de fornecedores

Escopo aprovado: coletar componentes e periféricos da KaBuM!, Pichau e Terabyte, guardar as ofertas e pesquisá-las no painel para montar orçamentos. Pichau e Terabyte usam o computador do proprietário, às 00h e 12h de Brasília e após entrar no Windows. A KaBuM usa o GitHub Actions nos mesmos horários. O site e a API continuam na Hostinger.

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

Usar o mesmo banco PostgreSQL do site. O computador envia ofertas para `POST /api/suppliers/catalog-sync`, com uma chave própria que só permite sincronizar o catálogo. O próprio site grava no banco usando sua `DATABASE_URL` já configurada na Hostinger. O computador não precisa de acesso direto ao Supabase. Não incluir `.env`, bancos, backups ou a chave de envio no pacote de publicação.

Confirmar o domínio antes da primeira publicação e validar o aplicativo localmente antes de substituí-lo. Não substituir o conjunto de variáveis de ambiente da Hostinger por valores mascarados.

## Ambiente de coleta

Os testes no Actions confirmaram que a KaBuM responde no runner hospedado pelo GitHub. Pichau e Terabyte recusaram o acesso nesse ambiente (HTTP 403 e 307), mesmo com a configuração original do navegador. No computador local, foram coletadas páginas da Pichau e Terabyte, com paginação da Pichau validada. A KaBuM respondeu em testes locais anteriores e depois passou a retornar HTTP 403, por isso permanece no GitHub.

Para usar um servidor próprio, instalar um runner do GitHub Actions no servidor e definir a variável de repositório `CATALOG_RUNNER` com o rótulo desse runner, por exemplo `self-hosted`. O agendamento permanece no GitHub, mas a coleta usa a rede do servidor escolhido. O servidor precisa estar ligado nos horários previstos e ter Python 3.11 e os requisitos do Chromium. Não deixar a coleta dependente de um computador desligado.

Validação da KaBuM no GitHub: executar manualmente o workflow com `category=Processador` e `pages=1`. `dry_run=true` evita escrever no site. O secret `CATALOG_SYNC_TOKEN` guarda a chave de envio restrita ao catálogo; o GitHub também não recebe a senha do banco. O primeiro teste é limitado a uma página e não comprova cobertura de todo o catálogo.

## Coleta no computador

Instalação: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-catalog-pc.ps1`. A instalação usa o usuário atual, sem salvar sua senha do Windows. A chave de envio é protegida pelo Windows no arquivo `%LOCALAPPDATA%/BiosInformatica/Catalogo/config.json`; somente o hash SHA-256 vai para o arquivo `.catalog-sync.json` do servidor, fora da pasta pública.

A tarefa **Bios Informatica - Catalogo de Fornecedores** coleta Pichau e Terabyte silenciosamente às 00h e 12h de Brasília e dois minutos após o logon. O usuário precisa estar conectado no Windows; a tela pode estar bloqueada. O computador precisa estar ligado e com internet. Não há coleta local enquanto o computador estiver desligado ou suspenso. Ao voltar, coleta o período mais recente, sem repetir todos os horários perdidos. A KaBuM continua atualizando pelo GitHub mesmo quando o computador está desligado, sujeito à disponibilidade da loja e do agendador.

Execução manual: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-catalog-pc.ps1 -Force`. Teste limitado: acrescentar `-Category Processador -Pages 1`.

Cada lote é colocado primeiro em `%LOCALAPPDATA%/BiosInformatica/Catalogo/queue.sqlite`. Falhas de envio preservam a fila, que é tentada novamente na próxima execução. O servidor preserva a data original da coleta e ignora ofertas mais antigas que as já recebidas. Os logs ficam na subpasta `logs`; o último relatório, em `last-report.json`. A chave não é escrita nos logs nem no repositório.

Não mover a pasta do projeto sem executar a instalação novamente, para atualizar o caminho da tarefa. Para interromper a coleta local, desabilitar a tarefa no Agendador do Windows. O GitHub não dispara coletas da Pichau ou Terabyte.

## Estado da publicação

Interface e API publicadas em `biosinformatica.store`. Os testes cobrem extração, paginação, transações, preservação de preços de venda e orçamentos, recuperação da fila local e isolamento da chave de sincronização em relação aos dados administrativos.

## Fotos e compra

Cada oferta preserva a URL original do produto e a URL da foto fornecida pela loja. As fotos aparecem nos resultados, nas ofertas cadastradas e nos itens do orçamento no painel. O botão **Comprar na loja** abre a página original em outra aba. O link continua disponível ao salvar e reabrir o orçamento, usando o produto vinculado e o endereço original guardado no item. A falta de uma foto não impede consultar o produto; imagens que falham são substituídas por um indicador. As imagens são carregadas dos servidores das lojas, sem copiar todos os arquivos para a hospedagem.
