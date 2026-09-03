// Edge Function: ifood-auth
// ------------------------------------------------------------
// Chamada pelo painel (supabase.functions.invoke) pra autorizar a loja
// no iFood. Recebe { acao: 'iniciar' | 'confirmar', estabelecimento_id,
// codigo_autorizacao? }.
//
// 'iniciar'  -> pede um userCode ao iFood e devolve o código + link pra
//               o dono da loja autorizar no Portal do Parceiro.
// 'confirmar' -> troca o código autorizado por access_token/refresh_token.
//
// Segredos necessários (Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente.
//   PROJECT_ANON_KEY precisa ser configurada manualmente (usada só pra
//   validar, via RLS, que quem chamou é dono da loja) — não pode se
//   chamar SUPABASE_ANON_KEY porque o Supabase reserva esse prefixo.

import { createClient } from 'npm:@supabase/supabase-js@2';

const IFOOD_BASE = 'https://merchant-api.ifood.com.br';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Sem isso, o navegador bloqueia a chamada por CORS antes mesmo dela
// chegar na função (o painel roda num domínio, a function noutro).
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { acao, estabelecimento_id, codigo_autorizacao } = await req.json();
    if (!acao || !estabelecimento_id) return jsonResponse({ erro: 'Parâmetros faltando.' }, 400);

    const autorizado = await validarDonoDaLoja(req, estabelecimento_id);
    if (!autorizado) return jsonResponse({ erro: 'Sem permissão para essa loja.' }, 403);

    const { data: cred } = await supabaseAdmin
      .from('ifood_credenciais')
      .select('*')
      .eq('estabelecimento_id', estabelecimento_id)
      .maybeSingle();

    if (!cred?.client_id || !cred?.client_secret) {
      return jsonResponse({ erro: 'Cadastre o Client ID e o Client Secret do iFood antes de autorizar.' }, 400);
    }

    if (acao === 'iniciar') {
      const resp = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/userCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ clientId: cred.client_id })
      });
      const texto = await resp.text();
      if (!resp.ok) {
        console.error('iFood oauth/userCode falhou:', resp.status, texto);
        return jsonResponse({ erro: 'iFood recusou o pedido de autorização.', detalhe: texto }, 502);
      }
      const dados = JSON.parse(texto);

      await supabaseAdmin.from('ifood_credenciais').update({
        user_code: dados.userCode,
        authorization_code_verifier: dados.authorizationCodeVerifier,
        verification_url: dados.verificationUrlComplete || dados.verificationUrl,
        atualizado_em: new Date().toISOString()
      }).eq('estabelecimento_id', estabelecimento_id);

      return jsonResponse({
        userCode: dados.userCode,
        verificationUrlComplete: dados.verificationUrlComplete || dados.verificationUrl
      });
    }

    if (acao === 'confirmar') {
      if (!cred.user_code || !cred.authorization_code_verifier) {
        return jsonResponse({ erro: 'Nenhuma autorização pendente. Clique em "Autorizar loja no iFood" primeiro.' }, 400);
      }

      const resp = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grantType: 'authorization_code',
          clientId: cred.client_id,
          clientSecret: cred.client_secret,
          authorizationCode: codigo_autorizacao || cred.user_code,
          authorizationCodeVerifier: cred.authorization_code_verifier
        })
      });
      const texto = await resp.text();
      if (!resp.ok) {
        console.error('iFood oauth/token falhou:', resp.status, texto);
        return jsonResponse({ erro: 'Ainda não autorizado. Confirme no link do iFood e tente de novo.', detalhe: texto }, 409);
      }
      const dados = JSON.parse(texto);
      const expiraEm = new Date(Date.now() + (Number(dados.expiresIn) || 21600) * 1000).toISOString();

      let merchantId: string | null = null;
      try {
        const respMerchants = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants`, {
          headers: { Authorization: `Bearer ${dados.accessToken}` }
        });
        if (respMerchants.ok) {
          const merchants = await respMerchants.json();
          const lista = Array.isArray(merchants) ? merchants : merchants?.data;
          if (lista?.length) merchantId = lista[0].id || lista[0].merchantId || null;
        }
      } catch (err) {
        console.error('Não foi possível listar merchants do iFood:', err);
      }

      await supabaseAdmin.from('ifood_credenciais').update({
        access_token: dados.accessToken,
        refresh_token: dados.refreshToken,
        token_expira_em: expiraEm,
        autorizado: true,
        merchant_id: merchantId,
        user_code: null,
        authorization_code_verifier: null,
        verification_url: null,
        atualizado_em: new Date().toISOString()
      }).eq('estabelecimento_id', estabelecimento_id);

      return jsonResponse({ ok: true, merchantId });
    }

    return jsonResponse({ erro: 'Ação inválida.' }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ erro: String(err) }, 500);
  }
});
