# Instrução para o Codex

Use este pacote revisado como referência de correções da Bios Informática. Primeiro leia LEIA-ME-REVISAO.md, HOSTINGER.md e CHRONOS.md e compare com a versão mais recente do meu projeto. Integre as correções sem perder mudanças feitas depois do ZIP original. Não publique ainda.

Preserve a página escura com verde, a raposa B_ transparente na abertura e os 16 olhares que acompanham o mouse. Mantenha o título “Seu computador precisa de uma solução.” legível em branco/verde. Use os novos arquivos de marca/atlas e a configuração de recorte correspondente; não misture o atlas novo com coordenadas do anterior. Confira logo, impressão, celular, movimento reduzido e falha de carregamento.

Preserve os módulos de peças, propostas detalhadas e OS. Corrija os tipos de item entre painel e API, os totais e a margem. Não recrie dados, não gere seeds e não substitua meu banco. Preserve clientes, OS, propostas, itens, históricos, aprovações, códigos públicos e tokens existentes.

Faça backup verificável do banco atual antes de qualquer alteração de produção. Em banco de homologação separado, confira a criação incremental das tabelas PostgreSQL, transações no mesmo cliente do pool, certificado TLS e RLS. Não execute os scripts históricos de importação. Não use banco de produção para testes automatizados.

Verifique qual implantação, diretório raiz e DATABASE_URL estão ativos, sem exibir segredos. Compare contagens e cadastros antes/depois para investigar os orçamentos que parecem ter sumido. O fato de o código estar no ZIP não prova que os dados estejam no banco certo. Não restaure backup por cima de dados recentes sem antes apresentar uma comparação e um plano específico.

A senha de banco encontrada no pacote original precisa ser trocada pelo proprietário no Supabase e atualizada na Hostinger. Preserve as demais variáveis válidas, o PORT do ambiente e o JWT_SECRET privado. Não escreva novas credenciais no código nem use rejectUnauthorized:false.

Execute npm ci e npm test na versão Node da hospedagem. Teste na interface: cadastrar peça; montar orçamento com peça, serviço, item avulso, frete e desconto; salvar e reabrir; imprimir com logo sem custos; aprovar pelo link; editar e exigir nova aprovação; duplicar; converter em OS sem duplicar. Confira desktop e celular 390px.

Ao terminar, apresente alterações, testes e pendências. Prepare o pacote com package.json na raiz, sem .env, banco, backups e node_modules. Aguarde minha ordem explícita antes de publicar na Hostinger.
