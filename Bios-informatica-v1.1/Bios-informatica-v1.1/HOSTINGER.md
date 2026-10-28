# Aplicar na Hostinger com Supabase

Esta revisão é um pacote local. Não houve deploy nem acesso ao banco de produção.

1. Compare com o código atual e faça um backup do banco existente; confirme uma restauração em destino separado.
2. Homologue em um banco separado. Não execute os scripts históricos de importação; eles podem sobrescrever registros de uma instalação anterior.
3. A raiz do pacote deve conter package.json, server.js e public/. Não selecione a pasta externa incompleta do ZIP antigo.
4. Mantenha as variáveis válidas no ambiente: DATABASE_URL, JWT_SECRET, SITE_URL=https://biosinformatica.store, NODE_ENV=production e COOKIE_SECURE=true. Preserve a porta atribuída à aplicação. TRUST_PROXY_HOPS depende da configuração real da hospedagem.
5. Troque a senha de banco exposta no pacote original e atualize DATABASE_URL sem colocá-la no código, ZIP, chat ou log. Use a URL indicada pelo painel Connect do Supabase para a conexão escolhida.
6. O TLS agora verifica o certificado. Se necessário, obtenha a CA oficial do provedor e configure DB_SSL_CA como PEM (aceita \\n). Não use DB_SSL=false em produção.
7. O servidor cria tabelas/colunas adicionais de forma idempotente. A função de conexão precisa de permissões para essas migrações e para o acesso administrativo. RLS fica habilitado nas tabelas; chamadas públicas passam exclusivamente pelos endpoints Express com token. Revise também políticas existentes.
8. Execute npm ci e npm test com a versão Node da hospedagem. Dependências nativas precisam ser instaladas no destino; não envie node_modules do Windows ou de outra versão de Node.
9. Antes de publicar, confira contagens e registros reais do painel, salvamento/reabertura de orçamento, aprovação, nova versão, impressão com logo e conversão em OS. Teste reinício e compare os dados.
10. Publique somente após a ordem do proprietário. Limpe o cache da Hostinger se necessário; CSS/JS possuem versão na URL.

## Backup

O comando npm run backup é exclusivo de SQLite e recusa DATABASE_URL configurada. Para PostgreSQL use pg_dump ou o backup efetivamente contratado no provedor; confirme alcance, retenção e restauração. Não considere uma mensagem de teste SQLite como validação de backup Supabase.

## Alternativa SQLite

Se a instalação optar explicitamente por SQLite, omita DATABASE_URL e configure DB_PATH e BACKUP_DIR em diretórios persistentes fora da pasta substituída pelo deploy. Nunca sobrescreva o arquivo do banco com um arquivo vazio. Em produção, o servidor exige DATABASE_URL ou DB_PATH explícito.
