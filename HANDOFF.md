# Cardápio Digital — Estado do Projeto (handoff para Claude Code)

## Documento original
O pedido inicial completo do usuário (todas as 42 seções do esboço
funcional, escopo da V1, etc.) está em `ESBOCO_ORIGINAL.md`, nesta mesma
pasta. Vale ler esse arquivo primeiro se precisar confirmar algum
detalhe de comportamento que não esteja claro aqui no handoff — ele é a
fonte da verdade de requisitos funcionais. Este arquivo (`HANDOFF.md`) é
o estado atual + os briefings de design que vieram depois.

## Contexto
Este projeto já está funcionando de ponta a ponta: banco de dados no
Supabase rodando, app do cliente e painel da loja conectados e testados
localmente com sucesso (login funcionando, dados reais do Supabase).

## O que já está pronto e testado
- **Banco de dados**: `supabase/schema.sql` e `supabase/migracao_v2.sql`
  já foram executados no projeto Supabase real (projeto: `cardapio-digital`,
  ref `psgffdanlpaxgvenzqeh`). Todas as tabelas, RLS, triggers de
  notificação e o bucket de storage `produtos` já existem.
- **Credenciais já preenchidas** em `cliente/app.js`, `painel/app.js` e
  `cliente/lojas.html` (constantes `SUPABASE_URL` e `SUPABASE_ANON_KEY`).
- **Login do dono da loja já criado** no Supabase Auth e vinculado à loja
  de exemplo ("Minha Lanchonete", id `531d5ee5-cfe1-4519-b238-b7197dc8df5d`)
  via tabela `usuario_lojas`.
- **Testado localmente**: abrir `painel/index.html` direto no navegador
  (arquivo extraído de verdade, não de dentro do .zip) e o login funciona.
- Funcionalidades já implementadas: cardápio do cliente completo (carrinho,
  checkout, PIX/dinheiro, acompanhamento em tempo real), painel da loja
  (kanban de pedidos em tempo real, CRUD de produtos com upload de foto pro
  Supabase Storage, taxas de entrega, dashboard), multi-loja (seleção de
  loja no painel e em `cliente/lojas.html`), notificações push (falta só
  configurar as chaves VAPID e publicar a Edge Function — ver
  `README.md`, seção "V2").

## Estrutura de arquivos
```
cardapio-digital/
├── supabase/
│   ├── schema.sql
│   ├── migracao_v2.sql
│   └── functions/send-push/index.ts
├── cliente/  (index.html, app.js, lojas.html, manifest.json, sw.js)
├── painel/   (index.html, app.js, sw.js)
└── README.md
```
Cada `index.html` tem CSS embutido no próprio arquivo (sem framework, sem
build step — HTML/CSS/JS puro + Supabase JS via CDN).

## Pendências conhecidas
1. **Ainda sem produtos/categorias cadastrados de verdade** — só a loja de
   exemplo existe no banco, sem itens no cardápio.
2. **Push notifications**: código pronto, mas as chaves VAPID e a Edge
   Function ainda não foram configuradas/publicadas.
3. **Ícones do PWA** (`icon-192.png`, `icon-512.png`) são placeholders —
   faltam os ícones reais da marca.
4. **Layout está funcional mas simples** — é o próximo pedido (ver briefing
   abaixo). Um bug já corrigido: as fontes Google (Poppins/Inter) não
   estavam sendo carregadas via `<link>` — isso já foi corrigido nos 3
   arquivos HTML.

---

## Briefing de redesign — estilo "Brendi"

O pedido é deixar o visual mais parecido com plataformas modernas de
cardápio digital brasileiras (referência citada: Brendi). Características
desse estilo, com base no que a própria Brendi descreve do produto:

- **Seção de destaques em formato "stories"** no topo do cardápio do
  cliente (carrossel horizontal com fotos grandes e cantos arredondados,
  parecido com Instagram Stories) — hoje o projeto só tem categorias em
  chips, sem essa camada visual de destaque
- **Fotografia de produto em primeiro plano**: fotos maiores, com mais
  espaço de respiro, tratamento visual "apetitoso" (sombras suaves,
  overlay de gradiente em banners promocionais)
- **Banners promocionais** ocupando espaço de destaque no topo do
  cardápio (hoje o projeto não tem essa seção)
- **Checkout com poucos cliques**, visual limpo, botões grandes e
  confiança visual no processo de pagamento (isso o projeto atual já tem
  como base — é sobretudo refinar a estética)
- **Painel administrativo mais "dashboard moderno"**: cards com mais
  hierarquia visual, gráficos simples (não só números), indicação clara
  do que precisa de atenção agora (pedidos novos com destaque visual mais
  forte que hoje)

### O que já está no lugar certo (não precisa refazer, só refinar)
- Paleta de cores (verde escuro `#14251C` + laranja `#FF5A36`) já é
  distinta e "apetitosa" — pode manter ou evoluir, mas a base é sólida
- Estrutura mobile-first, cards arredondados, bottom sheets para
  carrinho/checkout — já segue os padrões esperados desse tipo de app
- Fluxo completo de pedido já funciona ponta a ponta

### Sugestão de prioridade pro Claude Code
1. Fontes já corrigidas — confirmar que carregaram visualmente
2. Adicionar seção de destaques/banners no topo do cardápio do cliente
3. Refinar cards de produto (mais espaço, foto maior)
4. Refinar dashboard do painel (mais visual, menos só números crus)
5. Gerar/pedir os ícones do PWA

### Mockup aprovado (referência visual concreta — v2, revisada)
O usuário mandou uma imagem de referência de um concorrente (estilo
"Vem Delivery"/dashboard com gráficos) e aprovou uma direção final.
Implementar estes elementos em `cliente/index.html` / `cliente/app.js`,
logo abaixo do header atual e antes da lista de produtos:

1. **Grade de destaques com foto** (NÃO é círculo estilo Stories — isso
   foi uma v1 descartada). É uma grade `grid-template-columns: 1fr 1fr`
   (2 colunas) de cards com:
   - foto do produto ocupando o card inteiro, `height: ~90px`,
     `border-radius: 12px`
   - selo circular verde de "disponível" (`✓`, ~18px, `background:
     #2E8B57`) no canto superior direito, sobreposto à foto
   - nome do produto abaixo da foto (11px, weight 500)
   - preço abaixo do nome, na cor de destaque (`#FF5A36`)
   - fonte dos dados: produtos com `preco_promocional` não nulo, ou os
     mais vendidos (client decide critério — pode ser só os primeiros N
     produtos ativos por enquanto)
2. **Toggle Delivery/Retirada visível no header**, como dois "pills"
   lado a lado logo abaixo do nome da loja (hoje esse toggle só aparece
   depois, no checkout — trazer pra frente como preview visual no topo,
   mesmo que a escolha real ainda aconteça no checkout)
3. **Navegação inferior fixa** (bottom nav bar) com 3 itens: Início,
   Cardápio, Carrinho — o ícone de Carrinho leva um badge numérico com a
   quantidade de itens (reaproveitar a lógica que já existe no carrinho
   flutuante atual, só mudar a apresentação visual pra virar parte dessa
   barra fixa em vez do balão flutuante solto)
4. **Cards de produto da lista principal**: manter como já estão hoje
   (foto ~76-90px, descrição, preço, botão +) — não precisam do mesmo
   tratamento da grade de destaques, que é uma seção à parte

Paleta usada no mockup (já é a mesma do projeto, não muda):
`--ink:#14251C` `--accent:#FF5A36` `--paper:#FAF9F4` `--line:#E7E3D8`
`--muted:#8B8B80` `--success:#2E8B57`.

Manter mobile-first, os bottom sheets de carrinho/checkout como estão —
o redesign é só na tela inicial do cardápio (header + destaques + banner
+ lista de produtos).

## Fase 1.5 — Kanban de pedidos do painel (referência direta, imagem real)
O usuário mandou um print do painel de gestão de pedidos real da Brendi
(não é mockup de marketing, é a tela de uso). Isso serve de referência
quase direta pro Kanban que já existe em `painel/index.html` /
`painel/app.js` (`renderKanban()`), que hoje é funcional mas visualmente
simples. Elementos específicos a copiar o padrão:

- **Cabeçalho de cada coluna** vira um card colorido próprio (não só um
  título de texto): nome da coluna + contador de pedidos num badge
  redondo + valor total em R$ da coluna, tudo dentro de um card com fundo
  em tom pastel da cor do status. Mapeamento de cor por status (adaptado
  pra paleta do projeto, não precisa ser vermelho/laranja/azul/verde
  literal da Brendi — pode usar tons compatíveis com `--ink` e
  `--accent`):
  - Recebido/Novo → tom de alerta (ex: coral/vermelho suave)
  - Preparando → tom âmbar/laranja
  - Pronto → tom azul
  - Em entrega → tom verde
  - Finalizados → tom neutro/cinza
- **Cards de pedido dentro de cada coluna** ganham mais hierarquia:
  número do pedido em destaque + horário, nome do cliente com uma
  etiqueta pequena tipo "Cliente novo" ou "Segundo pedido" (dá pra
  calcular isso comparando com pedidos anteriores do mesmo `cliente_id`
  no Supabase — se for o primeiro pedido dele naquela loja, mostra
  "Cliente novo"), forma de pagamento, valor total, e um selo "A cobrar"
  quando o pagamento ainda não foi confirmado (pagamento na entrega).
- **Botões de ação directamente no card** (sem precisar abrir o modal
  pra ações simples): "Recusar" (contorno vermelho) e o botão de avançar
  status (preenchido, verde ou na cor de destaque) lado a lado no rodapé
  do card — isso é uma mudança de UX: hoje as ações só existem dentro do
  modal de detalhe (`abrirPedido()`); manter o modal pra ver detalhes
  completos, mas adicionar os botões rápidos direto no card do Kanban
  também.
- **Barra superior da tela de pedidos**: campo de busca (por nome,
  telefone ou número do pedido) + atalhos rápidos tipo "Pausar loja" (já
  existe como toggle no header, pode só ganhar destaque visual) — não é
  prioridade crítica, mas é fácil de adicionar reaproveitando dados que
  já existem.

Isso é ortogonal à seção de gráficos (dashboard com pizza/barra) descrita
abaixo — o Kanban é a tela mais usada no dia a dia da loja, então pode
inclusive vir ANTES dos gráficos na priorização, se o Claude Code quiser
reordenar.

## Fase 2 (depois do redesign do cardápio) — Dashboard do painel
O usuário também mostrou referência de um painel administrativo bem mais
robusto visualmente (estilo dashboard de analytics): sidebar escura de
navegação, cartões de indicador coloridos por categoria (vendas, faturamento,
total de pedidos — cada um com um ícone e cor própria), gráfico de barras
"Vendas por dia" comparando períodos, e dois gráficos de pizza/rosca
("Produtos mais vendidos" e "Origem do faturamento"). Isso é mais trabalho
que o redesign do cardápio (precisa de biblioteca de gráficos, tipo
Chart.js via CDN) — tratar como próxima etapa, não bloquear o redesign do
cardápio do cliente por causa disso. O dashboard atual em `painel/app.js`
(`renderDashboard()`) já calcula os números certos (pedidos do dia, vendas,
ticket médio, ranking de mais vendidos) — o trabalho aqui é majoritariamente
de apresentação visual, não de lógica nova.

## Onde estão as credenciais (não são segredo de alto risco, mas trate com cuidado)
- Supabase URL: `https://psgffdanlpaxgvenzqeh.supabase.co`
- Anon key: já está nos 3 arquivos (`cliente/app.js`, `painel/app.js`,
  `cliente/lojas.html`) — é a chave pública seguro para navegador, não a
  `service_role`.
- **Nunca** commitar ou usar a chave `service_role` no front-end — essa só
  entra na Edge Function `send-push`, como variável de ambiente no
  Supabase.
