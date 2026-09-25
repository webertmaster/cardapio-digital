-- Rodar depois da migracao_v17.sql
--
-- Guarda a instância da Evolution API pareada por cada loja (WhatsApp
-- automático de status de pedido).

create table whatsapp_config (
  estabelecimento_id uuid primary key references estabelecimentos(id) on delete cascade,
  instance_name text not null,
  conectado boolean not null default false,
  notificacoes_ativas boolean not null default true,
  atualizado_em timestamptz not null default now()
);

alter table whatsapp_config enable row level security;

create policy "loja gerencia whatsapp_config" on whatsapp_config
  for all using (
    exists (
      select 1 from usuario_lojas ul
      where ul.estabelecimento_id = whatsapp_config.estabelecimento_id
        and ul.id_usuario = auth.uid()
    )
  );
