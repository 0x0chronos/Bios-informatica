# Bios Informática — revisão de 19/10/2026

Este pacote foi revisado localmente. Ele NÃO foi publicado na Hostinger e NÃO contém uma cópia do banco de produção.

## Como conferir a aparência

Abra `PREVIA-BIOS.html` no navegador depois de extrair o ZIP. A página é autossuficiente, com CSS, raposa e animação incorporados. Ela mostra a página pública; o painel e os orçamentos precisam do servidor.

A raposa aparece diretamente na abertura, sem caixa, modal ou legenda. O notebook agora tem B_ em verde. A imagem estática é usada na marca e na impressão. O favicon continua como monograma B_, adequado a tamanhos pequenos. Os 16 olhares, pausa fora de tela e respeito a movimento reduzido foram preservados.

## O que havia no ZIP enviado

Havia uma pasta de projeto dentro de outra. A pasta interna continha a aplicação completa, incluindo peças e orçamentos; os arquivos externos de servidor/testes comparados eram iguais. Este ZIP entrega UMA raiz: `package.json`, `server.js`, `public/`, `scripts/` e `tests/` ficam juntos. Na Hostinger, a raiz deve ser a que contém `package.json`.

Isso confirma a presença do código de orçamentos no pacote enviado. Não confirma a presença de registros no banco de produção. Para verificar cadastros supostamente perdidos, compare banco, ambiente e implantação atuais antes de qualquer importação/restauração.

## Correções

- Título branco e destaque verde explícitos, com tamanho ajustado no computador e no celular. CSS/JS têm identificador de versão para reduzir problemas de cache.
- Marca da raposa B_ na página, login, painel e impressão de OS/orçamento. Uma logo personalizada nas configurações é preservada; o antigo valor padrão de favicon é trocado pela raposa.
- Tipos de peças/serviços unificados entre painel e API; os nomes ingleses antigos continuam aceitos pela API. Itens já gravados como avulsos não são reclassificados automaticamente.
- Quantidades inválidas são rejeitadas. O cálculo prévio de lucro/margem agora acompanha a definição do servidor, descontando frete do lucro e calculando margem sobre venda.
- Driver PostgreSQL cria as tabelas de orçamento que antes eram puladas; trata nomes camelCase, aliases, campo `desc`, identidade SERIAL e conflitos sem ignorar erros de esquema. Novas colunas monetárias usam DOUBLE PRECISION, com cálculos em centavos no servidor.
- Transações PostgreSQL usam o mesmo cliente do pool até COMMIT/ROLLBACK. Leituras do contador e da proposta para alteração recebem bloqueio de linha no PostgreSQL.
- Tabelas administrativas recebem RLS no PostgreSQL. O backend precisa de uma função de banco proprietária/privilegiada adequada; a conexão nunca vai ao navegador. Políticas de acesso já existentes também precisam ser revisadas na homologação.
- TLS PostgreSQL verifica o certificado. Se necessário, configure a CA oficial em DB_SSL_CA; não desative a verificação para contornar erros em produção.
- `npm run backup` recusa PostgreSQL, em vez de anunciar um falso backup SQLite. Para PostgreSQL use pg_dump/backups do provedor, com restauração de teste.
- Produção sem DATABASE_URL e sem DB_PATH explícito não inicia silenciosamente um SQLite vazio.
- Credenciais fixas removidas dos scripts de importação. As ferramentas legadas de importação estão bloqueadas por padrão e NÃO são necessárias para atualizar uma instalação já existente.

## Dados e segurança

Nenhum banco, backup, .env, node_modules ou dado de cliente foi incluído. O original recebido não foi alterado. Os testes usaram bancos temporários.

O ZIP recebido continha credencial de banco em scripts e arquivos .env. Troque a senha exposta no Supabase e atualize DATABASE_URL no ambiente da Hostinger. Não cole a senha ou a URL completa em chats, logs ou arquivos versionados.

Não rode `migrate_to_supabase.js` ou `setup_supabase.js` no banco em uso. São utilitários históricos de uma importação anterior, não uma migração incremental desta revisão. A criação incremental das tabelas ocorre no início normal do servidor.

## Validação

- Suíte `npm test`: testes de OS, sessão, legado, peças, propostas, valores, aprovação, duplicação e conversão; inclui regressões de tipos do painel, transações e atlas B_. Resultado final registrado em VALIDACAO.txt.
- PostgreSQL local via PGlite: criação idempotente do esquema, login, peça, orçamento, sigilo de custos, aprovação, nova versão, duplicação e conversão em OS, incluindo cadastro automático de serviço.
- O pool/isolamento de transações foi testado com clientes simulados. PGlite não verifica a conexão de rede, certificados TLS, pooler ou permissões reais da Hostinger/Supabase.
- Conferência visual em navegador da página inicial e login, além da página pública em frame de 390 × 844, sem transbordamento horizontal e com menu funcional. O movimento em 16 direções foi verificado por testes de eventos.

## Antes de aplicar no projeto atual

Entregue este pacote ao Codex com `CONTINUAR-NO-CODEX.md`. Ele deve comparar com a versão MAIS RECENTE do seu projeto, incorporar as correções e preservar qualquer mudança feita depois do ZIP enviado. Não substitua o projeto atual inteiro sem essa comparação.
