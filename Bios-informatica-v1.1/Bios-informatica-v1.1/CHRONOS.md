# Raposa da Bios Informática

A mascote existente foi usada como referência de identidade. O emblema ciano do notebook foi substituído por B_ verde. Os novos arquivos foram gerados a partir das imagens fornecidas, com fundo transparente. Como edição generativa, pode haver pequenas diferenças de traço em relação ao original; não é uma edição manual exata de pixels.

## Arquivos usados

- `public/assets/brand/chronos-bios.png`: imagem estática e marca de empresa.
- `public/assets/chronos/chronos-bios-atlas.png`: animação, 1968 × 799, oito colunas.
- `public/js/chronos.js`: animação local, 16 direções e pausa quando fora de tela.
- `public/css/chronos.css`: tamanho e posicionamento, sem moldura.
- `public/assets/favicon.svg`: B_ simplificado para ícones pequenos.

## Coordenadas do atlas novo

A imagem editada tem dimensões diferentes do atlas original. Cada recorte tem 246 × 240 pixels; x é a coluna multiplicada por 246; os y das três linhas são 40, 306 e 559. O desenho é apresentado em canvas 192 × 208. A primeira linha contém os seis quadros de descanso; as duas seguintes contêm os 16 olhares.

O atributo `data-branded-atlas="true"` identifica esse atlas mesmo na prévia incorporada como data URL. Não redimensione a imagem sem atualizar os recortes e os testes. O suporte ao atlas anterior é mantido para compatibilidade; ele não é o usado na página revisada.

A animação não coleta coordenadas fora da página nem envia dados. Em movimento reduzido ou se o atlas falhar, a imagem estática permanece visível. Em touch, a raposa permanece em descanso.

## Briefing da edição

Editar a mascote fornecida, mantendo raposa laranja, capuz e notebook, substituir somente o emblema da tampa por B_ verde, com fundo transparente. Para o atlas: conservar poses e ordem dos quadros e remover retângulos de fundo existentes entre as personagens.
