// Edge Function: send-push
// ------------------------------------------------------------
// Disparada por um Database Webhook do Supabase toda vez que uma
// linha nova é inserida na tabela `notificacoes` (ver README para
// configurar o webhook pelo Dashboard: Database → Webhooks).
//
// Ela lê a notificação recém-criada, encontra as inscrições push
// (push_subscriptions) do destinatário certo — o cliente do pedido,
// ou todos os usuários da loja — e envia o push via Web Push.
//
// Segredos necessários (Project Settings → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex: mailto:contato@sualoja.com)
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@sualoja.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Formato padrão de um Database Webhook do Supabase: { type, table, record, ... }
    const notificacao = payload.record;
    if (!notificacao) return new Response('sem registro', { status: 400 });

    // Descobre para quem mandar o push
    let inscricoes = [];
    if (notificacao.destino === 'cliente') {
      const { data: pedido } = await supabaseAdmin.from('pedidos').select('cliente_id').eq('id', notificacao.pedido_id).single();
      if (pedido) {
        const { data } = await supabaseAdmin.from('push_subscriptions').select('*').eq('cliente_id', pedido.cliente_id);
        inscricoes = data || [];
      }
    } else {
      const { data } = await supabaseAdmin.from('push_subscriptions').select('*').eq('estabelecimento_id', notificacao.estabelecimento_id).not('usuario_id', 'is', null);
      inscricoes = data || [];
    }

    const corpoPush = JSON.stringify({ titulo: notificacao.titulo, corpo: notificacao.corpo });

    const resultados = await Promise.allSettled(
      inscricoes.map((inscricao) =>
        webpush.sendNotification(
          { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
          corpoPush
        ).catch(async (err) => {
          // 410/404 = inscrição expirada, pode remover do banco
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', inscricao.endpoint);
          }
          throw err;
        })
      )
    );

    await supabaseAdmin.from('notificacoes').update({ lida: true }).eq('id', notificacao.id);

    return new Response(JSON.stringify({ enviados: resultados.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ erro: String(err) }), { status: 500 });
  }
});
