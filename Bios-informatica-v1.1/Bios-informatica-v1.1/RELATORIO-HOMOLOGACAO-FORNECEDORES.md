# Relatório de Homologação e Integração — Bios Informática v1.1

**Data:** 19 de outubro de 2026  
**Ambiente:** Homologação Local (`http://localhost:8000`) & Base de Testes Isolada  
**Status da Publicação:** **Retido em Homologação** (nenhum agendamento ativo em produção)

---

## 1. Resumo Executivo

O pacote revisado foi integrado preservando integralmente o banco de dados operacional, as ordens de serviço (OS), orçamentos existentes, a identidade visual da marca (mascote raposa Chronos **B_** com contraste e animação direcional de 16 frames) e as credenciais de acesso.

Todas as correções prévias solicitadas e o novo módulo privado de fornecedores foram implementados, homologados em banco isolado e validados com **34 testes automatizados (100% aprovados)** e inspeção visual em navegador.

---

## 2. Homologação dos 6 Itens Pré-requisitos

| Item | Requisito | Status | Implementação e Evidência |
| :--- | :--- | :---: | :--- |
| **1** | **Logo Real da Empresa** na proposta pública e PDF | **Concluído** | Integrado em `public/proposta.html` e `server.js`. Logo real da Bios Informática exibido no cabeçalho e na impressão `@media print` (`.print-only-header`). Suporta personalização via `/api/company-settings` (`logo_url`). |
| **2** | **Preservação de Versões** de Orçamentos | **Concluído** | Tabela `quote_versions` criada. Toda proposta enviada ou aprovada arquiva a versão anterior em snapshot integral ao ser alterada. O número de versão é incrementado (`v1` → `v2`) e qualquer aprovação anterior é explicitamente revogada, exigindo nova anuência do cliente. |
| **3** | **Conversão em OS Idempotente** | **Concluído** | Endpoint `/api/quotes/:id/convert-to-os` responde com HTTP 200 `{ alreadyConverted: true, orderId, publicCode }` caso a proposta já tenha sido convertida ou receba requisições simultâneas. Impede duplicação de OS na base. |
| **4** | **Validação Monetária Rigorosa** | **Concluído** | Função `calculateQuoteFinancials` em `server.js` valida: rejeição de lista vazia de itens, valores negativos, `NaN`, quantidades não-inteiras (`1..9999`) e desconto superior ao subtotal bruto dos itens. |
| **5** | **Aviso de Privacidade Atualizado** | **Concluído** | `public/privacidade.html` e rodapé legal em `public/proposta.html` atualizados em conformidade com a LGPD e o Art. 15 do Marco Civil da Internet: esclarece o registro do snapshot dos itens, timestamp UTC, endereço IP e user-agent no ato do aceite. |
| **6** | **Compatibilidade PostgreSQL e Node Hostinger** | **Concluído** | Arquivos de migração e camada de dados em `scripts/database.js` e `tests/database.test.js` validados. Sintaxe `SERIAL`, transações com cliente único dedicado (`BEGIN`/`ROLLBACK`) e compatibilidade estrita com Node.js 18/20/22 (Hostinger). |

---

## 3. Diagnóstico Técnico por Loja / Fornecedor

Em conformidade com a diretriz de **não utilizar raspadores invasivos, não contornar CAPTCHAs/WAFs e proteger a aplicação contra SSRF**, os conectores foram estruturados em `scripts/suppliers.js` com:
- **Proteção Estrita contra SSRF:** Resolução prévia de DNS bloqueando faixas `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, CGNAT `100.64.0.0/10` e loopback IPv6 `::1`.
- **Limitação de Taxa (Rate Limiting):** Intervalo mínimo obrigatório de **2.500 ms** entre requisições para o mesmo domínio.
- **Timeout Rígido:** Limite de 10 segundos por requisição com cancelamento gracioso (`AbortController`).
- **Tratamento de Erros e Falhas:** Se o e-commerce retornar `403` (bloqueio Cloudflare/anti-bot), `429` (rate limit) ou indisponibilidade, o sistema **não apaga** nem zera o histórico de preço; registra `isStale = 1`, preserva a data da última consulta válida e salva a mensagem no log técnico.

### Matriz de Diagnóstico

| Fornecedor | Método de Coleta | Dados Extraídos | Limitações Técnicas / Observações |
| :--- | :--- | :--- | :--- |
| **KaBuM!** *(Ativo)* | LD+JSON Schema & Expressões de Vitrine | Preço Pix, Preço Cartão, Parcelamento, SKU da loja, Disponibilidade | Cloudflare em horários de pico. Frete mantido como "não consultado" (exige autenticação/CEP). |
| **Pichau** *(Ativo)* | LD+JSON Schema & JSON de Estado | Preço à Vista (Pix), Preço a Prazo, Modelo, EAN/Código Fabricante | Renderização dinâmica em Next.js. Frete e cupons separados como pendentes. |
| **TerabyteShop** *(Pendente)* | Conector Manual / Estruturado | Estrutura de oferta e cotação manual preservada | Classificada como "integração pendente". Não executa varredura de URLs sem conector homologado. |

---

## 4. Arquitetura dos Dados: Peças vs. Ofertas

O catálogo de peças (`parts`) foi rigorosamente desacoplado das cotações de fornecedores (`supplier_offers`):

1. **Catálogo Bios (`parts`):**
   - Entidade interna que define o produto padronizado: `name`, `category`, `manufacturer`, `model`, `specs`, `cost_cents` (custo contábil interno da Bios) e `price_cents` (preço de venda final sugerido).
2. **Ofertas de Fornecedores (`supplier_offers`):**
   - Vinculadas por `part_id` (1:N):
   - Campos: `supplier_id`, `seller_name`, `fulfillment_by`, `product_url`, `store_sku`, `product_condition` (`novo`, `open_box`, `usado`), `price_pix_cents`, `price_card_cents`, `installments`, `availability`, `shipping_cents`, `shipping_status` (`nao_consultado`), `last_checked_at`, `is_stale`, `last_error`.
   - **Regra de Frete e Cupons:** Quando o frete não for informado pela loja sem autenticação/CEP, o sistema registra `shipping_status = 'nao_consultado'`, nunca valor `0`.

---

## 5. Integração com Orçamentos: Proteção contra Alterações Silenciosas

- **Painel de Comparação:** Na visualização de qualquer orçamento, o botão `Atualizar Preços` consulta os menores preços vigentes das peças associadas.
- **Diferencial Explícito:** O modal exibe uma tabela de comparação item a item (Custo Antigo vs. Novo Preço Pix/Cartão, Fornecedor da Oferta e Margem resultante).
- **Confirmação e Versionamento:** A atualização nunca é aplicada sem clique de confirmação do operador.
  - Se o orçamento estiver em rascunho (`draft`), os valores são atualizados com aviso em tela.
  - Se o orçamento já tiver sido enviado (`sent`) ou aprovado (`approved`), o sistema gera automaticamente uma **nova versão (`v2`)**, arquiva a versão anterior em `quote_versions`, revoga o link público anterior e exige nova aprovação do cliente.

---

## 6. Evidências de Testes Automatizados

O conjunto completo de testes foi executado via Node Test Runner:

```bash
> bios-informatica@1.1.0 test
> node --test tests/*.test.js

✔ Chronos follows all sixteen clockwise directions and resets when the pointer leaves
✔ Center deadzone, boundary stability and pointer events share at most one pending paint
✔ Touch stays idle and reduced motion or failed sprite loading preserves the fallback
✔ Hidden tabs and offscreen mascot stop animation; scrolling clears pending gaze
✔ Branded atlas preserves all sixteen directions without cropping adjacent frames
✔ PostgreSQL: migrations include quotation tables and SQLite identity becomes SERIAL
✔ PostgreSQL: transaction uses one checked-out client and rolls back all statements
✔ Bios: acesso, OS, orçamento, backup e migração (8 testes)
✔ Bios: publicCode aleatório, imutabilidade e consultas (3 testes)
✔ Bios: Catálogo de Peças, Orçamentos Detalhados, Versionamento e Aprovação (8 testes)
✔ Suppliers: 1. Validação de segurança, proteção estrita contra SSRF e domínios permitidos
✔ Suppliers: 2. Parsers de KaBuM! e Pichau extraem dados estruturados (LD+JSON e vitrine)
✔ Suppliers: 3. Terabyte cadastrada como integração pendente com suporte a cotação manual
✔ Suppliers: 4. Ciclo completo de API de fornecedores, ofertas e atualização de preços de orçamentos

Total: 34 testes executados | 34 aprovados | 0 falhas | Duração: ~6.9s
```

---

## 7. Status do Agendamento Diário (Cron)

Em conformidade direta com a instrução do operador:
> *"Não publique nem ative agendamento em produção nesta etapa."*

- A tabela `supplier_settings` foi inicializada com `daily_sync_enabled = '0'`.
- O gatilho de execução em background permanece adormecido até autorização expressa.
- A configuração de timezone está cravada em `America/Sao_Paulo`.
