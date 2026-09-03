// Edge Function: ifood-status
// ------------------------------------------------------------
// Manda pro iFood as mudanças de status que já acontecem no nosso
// sistema (confirmar, cancelar, pronto pra retirada, despachar, concluir),
// chamada tanto pelo painel (autenticado por sessão) quanto pelo app do
// entregador (autenticado por PIN). Só age em pedidos com origem='ifood';
// pedido do cardápio próprio é ignorado sem erro.
//
// Recebe { acao, pedido_id, entregador_id?, pin?, cancellation_code? }.
// Ações: 'confirmar' | 'cancelar' | 'pronto_retirada' | 'despachar' |
// 'concluir' | 'listar_motivos_cancelamento'.
//
// Nomes de endpoint vieram da documentação oficial de homologação do
// iFood (colada pelo usuário), exceto o de conclusão, que não veio
// especificado — tentamos um nome plausível e ajustamos conforme o
// retorno real da homologação.
//
// Segredos necessários: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
// (automáticos) e PROJECT_ANON_KEY (mesma configurada pra ifood-auth).

import { createClient } from 'npm:@supabase/supabase-js@2';

const IFOOD_BASE = 'https://merchant-api.ifood.com.br';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

async function validarDonoDaLoja(req: Request, estabelecimentoId: string): Promise<boolean> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return false;
  const supabaseComoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('PROJECT_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData } = await supabaseComoUsuario.auth.getUser();
  if (!userData?.user) return false;
  const { data: vinculo } = await supabaseComoUsuario
    .from('usuario_lojas')
    .select('estabelecimento_id')
    .eq('id_usuario', userData.user.id)
    .eq('estabelecimento_id', estabelecimentoId)
    .maybeSingle();
  return !!vinculo;
}

async function validarEntregador(entregadorId: string, pin: string, estabelecimentoId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('entregadores')
    .select('id')
    .eq('id', entregadorId).eq('pin', pin).eq('ativo', true).eq('estabelecimento_id', estabelecimentoId)
    .maybeSingle();
  return !!data;
}

async function renovarTokenSeNecessario(cred: any) {
  const expiraEm = cred.token_expira_em ? new Date(cred.token_expira_em).getTime() : 0;
  if (expiraEm > Date.now() + 5 * 60 * 1000) return cred;

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { acao, pedido_id, entregador_id, pin, cancellation_code } = await req.json();
    if (!acao) return jsonResponse({ erro: 'Ação faltando.' }, 400);
    if (!pedido_id) return jsonResponse({ erro: 'pedido_id faltando.' }, 400);

    const { data: pedido } = await supabaseAdmin
      .from('pedidos')
      .select('id, estabelecimento_id, origem, ifood_order_id, tipo_entrega')
      .eq('id', pedido_id)
      .maybeSingle();
    if (!pedido) return jsonResponse({ erro: 'Pedido não encontrado.' }, 404);

    // Autoriza: dono da loja (painel) OU entregador daquela mesma loja
    const authHeader = req.headers.get('Authorization');
    const autorizado = authHeader
      ? await validarDonoDaLoja(req, pedido.estabelecimento_id)
      : (entregador_id && pin ? await validarEntregador(entregador_id, pin, pedido.estabelecimento_id) : false);
    if (!autorizado) return jsonResponse({ erro: 'Sem permissão para esse pedido.' }, 403);

    // Pedido do cardápio próprio (não veio do iFood) — nada a sincronizar
    if (pedido.origem !== 'ifood' || !pedido.ifood_order_id) {
      return jsonResponse({ ok: true, ignorado: true });
    }

    const { data: credOriginal } = await supabaseAdmin
      .from('ifood_credenciais')
      .select('*')
      .eq('estabelecimento_id', pedido.estabelecimento_id)
      .maybeSingle();
    if (!credOriginal?.autorizado) return jsonResponse({ erro: 'Loja não autorizada no iFood.' }, 400);

    const cred = await renovarTokenSeNecessario(credOriginal);
    if (!cred) return jsonResponse({ erro: 'Não foi possível renovar o acesso ao iFood.' }, 502);

    const headersIfood = { Authorization: `Bearer ${cred.access_token}`, 'Content-Type': 'application/json' };
    const orderId = pedido.ifood_order_id;
    let resp: Response;

    if (acao === 'confirmar') {
      resp = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}/confirm`, { method: 'POST', headers: headersIfood });
    } else if (acao === 'pronto_retirada') {
      resp = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}/readyToPickup`, { method: 'PUT', headers: headersIfood });
    } else if (acao === 'despachar') {
      resp = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}/dispatch`, { method: 'PUT', headers: headersIfood });
    } else if (acao === 'concluir') {
      resp = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}/conclude`, { method: 'PUT', headers: headersIfood });
    } else if (acao === 'listar_motivos_cancelamento') {
      resp = await fetch(`${IFOOD_BASE}/order/v1.0/cancellationReasons`, { headers: headersIfood });
      const lista = await resp.json();
      if (!resp.ok) return jsonResponse({ erro: 'iFood recusou.', detalhe: lista }, 502);
      return jsonResponse({ motivos: lista });
    } else if (acao === 'cancelar') {
      if (!cancellation_code) return jsonResponse({ erro: 'cancellation_code faltando.' }, 400);
      resp = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}/requestCancellation`, {
        method: 'POST', headers: headersIfood,
        body: JSON.stringify({ reason: 'Recusado pela loja', cancellationCode: cancellation_code })
      });
    } else {
      return jsonResponse({ erro: 'Ação inválida.' }, 400);
    }

    if (!resp.ok) {
      const detalhe = await resp.text();
      console.error(`iFood recusou a ação '${acao}' no pedido ${orderId}:`, resp.status, detalhe);
      return jsonResponse({ erro: 'iFood recusou a ação.', detalhe }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ erro: String(err) }, 500);
  }
});
