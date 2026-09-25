// Edge Function: whatsapp-status
// ------------------------------------------------------------
// Integração com a API oficial do WhatsApp (Meta Cloud API) pra mandar
// mensagens automáticas de status de pedido pro cliente, e pra loja
// salvar/testar as credenciais direto pelo painel.
//
// Como a loja está iniciando a conversa (o cliente não mandou mensagem
// pro WhatsApp da loja primeiro), toda mensagem exige um modelo de
// mensagem (template) pré-aprovado pela Meta — não dá pra mandar texto
// livre. O modelo esperado (criado manualmente pelo usuário no WhatsApp
// Manager) tem corpo "Atualização do seu pedido #{{1}}: {{2}}", onde
// {{1}} é o número do pedido e {{2}} é a frase do status.
//
// Ações: 'salvar_credenciais' | 'testar_conexao' | 'enviar'.
// As duas primeiras exigem ser dono da loja (JWT no header Authorization).
// 'enviar' não exige autenticação de dono — é chamada também pelo app do
// cliente (anônimo) ao finalizar o pedido, e pelo app do entregador (PIN);
// mesmo nível de exposição das RPCs SECURITY DEFINER já usadas no projeto,
// já que só manda uma mensagem de cortesia associada a um pedido existente.
//
// Segredos necessários: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
// (automáticos) e PROJECT_ANON_KEY (mesma configurada pra ifood-auth/status).
// Não precisa de Secret nenhum da Meta — Phone Number ID e Token ficam
// guardados por loja em whatsapp_config, não são globais do projeto.

import { createClient } from 'npm:@supabase/supabase-js@2';

const META_BASE = 'https://graph.facebook.com/v21.0';

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

function normalizarNumero(whatsapp: string): string | null {
  const digitos = (whatsapp || '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

// Frase que entra na variável {{2}} do modelo aprovado — o modelo já
// cuida do "Atualização do seu pedido #X:", então aqui só a continuação.
function fraseParaStatus(pedido: any, status: string): string | null {
  switch (status) {
    case 'recebido': return 'foi recebido e já estamos preparando! 🎉';
    case 'aceito': return 'foi confirmado pela loja e está sendo preparado.';
    case 'pronto': return pedido.tipo_entrega === 'retirada'
      ? 'está pronto para retirada!'
      : 'está pronto e logo sai para entrega.';
    case 'saiu_entrega': return 'saiu para entrega! 🛵';
    case 'entregue': return 'foi entregue. Bom apetite! 😋';
    case 'recusado': return `foi recusado: ${pedido.motivo_recusa || 'entre em contato com a loja'}.`;
    default: return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { acao, estabelecimento_id, pedido_id, status, phone_number_id, access_token, template_name } = await req.json();
    if (!acao) return jsonResponse({ erro: 'Ação faltando.' }, 400);

    if (acao === 'enviar') {
      if (!pedido_id || !status) return jsonResponse({ erro: 'pedido_id ou status faltando.' }, 400);

      const { data: pedido } = await supabaseAdmin
        .from('pedidos')
        .select('id, numero, estabelecimento_id, tipo_entrega, motivo_recusa, clientes(whatsapp)')
        .eq('id', pedido_id)
        .maybeSingle();
      if (!pedido) return jsonResponse({ erro: 'Pedido não encontrado.' }, 404);

      const { data: config } = await supabaseAdmin
        .from('whatsapp_config')
        .select('*')
        .eq('estabelecimento_id', pedido.estabelecimento_id)
        .maybeSingle();
      if (!config?.phone_number_id || !config?.access_token || !config.notificacoes_ativas) {
        return jsonResponse({ ok: true, ignorado: true });
      }

      const numero = normalizarNumero((pedido as any).clientes?.whatsapp);
      const frase = fraseParaStatus(pedido, status);
      if (!numero || !frase) return jsonResponse({ ok: true, ignorado: true });

      const resp = await fetch(`${META_BASE}/${config.phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: numero,
          type: 'template',
          template: {
            name: config.template_name || 'status_pedido',
            language: { code: 'pt_BR' },
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: String(pedido.numero) },
                { type: 'text', text: frase }
              ]
            }]
          }
        })
      });
      if (!resp.ok) {
        console.error(`Meta recusou envio pro pedido ${pedido_id}:`, resp.status, await resp.text());
        return jsonResponse({ erro: 'Falha ao enviar mensagem.' }, 502);
      }
      return jsonResponse({ ok: true });
    }

    // Demais ações exigem ser dono da loja
    if (!estabelecimento_id) return jsonResponse({ erro: 'estabelecimento_id faltando.' }, 400);
    const autorizado = await validarDonoDaLoja(req, estabelecimento_id);
    if (!autorizado) return jsonResponse({ erro: 'Sem permissão para essa loja.' }, 403);

    if (acao === 'salvar_credenciais') {
      if (!phone_number_id) return jsonResponse({ erro: 'Phone Number ID faltando.' }, 400);

      const { data: atual } = await supabaseAdmin.from('whatsapp_config').select('access_token').eq('estabelecimento_id', estabelecimento_id).maybeSingle();
      const tokenFinal = access_token || atual?.access_token;
      if (!tokenFinal) return jsonResponse({ erro: 'Token de acesso faltando.' }, 400);

      const { error } = await supabaseAdmin.from('whatsapp_config').upsert({
        estabelecimento_id,
        phone_number_id,
        access_token: tokenFinal,
        template_name: template_name || 'status_pedido',
        atualizado_em: new Date().toISOString()
      });
      if (error) return jsonResponse({ erro: 'Falha ao salvar.' }, 500);
      return jsonResponse({ ok: true });
    }

    if (acao === 'testar_conexao') {
      const { data: config } = await supabaseAdmin.from('whatsapp_config').select('*').eq('estabelecimento_id', estabelecimento_id).maybeSingle();
      if (!config?.phone_number_id || !config?.access_token) return jsonResponse({ erro: 'Salve as credenciais primeiro.' }, 400);

      const resp = await fetch(`${META_BASE}/${config.phone_number_id}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${config.access_token}` }
      });
      const dados = await resp.json();
      if (!resp.ok) {
        console.error('Falha ao testar conexão com a Meta:', resp.status, dados);
        return jsonResponse({ erro: dados?.error?.message || 'A Meta recusou a conexão.' }, 502);
      }
      return jsonResponse({ numero: dados.display_phone_number, nome: dados.verified_name });
    }

    return jsonResponse({ erro: 'Ação inválida.' }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ erro: String(err) }, 500);
  }
});
