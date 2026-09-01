# Cardápio Digital — Guia de Implantação (V1)

Este pacote contém o **MVP funcional** descrito no seu esboço: cardápio do
cliente (PWA) + painel administrativo da loja, com pedidos em tempo real via
Supabase.

```
cardapio-digital/
├── supabase/
│   ├── schema.sql                  ← banco de dados completo (rodar 1º)
│   ├── migracao_v2.sql             ← fotos, push e multi-loja (rodar 2º)
│   └── functions/send-push/        ← Edge Function que envia os pushes
├── cliente/                        ← app do cliente
│   ├── index.html
│   ├── app.js
│   ├── lojas.html                  ← seleção de loja (multi-loja)
│   ├── manifest.json
│   └── sw.js
└── painel/                         ← painel da loja
    ├── index.html
    ├── app.js
    └── sw.js
```

## Passo 1 — Criar o projeto no Supabase

1. Crie uma conta grátis em [supabase.com](https://supabase.com) e um novo projeto.
2. Vá em **SQL Editor** → cole todo o conteúdo de `supabase/schema.sql` → **Run**.
   Isso cria todas as tabelas, segurança (RLS), o gerador de número de pedido
   e já insere uma loja de exemplo ("Minha Lanchonete").
3. Em **Project Settings → API**, copie:
   - `Project URL`
   - `anon public key`

## Passo 2 — Conectar os dois apps ao seu Supabase

Abra `cliente/app.js` e `painel/app.js` e troque as 2 primeiras linhas de cada um:

```js
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA-CHAVE-ANON-PUBLICA';
```

No `cliente/app.js`, ajuste também `SLUG_LOJA` se você mudou o slug da loja.

## Passo 3 — Criar o usuário da loja (login do painel)

1. No Supabase, vá em **Authentication → Users → Add user** e crie um login
   (e-mail + senha) para o dono da loja.
2. Copie o `UID` desse usuário.
3. No **SQL Editor**, rode (trocando os valores):

```sql
insert into usuarios (id, estabelecimento_id, nome, papel)
values ('COLE-O-UID-AQUI', (select id from estabelecimentos where slug = 'minha-lanchonete'), 'Dono da loja', 'admin');
```

Pronto — esse e-mail/senha já entram no painel.

## Passo 4 — Cadastrar categorias, produtos e taxas de bairro

Abra `painel/index.html` no navegador (ou já publicado, ver Passo 5), faça
login e cadastre pela aba **Cardápio** (produtos) e **Config** (taxas de
entrega). Categorias podem ser inseridas rapidamente pelo SQL Editor:

```sql
insert into categorias (estabelecimento_id, nome, ordem)
values
  ((select id from estabelecimentos where slug='minha-lanchonete'), 'Pratos do Dia', 1),
  ((select id from estabelecimentos where slug='minha-lanchonete'), 'Hambúrgueres', 2),
  ((select id from estabelecimentos where slug='minha-lanchonete'), 'Bebidas', 3);
```

## Passo 5 — Publicar (hospedagem gratuita)

Os dois apps são HTML/CSS/JS puro — não precisam de build. As opções mais
simples:

- **Netlify / Vercel**: arraste a pasta `cliente` para publicar o cardápio, e
  a pasta `painel` (em outro projeto/subdomínio) para publicar o painel.
- **GitHub Pages**: suba o repositório e ative Pages apontando para cada pasta.

Recomendado: publicar `cliente` em algo como `cardapio.suamarca.com` e
`painel` em `painel.suamarca.com`.

## O que já funciona nesta V1

- Cardápio com categorias, busca, fotos, promoções e disponibilidade do dia
- Produto com adicionais, remoção de ingrediente (via observação) e observação
- Carrinho editável + cálculo de taxa por bairro
- Identificação do cliente sem senha (nome + WhatsApp, salvo no navegador)
- Entrega ou retirada, PIX na entrega ou dinheiro com troco
- Envio do pedido, número do pedido, acompanhamento de status **em tempo
  real** (Supabase Realtime)
- Painel da loja com login, abrir/fechar loja manualmente, Kanban de pedidos
  em tempo real, aceitar/recusar, preparar, pronto, saiu para entrega,
  finalizar
- Gestão de produtos (criar/editar/desativar/marcar esgotado) e taxas de
  entrega por bairro
- Dashboard com pedidos do dia, vendas, ticket médio e mais vendidos
- PWA instalável no celular (cliente)

## O que fica para a próxima etapa (fora do escopo da V1)

- Ícones do PWA (`icon-192.png` / `icon-512.png` — troque pelos da sua marca)

---

## V2 — Notificações push, upload de foto e multi-loja

Depois de rodar `supabase/schema.sql`, rode também `supabase/migracao_v2.sql`
no SQL Editor. Ele adiciona o bucket de fotos, os gatilhos de notificação e
a tabela `usuario_lojas` (multi-loja) — sem apagar nada do que já existe.

### Upload de foto direto pelo painel

Já funciona assim que a migração V2 rodar: na aba **Cardápio**, ao criar ou
editar um produto, escolha um arquivo de imagem — ele sobe para o Supabase
Storage (bucket `produtos`) e a URL pública é salva automaticamente. Não
precisa configurar nada além da migração.

### Multi-loja

- **No painel**: se o mesmo login administra mais de uma loja, uma tela de
  seleção aparece após o login, e dá pra trocar de loja tocando no nome dela
  no topo. Para dar acesso a uma segunda loja para alguém que já tem conta:

  ```sql
  insert into usuario_lojas (id_usuario, estabelecimento_id, papel)
  values ('UID-DO-USUARIO', 'ID-DA-SEGUNDA-LOJA', 'admin');
  ```

- **No cardápio do cliente**: `cliente/lojas.html` lista todas as lojas
  cadastradas e leva para `cliente/index.html?loja=slug-da-loja`. Se você
  administra uma rede, esse é o link que você compartilha (em vez do link
  direto de uma loja só). Uma única loja continua funcionando normalmente
  sem esse parâmetro.

### Notificações push de verdade

Isso tem mais partes móveis porque envolve criptografia (Web Push) e uma
função rodando fora do navegador. Siga na ordem:

**1. Gere as chaves VAPID** (uma vez só, na sua máquina):

```bash
npx web-push generate-vapid-keys
```

Isso gera uma chave pública e uma privada.

**2. Cole a chave pública** em `cliente/app.js` e `painel/app.js`, na
constante `VAPID_PUBLIC_KEY`.

**3. Configure os segredos da Edge Function**, no Dashboard do Supabase em
**Edge Functions → Secrets** (ou via CLI):

```bash
supabase secrets set VAPID_PUBLIC_KEY="sua-chave-publica"
supabase secrets set VAPID_PRIVATE_KEY="sua-chave-privada"
supabase secrets set VAPID_SUBJECT="mailto:contato@sualoja.com"
```

**4. Publique a Edge Function** (precisa do [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase functions deploy send-push
```

**5. Ligue o gatilho**: no Dashboard, vá em **Database → Webhooks → Create a
new hook**, e configure:
- Table: `notificacoes`
- Events: `Insert`
- Type: `Supabase Edge Function`
- Function: `send-push`

Pronto: toda vez que o status de um pedido muda (ou um pedido novo chega),
o banco já registra a notificação automaticamente (isso está no
`migracao_v2.sql`), o webhook chama a função, e ela envia o push de verdade
para quem estiver inscrito.

**6. Teste**: no app do cliente, depois de fazer um pedido, toque em
"🔔 Avisar quando o status mudar". No painel, o próprio login já pede
permissão de notificação automaticamente. Troque o status de um pedido de
teste no painel e o celular do cliente deve receber o push.

> Sem HTTPS não tem push: em produção isso é automático (Netlify/Vercel já
> servem com HTTPS). Rodando local, use `localhost`, que o navegador trata
> como seguro para esse fim.

## Testando localmente antes de publicar

Não abra o `index.html` direto (file://) — os módulos falham. Rode um
servidor simples dentro de cada pasta:

```bash
cd cliente && python3 -m http.server 8000
# depois abra http://localhost:8000
```
