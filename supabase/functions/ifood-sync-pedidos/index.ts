// Edge Function: ifood-sync-pedidos
// ------------------------------------------------------------
// Disparada pelo pg_cron (veja migracao_v12.sql) uma vez por minuto.
// Para cada loja autorizada no iFood, busca pedidos novos via polling
// de eventos e importa pro mesmo Kanban dos pedidos do cardápio próprio
// (pedidos.origem = 'ifood').
//
// Nomes de campo da API do iFood foram levantados por pesquisa (o
// acesso direto à documentação oficial não foi possível a partir daqui)
// — por isso o payload cru de cada pedido importado é guardado em
// pedidos.ifood_payload_bruto, e um pedido que falhar ao mapear NÃO é
// confirmado (acknowledgment) pro iFood, pra poder ser reprocessado no
// próximo ciclo depois de um ajuste no código.
//
// Segredos necessários: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (automáticos).

import { createClient } from 'npm:@supabase/supabase-js@2';

const IFOOD_BASE = 'https://merchant-api.ifood.com.br';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function renovarTokenSeNecessario(cred: any) {
  const expiraEm = cred.token_expira_em ? new Date(cred.token_expira_em).getTime() : 0;
  if (expiraEm > Date.now() + 5 * 60 * 1000) return cred; // ainda válido por mais de 5min

  const resp = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grantType: 'refresh_token',
      clientId: cred.client_id,
      clientSecret: cred.client_secret,
      refreshToken: cred.refresh_token
    })
  });
  if (!resp.ok) {
    console.error(`Falha ao renovar token da loja ${cred.estabelecimento_id}:`, resp.status, await resp.text());
    await supabaseAdmin.from('ifood_credenciais').update({ autorizado: false }).eq('estabelecimento_id', cred.estabelecimento_id);
    return null;
  }
  const dados = await resp.json();
  const atualizado = {
    ...cred,
    access_token: dados.accessToken,
    refresh_token: dados.refreshToken || cred.refresh_token,
    token_expira_em: new Date(Date.now() + (Number(dados.expiresIn) || 21600) * 1000).toISOString()
  };
  await supabaseAdmin.from('ifood_credenciais').update({
    access_token: atualizado.access_token,
    refresh_token: atualizado.refresh_token,
    token_expira_em: atualizado.token_expira_em
  }).eq('estabelecimento_id', cred.estabelecimento_id);
  return atualizado;
}

async function garantirProdutoPlaceholder(cred: any): Promise<string | null> {
  if (cred.produto_placeholder_id) return cred.produto_placeholder_id;
  const { data, error } = await supabaseAdmin.from('produtos').insert({
    estabelecimento_id: cred.estabelecimento_id,
    categoria_id: null,
    nome: '[iFood] Item importado',
    preco: 0,
    ativo: false
  }).select('id').single();
  if (error) { console.error('Erro ao criar produto placeholder do iFood:', error); return null; }
  await supabaseAdmin.from('ifood_credenciais').update({ produto_placeholder_id: data.id }).eq('estabelecimento_id', cred.estabelecimento_id);
  return data.id;
}

function extrairWhatsapp(order: any): string {
  const phone = order?.customer?.phone;
  if (phone?.number) return `${phone.areaCode || ''}${phone.number}`.replace(/\D/g, '') || `ifood-${order.id}`;
  return `ifood-${order.id}`;
}

async function importarPedido(cred: any, order: any, produtoPlaceholderId: string) {
  const whatsapp = extrairWhatsapp(order);
  const nomeCliente = order?.customer?.name || 'Cliente iFood';

  const { data: cliente, error: erroCliente } = await supabaseAdmin
    .from('clientes')
    .upsert({ estabelecimento_id: cred.estabelecimento_id, nome: nomeCliente, whatsapp }, { onConflict: 'estabelecimento_id,whatsapp' })
    .select('id')
    .single();
  if (erroCliente) throw erroCliente;

  const isEntrega = order.orderType === 'DELIVERY';
  let enderecoId: string | null = null;
  if (isEntrega && order.delivery?.deliveryAddress) {
    const end = order.delivery.deliveryAddress;
    const { data: endereco, error: erroEndereco } = await supabaseAdmin.from('enderecos').insert({
      cliente_id: cliente.id,
      cep: end.postalCode || null,
      rua: end.streetName || end.formattedAddress || 'Endereço iFood',
      numero: end.streetNumber || 'S/N',
      bairro: end.neighborhood || '-',
      complemento: end.complement || null,
      referencia: end.reference || null
    }).select('id').single();
    if (erroEndereco) throw erroEndereco;
    enderecoId = endereco.id;
  }

  const itens = Array.isArray(order.items) ? order.items : [];
  const subtotalItens = itens.reduce((soma: number, item: any) => soma + (Number(item.price ?? item.unitPrice * item.quantity) || 0), 0);
  const total = Number(order.total?.orderAmount ?? order.totalPrice ?? subtotalItens);
  const taxaEntrega = Number(order.total?.deliveryFee ?? 0);
  const subtotal = Number(order.total?.subTotal ?? subtotalItens);

  const { data: pedido, error: erroPedido } = await supabaseAdmin.from('pedidos').insert({
    estabelecimento_id: cred.estabelecimento_id,
    cliente_id: cliente.id,
    endereco_id: enderecoId,
    tipo_entrega: isEntrega ? 'entrega' : 'retirada',
    status: 'recebido',
    forma_pagamento: 'ifood',
    subtotal,
    taxa_entrega: taxaEntrega,
    total,
    origem: 'ifood',
    ifood_order_id: order.id,
    ifood_payload_bruto: order
  }).select('id').single();
  if (erroPedido) throw erroPedido;

  for (const item of itens) {
    const quantidade = Number(item.quantity) || 1;
    const precoUnitario = Number(item.unitPrice ?? (item.price / quantidade)) || 0;
    await supabaseAdmin.from('itens_pedido').insert({
      pedido_id: pedido.id,
      produto_id: produtoPlaceholderId,
      nome_produto: item.name || 'Item',
      preco_unitario: precoUnitario,
      quantidade,
      subtotal: Number(item.price) || precoUnitario * quantidade
    });
  }
}

async function processarLoja(credOriginal: any) {
  const cred = await renovarTokenSeNecessario(credOriginal);
  if (!cred) return;

  const respEventos = await fetch(`${IFOOD_BASE}/events/v1.0/events:polling`, {
    headers: { Authorization: `Bearer ${cred.access_token}`, 'x-polling-merchants': cred.merchant_id || '' }
  });

  if (respEventos.status === 204) {
    await supabaseAdmin.from('ifood_credenciais').update({ ultimo_polling_em: new Date().toISOString() }).eq('estabelecimento_id', cred.estabelecimento_id);
    return;
  }
  if (!respEventos.ok) {
    console.error(`Polling de eventos falhou pra loja ${cred.estabelecimento_id}:`, respEventos.status, await respEventos.text());
    return;
  }

  const eventos = await respEventos.json();
  const eventosConfirmados: { id: string }[] = [];

  for (const evento of eventos) {
    try {
      if (evento.code !== 'PLC') { eventosConfirmados.push({ id: evento.id }); continue; }

      const orderId = evento.orderId || evento.metadata?.orderId;
      const { data: jaExiste } = await supabaseAdmin.from('pedidos').select('id').eq('ifood_order_id', orderId).maybeSingle();
      if (jaExiste) { eventosConfirmados.push({ id: evento.id }); continue; }

      const respPedido = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${cred.access_token}` }
      });
      if (!respPedido.ok) throw new Error(`GET /order/${orderId} falhou: ${respPedido.status}`);
      const order = await respPedido.json();

      const produtoPlaceholderId = await garantirProdutoPlaceholder(cred);
      if (!produtoPlaceholderId) throw new Error('Sem produto placeholder');

      await importarPedido(cred, order, produtoPlaceholderId);
      eventosConfirmados.push({ id: evento.id });
    } catch (err) {
      // Não confirma esse evento — ele volta no próximo polling, dando
      // chance de corrigir o código sem perder o pedido.
      console.error(`Erro ao importar evento ${evento.id} da loja ${cred.estabelecimento_id}:`, err);
    }
  }

  if (eventosConfirmados.length) {
    await fetch(`${IFOOD_BASE}/events/acknowledgment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventosConfirmados)
    });
  }

  await supabaseAdmin.from('ifood_credenciais').update({ ultimo_polling_em: new Date().toISOString() }).eq('estabelecimento_id', cred.estabelecimento_id);
}

Deno.serve(async (_req) => {
  try {
    const { data: lojas, error } = await supabaseAdmin.from('ifood_credenciais').select('*').eq('autorizado', true);
    if (error) throw error;

    await Promise.allSettled((lojas || []).map(processarLoja));

    return new Response(JSON.stringify({ lojasProcessadas: lojas?.length || 0 }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ erro: String(err) }), { status: 500 });
  }
});
