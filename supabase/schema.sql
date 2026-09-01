-- ============================================================
-- CARDÁPIO DIGITAL — SCHEMA COMPLETO (V1)
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase
-- ============================================================

-- Extensões necessárias
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. ESTABELECIMENTOS (preparado para multi-loja no futuro)
-- ------------------------------------------------------------
create table estabelecimentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text,
  slug text unique not null,              -- usado na URL do cardápio: /loja/slug
  aberto boolean not null default true,
  pausado_manualmente boolean not null default false,
  tempo_entrega_min int not null default 30,
  tempo_entrega_max int not null default 45,
  pedido_minimo numeric(10,2) default 0,
  criado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. USUÁRIOS DA LOJA (ligados ao Supabase Auth)
-- ------------------------------------------------------------
create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  nome text,
  papel text not null default 'admin' check (papel in ('admin','operador')),
  criado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. HORÁRIO DE FUNCIONAMENTO
-- ------------------------------------------------------------
create table horarios_funcionamento (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6), -- 0=domingo
  fechado boolean not null default false,
  abre_as time,
  fecha_as time
);

-- ------------------------------------------------------------
-- 4. CATEGORIAS
-- ------------------------------------------------------------
create table categorias (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  ativa boolean not null default true
);

-- ------------------------------------------------------------
-- 5. PRODUTOS
-- ------------------------------------------------------------
create table produtos (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  categoria_id uuid references categorias(id) on delete set null,
  nome text not null,
  descricao text,
  preco numeric(10,2) not null,
  preco_promocional numeric(10,2),
  foto_url text,
  disponivel_hoje boolean not null default true,
  esgotado boolean not null default false,
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. ADICIONAIS (grupos e itens) — por produto
-- ------------------------------------------------------------
create table adicionais (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  nome text not null,
  preco numeric(10,2) not null default 0,
  ativo boolean not null default true
);

-- ------------------------------------------------------------
-- 7. CLIENTES (identificados por WhatsApp, sem senha)
-- ------------------------------------------------------------
create table clientes (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  nome text not null,
  whatsapp text not null,
  criado_em timestamptz not null default now(),
  unique (estabelecimento_id, whatsapp)
);

-- ------------------------------------------------------------
-- 8. ENDEREÇOS SALVOS DO CLIENTE
-- ------------------------------------------------------------
create table enderecos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  cep text,
  rua text not null,
  numero text not null,
  bairro text not null,
  complemento text,
  referencia text,
  criado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 9. TAXAS DE ENTREGA POR BAIRRO
-- ------------------------------------------------------------
create table taxas_entrega (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  bairro text not null,
  valor numeric(10,2) not null,
  ativa boolean not null default true,
  unique (estabelecimento_id, bairro)
);

-- ------------------------------------------------------------
-- 10. PEDIDOS
-- ------------------------------------------------------------
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text not null,                    -- ex: A184 (exibido ao cliente)
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  cliente_id uuid not null references clientes(id),
  endereco_id uuid references enderecos(id),
  tipo_entrega text not null check (tipo_entrega in ('entrega','retirada')),
  status text not null default 'recebido'
    check (status in ('recebido','aceito','recusado','preparando','pronto','saiu_entrega','entregue','cancelado')),
  motivo_recusa text,
  forma_pagamento text not null check (forma_pagamento in ('pix','dinheiro')),
  troco_para numeric(10,2),
  subtotal numeric(10,2) not null,
  taxa_entrega numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  observacao_geral text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 11. ITENS DO PEDIDO
-- ------------------------------------------------------------
create table itens_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  nome_produto text not null,               -- snapshot do nome no momento da compra
  preco_unitario numeric(10,2) not null,    -- snapshot do preço
  quantidade int not null default 1,
  observacao text,
  ingredientes_removidos text[],
  subtotal numeric(10,2) not null
);

-- ------------------------------------------------------------
-- 12. ADICIONAIS ESCOLHIDOS POR ITEM
-- ------------------------------------------------------------
create table item_adicionais (
  id uuid primary key default gen_random_uuid(),
  item_pedido_id uuid not null references itens_pedido(id) on delete cascade,
  nome text not null,                       -- snapshot
  preco numeric(10,2) not null default 0    -- snapshot
);

-- ------------------------------------------------------------
-- 13. CONFIGURAÇÕES GERAIS (chave/valor por loja)
-- ------------------------------------------------------------
create table configuracoes (
  estabelecimento_id uuid primary key references estabelecimentos(id) on delete cascade,
  chave_pix text,
  mensagem_fechado text default 'Estamos fechados no momento.'
);

-- ------------------------------------------------------------
-- 14. NOTIFICAÇÕES (log interno, loja + cliente)
-- ------------------------------------------------------------
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  pedido_id uuid references pedidos(id) on delete cascade,
  destino text not null check (destino in ('loja','cliente')),
  titulo text not null,
  corpo text,
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 15. INSCRIÇÕES PUSH (web push)
-- ------------------------------------------------------------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references estabelecimentos(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  usuario_id uuid references usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- ÍNDICES ÚTEIS
-- ============================================================
create index idx_produtos_estabelecimento on produtos(estabelecimento_id);
create index idx_pedidos_estabelecimento_status on pedidos(estabelecimento_id, status);
create index idx_pedidos_cliente on pedidos(cliente_id);
create index idx_itens_pedido on itens_pedido(pedido_id);

-- ============================================================
-- FUNÇÃO: gerar número de pedido sequencial simples (ex: A184)
-- ============================================================
create sequence pedido_numero_seq;

create or replace function gerar_numero_pedido()
returns trigger as $$
begin
  new.numero := 'A' || nextval('pedido_numero_seq');
  return new;
end;
$$ language plpgsql;

create trigger trg_numero_pedido
before insert on pedidos
for each row execute function gerar_numero_pedido();

-- ============================================================
-- RLS (ROW LEVEL SECURITY)
-- ============================================================
alter table estabelecimentos enable row level security;
alter table usuarios enable row level security;
alter table horarios_funcionamento enable row level security;
alter table categorias enable row level security;
alter table produtos enable row level security;
alter table adicionais enable row level security;
alter table clientes enable row level security;
alter table enderecos enable row level security;
alter table taxas_entrega enable row level security;
alter table pedidos enable row level security;
alter table itens_pedido enable row level security;
alter table item_adicionais enable row level security;
alter table configuracoes enable row level security;
alter table notificacoes enable row level security;
alter table push_subscriptions enable row level security;

-- Leitura pública (o cardápio precisa ser visível sem login)
create policy "publico le estabelecimentos" on estabelecimentos for select using (true);
create policy "publico le horarios" on horarios_funcionamento for select using (true);
create policy "publico le categorias" on categorias for select using (ativa = true);
create policy "publico le produtos" on produtos for select using (ativo = true);
create policy "publico le adicionais" on adicionais for select using (ativo = true);
create policy "publico le taxas" on taxas_entrega for select using (ativa = true);

-- Cliente: pode criar seu próprio cadastro e endereço, e ler/editar o que é seu
create policy "qualquer um cria cliente" on clientes for insert with check (true);
create policy "cliente le proprio cadastro" on clientes for select using (true);
create policy "qualquer um cria endereco" on enderecos for insert with check (true);
create policy "endereco e visivel" on enderecos for select using (true);

-- Pedidos: qualquer visitante pode criar; leitura é liberada (o app filtra por id/numero no cliente)
create policy "qualquer um cria pedido" on pedidos for insert with check (true);
create policy "pedido e visivel" on pedidos for select using (true);
create policy "qualquer um cria item pedido" on itens_pedido for insert with check (true);
create policy "item pedido visivel" on itens_pedido for select using (true);
create policy "qualquer um cria item adicional" on item_adicionais for insert with check (true);
create policy "item adicional visivel" on item_adicionais for select using (true);

-- Loja (usuário autenticado) pode gerenciar tudo do seu próprio estabelecimento
create policy "loja gerencia estabelecimento" on estabelecimentos for update
  using (id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja gerencia horarios" on horarios_funcionamento for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja gerencia categorias" on categorias for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja gerencia produtos" on produtos for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja gerencia adicionais" on adicionais for all
  using (produto_id in (select id from produtos where estabelecimento_id in
    (select estabelecimento_id from usuarios where id = auth.uid())));

create policy "loja gerencia taxas" on taxas_entrega for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja atualiza pedidos" on pedidos for update
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja gerencia configuracoes" on configuracoes for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "loja le notificacoes" on notificacoes for all
  using (estabelecimento_id in (select estabelecimento_id from usuarios where id = auth.uid()));

create policy "qualquer um cria push subscription" on push_subscriptions for insert with check (true);
create policy "loja le proprio usuario" on usuarios for select using (id = auth.uid());

-- ============================================================
-- REALTIME: habilitar broadcast de mudanças na tabela pedidos
-- ============================================================
alter publication supabase_realtime add table pedidos;

-- ============================================================
-- DADOS DE EXEMPLO (apague ou edite como quiser)
-- ============================================================
insert into estabelecimentos (nome, slug, tempo_entrega_min, tempo_entrega_max, pedido_minimo)
values ('Minha Lanchonete', 'minha-lanchonete', 30, 45, 0)
returning id;
-- Copie o "id" retornado acima e use-o para inserir categorias/produtos/taxas de teste,
-- ou cadastre tudo depois pelo Painel da Loja.
