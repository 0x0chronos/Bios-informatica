# Bios Informática — versão 1.1 revisada

**Comece por LEIA-ME-REVISAO.md e CONTINUAR-NO-CODEX.md.** Esta revisão inclui mascote B_, catálogo de peças e propostas detalhadas, além do driver PostgreSQL corrigido. Abra PREVIA-BIOS.html para conferir a página inicial sem instalar. As instruções de Supabase atuais estão em HOSTINGER.md.


Página pública simplificada e evolução do painel de OS existente. Este pacote é uma versão para revisão e homologação; não foi publicado automaticamente.

## O que mudou

- Página inicial objetiva, com serviços, processo, região, perguntas frequentes e WhatsApp.
- Raposa com notebook B_ e identidade escura com verde. Sem fotografias que representem uma loja física não confirmada, depoimentos de exemplo ou contadores inventados.
- Sem carrinho, calendário de atendimento ou cobrança PIX ilustrativa. A antiga API pública de agendamento está desativada (HTTP 410).
- SEO preservado: canonical .store, sitemap, robots, dados estruturados com informações confirmadas e imagem de compartilhamento existente no pacote.
- Painel reaproveitado em `/painel` (o endereço antigo `/bios_os_manager.html` também abre o login).
- Clientes, serviços, OS, pagamentos, relatórios, impressão e mensagens WhatsApp mantidos.
- Sessão administrativa em cookie HttpOnly/SameSite, verificação no servidor, expiração de 8 horas e invalidação das sessões do usuário ao sair ou trocar credenciais.
- Sem usuário/senha padrão em novas instalações. Contas antigas com a senha padrão exigem troca antes de acessar os cadastros.
- Link aleatório por OS, com possibilidade de invalidar o anterior. Consulta pública não aceita número da OS, CPF ou telefone.
- Orçamento público com descrição, valor, versão e registro de aprovação. Alterações de valor ou serviço na OS retiram o orçamento de publicação até você publicar novamente.
- Histórico de status e aprovações. Estados adicionais: aguardando aprovação, entregue e cancelado.
- Impressão de OS e comprovante, sem CNPJ fictício e sem tratar impressão HTML como nota fiscal.
- Backend e banco fora da pasta pública. Backup SQLite consistente e migração que preserva dados.
- Sem Google Analytics ou pixels nesta versão. O clique em WhatsApp emite apenas um evento local `bios:contact-click`, sem transmitir ou salvar dados.

## Estrutura

```text
server.js                aplicação Express
package.json             npm start / npm test / npm run backup
public/                  único diretório servido como arquivos públicos
  proposta.html          proposta detalhada por link exclusivo
  index.html             página inicial
  painel.html            tela administrativa (dados dependem de login)
  acompanhar.html        acompanhamento via link exclusivo
  privacidade.html       aviso correspondente ao funcionamento implementado
scripts/database.js      acesso ao SQLite e PostgreSQL
scripts/backup.js        backup completo com verificação de integridade
tests/integration.test.js testes do servidor
.env.example             nomes das configurações, sem segredos
HOSTINGER.md             instalação e preservação do banco
CONTINUAR-NO-CODEX.md     roteiro para homologação e próximos passos
```

## Executar localmente

1. Use Node 20 ou superior.
2. Execute `npm ci` (precisa instalar o módulo nativo SQLite apropriado para sua máquina).
3. Copie `.env.example` para `.env` apenas no seu computador e preencha `JWT_SECRET` com pelo menos 32 caracteres aleatórios. Para gerar um valor localmente: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Não envie o resultado em chats.
4. Para acesso local, ajuste `SITE_URL=http://localhost:8000`, `NODE_ENV=development` e `COOKIE_SECURE=false`.
5. Em uma instalação vazia, configure temporariamente `ADMIN_USERNAME` e `ADMIN_PASSWORD` (mínimo 12 caracteres, máximo 72 bytes). Depois da primeira inicialização bem-sucedida, remova `ADMIN_PASSWORD` do ambiente e reinicie. Não há credenciais embutidas.
6. Execute `npm start`. Acesse `http://localhost:8000` e `/painel`.

## Dados existentes

O ZIP de entrega não inclui `.env`, banco, backups, dados de clientes ou `node_modules`.
O padrão de `DB_PATH` continua sendo `database.sqlite` na raiz do projeto para compatibilidade com a instalação anterior. Na Hostinger, configure um caminho persistente separado do diretório substituído nas implantações. A confirmação dessa persistência é necessária antes de receber dados reais.

Na primeira abertura de um banco antigo, o aplicativo:

1. Gera uma cópia consistente antes da migração.
2. Cria colunas e tabelas adicionais sem excluir registros.
3. Gera links de acompanhamento para OS antigas.
4. Preserva clientes, serviços, ordens e usuários.

Dados de demonstração antigos não são removidos automaticamente: revise e identifique-os no painel antes de operar. Não os confunda com clientes reais.

## Uso do painel

1. Cadastre clientes e serviços com valores e descrições reais.
2. Crie a OS, indicando equipamento, relato e valor inicialmente estimado.
3. Abra os detalhes da OS. Preencha “Orçamento para aprovação”, com peças, mão de obra, condições e prazo, e publique.
4. Envie o link pelo botão de WhatsApp. O envio é manual: o botão abre uma mensagem pronta.
5. O cliente consulta e pode aprovar aquela versão. A aprovação aparece no painel com valor, descrição, versão e data.
6. Atualize o status e registre o pagamento quando ele realmente ocorrer.
7. Imprima a OS ou comprovante conforme necessário. Não há emissão fiscal integrada.

A aprovação via link registra uma ação de quem possui o link; não valida identidade, assinatura digital ou titularidade do telefone. O link funciona como uma chave de acesso. Notas técnicas internas não aparecem na página do cliente.

## Backup e restauração

- `npm run backup` cria uma cópia SQLite consistente no `BACKUP_DIR` e verifica sua integridade.
- Exporte uma cópia para outro local protegido. O comando não agenda execução nem envia os backups para fora da hospedagem.
- O JSON exportado pelo painel contém cadastros para consulta, mas não substitui o backup integral: não inclui autenticação, histórico completo ou aprovações.
- Para restaurar: pare a aplicação, preserve o banco atual e arquivos `-wal`/`-shm` para reversão, coloque o backup SQLite no caminho definido por `DB_PATH`, remova do caminho ativo os antigos arquivos `-wal`/`-shm` com a aplicação parada e reinicie. Não misture um backup restaurado com WAL de outro banco. Confira login e OS antes de reabrir o atendimento.

## Validação e limites

Nesta revisão, 30 testes passaram no Node 24.19.0. A versão Node da hospedagem ainda deve ser validada antes de publicar. Os testes do servidor cobrem autenticação, origem/cabeçalho nas mutações, acesso a arquivos internos, CRUD, criação concorrente de OS, aprovação e invalidade de versões antigas, revogação de links, backup, reinício e migração. Também foram conferidos os fluxos da interface com DOM simulado.

Não houve inspeção visual em um navegador real neste ambiente. Confira os layouts em celular e computador antes de publicar. A persistência do banco e o comportamento de proxy/HTTPS precisam ser homologados na Hostinger.

As telas administrativas mantêm handlers inline do projeto original; a política CSP permite esses handlers. A separação para event listeners e uma CSP mais restritiva é uma evolução possível. Não considere esta entrega uma certificação de segurança.

Não incluídos nesta versão: fotos de recebimento, anexos, controle de quantidades em estoque, coleta automática de preços de fornecedores, WhatsApp automático, emissão fiscal, recuperação de senha por e-mail e backup externo agendado. A página de privacidade deve acompanhar qualquer mudança futura no tratamento de dados.
