// ============================================================
// CONFIGURAÇÃO
// ============================================================
const SUPABASE_URL = 'https://psgffdanlpaxgvenzqeh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzZ2ZmZGFubHBheGd2ZW56cWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNDMxODAsImV4cCI6MjEwMzYxOTE4MH0.GYbEfYbRArCOsGoankz0_TNrwvd4YoURrPdnZeo9Ub4';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const LS_ENTREGADOR = 'entregador_sessao';
let SESSAO = JSON.parse(localStorage.getItem(LS_ENTREGADOR) || 'null');
let PEDIDOS_ENTREGADOR = [];
let PEDIDOS_CHANNEL = null;
let WATCH_ID = null;

const fmt = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

// ============================================================
// LOGIN (PIN, sem Supabase Auth)
// ============================================================
async function fazerLogin() {
  const slug = document.getElementById('loginSlug').value.trim();
  const pin = document.getElementById('loginPin').value.trim();
  const erroEl = document.getElementById('loginErro');
  erroEl.classList.add('hide');

  if (!slug || !pin) { erroEl.textContent = 'Preencha loja e PIN.'; erroEl.classList.remove('hide'); return; }

  const { data, error } = await sb.rpc('entregador_login', { p_slug: slug, p_pin: pin });
  if (error) {
    console.error('Erro no login do entregador:', error);
    erroEl.textContent = 'Erro ao entrar — veja o console (F12) pra detalhes.';
    erroEl.classList.remove('hide');
    return;
  }
  if (!data || !data.length) {
    erroEl.textContent = 'PIN ou loja inválidos.';
    erroEl.classList.remove('hide');
    return;
  }

  SESSAO = {
    entregadorId: data[0].entregador_id,
    nome: data[0].nome,
    estabelecimentoId: data[0].estabelecimento_id,
    estabelecimentoNome: data[0].estabelecimento_nome,
    disponivel: data[0].disponivel,
    pin
  };
  localStorage.setItem(LS_ENTREGADOR, JSON.stringify(SESSAO));
  entrarNoApp();
}

function sair() {
  localStorage.removeItem(LS_ENTREGADOR);
  location.reload();
}

// ============================================================
// APP PRINCIPAL
// ============================================================
let LOJA_COORDS = null;
let LOJA_WHATSAPP = null;
let ENTREGAS_HOJE = 0;
// null = ainda não carregou nada (não alerta na primeira carga da lista)
let IDS_PEDIDOS_CONHECIDOS = null;

// Fórmula de haversine — mesma usada no cardápio do cliente pra calcular
// a distância entre a loja e o endereço de entrega.
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function entrarNoApp() {
  document.getElementById('telaLogin').classList.add('hide');
  document.getElementById('app').classList.remove('hide');
  document.getElementById('nomeEntregador').textContent = `Olá, ${SESSAO.nome}!`;
  document.getElementById('nomeLoja').textContent = SESSAO.estabelecimentoNome;

  sb.from('estabelecimentos').select('latitude, longitude, whatsapp').eq('id', SESSAO.estabelecimentoId).single()
    .then(({ data }) => {
      if (data && data.latitude != null) {
        LOJA_COORDS = { lat: data.latitude, lng: data.longitude };
        renderPedidosEntregador();
      }
      if (data && data.whatsapp) {
        LOJA_WHATSAPP = data.whatsapp;
        const link = document.getElementById('linkWhatsappLoja');
        link.href = `https://wa.me/${LOJA_WHATSAPP}`;
        link.classList.remove('hide');
      }
    });

  renderDisponibilidade();
  ativarRastreamento();
  carregarPedidosEntregador();
  carregarEntregasHoje();

  PEDIDOS_CHANNEL = sb.channel('entregador-pedidos-' + SESSAO.entregadorId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `entregador_id=eq.${SESSAO.entregadorId}` },
      () => carregarPedidosEntregador())
    .subscribe();
}

async function carregarPedidosEntregador() {
  // Mostra o pedido assim que for atribuído a esse entregador, mesmo que
  // ainda esteja em preparo — assim ele já sabe com antecedência o que
  // está vindo. Só esconde o que já foi finalizado.
  const { data } = await sb.from('pedidos')
    .select('*, clientes(nome, whatsapp), enderecos(*), itens_pedido(*)')
    .eq('entregador_id', SESSAO.entregadorId)
    .not('status', 'in', '(entregue,cancelado,recusado)')
    .order('criado_em');
  PEDIDOS_ENTREGADOR = data || [];

  const idsAgora = new Set(PEDIDOS_ENTREGADOR.map(p => p.id));
  if (IDS_PEDIDOS_CONHECIDOS && [...idsAgora].some(id => !IDS_PEDIDOS_CONHECIDOS.has(id))) {
    alertarPedidoNovo();
  }
  IDS_PEDIDOS_CONHECIDOS = idsAgora;

  renderPedidosEntregador();
}

// Bipe curto via Web Audio API (sem depender de nenhum arquivo de áudio)
// + vibração no Android, pra avisar de um pedido novo mesmo com o
// celular fora da mão.
function alertarPedidoNovo() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
  } catch (err) { console.error('Não foi possível tocar o alerta sonoro:', err); }
  navigator.vibrate?.([200, 100, 200]);
}

function renderPedidosEntregador() {
  const cont = document.getElementById('listaPedidosEntregador');
  if (!PEDIDOS_ENTREGADOR.length) {
    cont.innerHTML = `<div class="empty-state">Nenhum pedido pra você entregar no momento.</div>`;
    return;
  }
  cont.innerHTML = PEDIDOS_ENTREGADOR.map(pedidoEntregaCardHTML).join('');
}

function pedidoEntregaCardHTML(p) {
  const enderecoTxt = p.tipo_entrega === 'entrega' && p.enderecos
    ? `${p.enderecos.rua}, ${p.enderecos.numero}${p.enderecos.complemento ? ' - ' + p.enderecos.complemento : ''} — ${p.enderecos.bairro}${p.enderecos.referencia ? ' (Ref: ' + p.enderecos.referencia + ')' : ''}`
    : 'Retirada no local';
  const itensTxt = (p.itens_pedido || []).map(i => `${i.quantidade}x ${i.nome_produto}`).join(', ');
  const pagamentoTxt = p.forma_pagamento === 'pix' ? 'PIX' : p.forma_pagamento === 'cartao' ? 'Cartão (levar maquininha)' : p.forma_pagamento === 'pdv' ? 'Já pago no caixa' : 'Dinheiro' + (p.troco_para ? ` (troco p/ ${fmt(p.troco_para)})` : '');

  const temCoordenadas = p.enderecos && p.enderecos.latitude != null;
  const botaoRota = temCoordenadas
    ? `<button class="btn-rota" onclick="abrirRota(${p.enderecos.latitude}, ${p.enderecos.longitude})">🗺️ Rota</button>`
    : '';
  const distanciaTxt = (temCoordenadas && LOJA_COORDS)
    ? ` <strong>(${distanciaKm(LOJA_COORDS.lat, LOJA_COORDS.lng, p.enderecos.latitude, p.enderecos.longitude).toFixed(1)} km da loja)</strong>`
    : '';

  const STATUS_LABEL = {
    aceito: { texto: 'Aceito — aguardando preparo', classe: 'aguardando' },
    preparando: { texto: 'Preparando na cozinha', classe: 'aguardando' },
    pronto: { texto: 'Pronto — aguardando retirada', classe: 'pronto' },
    saiu_entrega: { texto: 'Saiu para entrega', classe: '' },
  };
  const statusInfo = STATUS_LABEL[p.status] || { texto: p.status, classe: '' };
  const podeMarcarEntregue = p.status === 'pronto' || p.status === 'saiu_entrega';
  const podeRetirar = p.status === 'pronto' && p.tipo_entrega === 'entrega';

  return `
    <div class="pedido-entrega-card">
      <div class="linha1"><span>#${p.numero}</span><span>${fmt(p.total)}</span></div>
      <div class="linha2">${p.clientes?.nome || 'Cliente'}${p.clientes?.whatsapp ? ' · ' + p.clientes.whatsapp : ''}</div>
      <div class="linha3">📍 ${enderecoTxt}${distanciaTxt}</div>
      <div class="linha3">${itensTxt}</div>
      <div class="linha3">💳 ${pagamentoTxt}</div>
      <span class="tag-status ${statusInfo.classe}">${statusInfo.texto}</span>
      <div class="acoes">
        ${botaoRota}
        ${podeRetirar ? `<button class="btn-retirei" onclick="marcarSaiuEntrega('${p.id}')">📦 Retirei o pedido</button>` : ''}
        ${podeMarcarEntregue ? `<button class="btn-entregue" onclick="marcarEntregue('${p.id}')">✓ Entregue</button>` : ''}
      </div>
    </div>`;
}

function abrirRota(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

async function marcarSaiuEntrega(pedidoId) {
  if (!confirm('Confirmar que você retirou esse pedido na loja e vai sair para entrega?')) return;
  const { error } = await sb.rpc('entregador_marcar_saiu_entrega', {
    p_pedido_id: pedidoId, p_entregador_id: SESSAO.entregadorId, p_pin: SESSAO.pin
  });
  if (error) { alert('Não foi possível confirmar a retirada. Tente novamente.'); return; }
  carregarPedidosEntregador();
}

async function marcarEntregue(pedidoId) {
  if (!confirm('Confirmar que esse pedido foi entregue?')) return;
  const { error } = await sb.rpc('entregador_marcar_entregue', {
    p_pedido_id: pedidoId, p_entregador_id: SESSAO.entregadorId, p_pin: SESSAO.pin
  });
  if (error) { alert('Não foi possível confirmar a entrega. Tente novamente.'); return; }
  ENTREGAS_HOJE++;
  document.getElementById('textoEntregasHoje').textContent = `${ENTREGAS_HOJE} entrega${ENTREGAS_HOJE === 1 ? '' : 's'} hoje`;
  carregarPedidosEntregador();
}

async function carregarEntregasHoje() {
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  const { count, error } = await sb.from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('entregador_id', SESSAO.entregadorId)
    .eq('status', 'entregue')
    .gte('atualizado_em', inicio.toISOString());
  if (error) { console.error('Erro ao carregar entregas de hoje:', error); return; }
  ENTREGAS_HOJE = count || 0;
  document.getElementById('textoEntregasHoje').textContent = `${ENTREGAS_HOJE} entrega${ENTREGAS_HOJE === 1 ? '' : 's'} hoje`;
}

// ============================================================
// DISPONIBILIDADE — o entregador liga/desliga se está de plantão
// ============================================================
function renderDisponibilidade() {
  const btn = document.getElementById('btnDisponibilidade');
  const texto = document.getElementById('textoDisponibilidade');
  btn.classList.toggle('online', SESSAO.disponivel);
  btn.classList.toggle('offline', !SESSAO.disponivel);
  texto.textContent = SESSAO.disponivel ? 'Disponível — toque pra pausar' : 'Indisponível — toque pra ativar';
}

async function alternarDisponibilidade() {
  const novoValor = !SESSAO.disponivel;
  const { error } = await sb.rpc('entregador_definir_disponibilidade', {
    p_entregador_id: SESSAO.entregadorId, p_pin: SESSAO.pin, p_disponivel: novoValor
  });
  if (error) { alert('Não foi possível atualizar. Tente novamente.'); return; }
  SESSAO.disponivel = novoValor;
  localStorage.setItem(LS_ENTREGADOR, JSON.stringify(SESSAO));
  renderDisponibilidade();
}

// ============================================================
// RASTREAMENTO DE LOCALIZAÇÃO (enquanto o app fica aberto)
// ============================================================
let ULTIMO_ENVIO = 0;
const INTERVALO_ENVIO_MS = 5000;

function ativarRastreamento() {
  if (!('geolocation' in navigator)) {
    document.getElementById('textoRastreio').textContent = 'Seu navegador não suporta localização.';
    return;
  }
  WATCH_ID = navigator.geolocation.watchPosition(
    (pos) => {
      document.getElementById('dotRastreio').classList.remove('off');
      document.getElementById('textoRastreio').textContent = 'Localização ativa';
      if (!SESSAO.disponivel) return;
      const agora = Date.now();
      if (agora - ULTIMO_ENVIO < INTERVALO_ENVIO_MS) return;
      ULTIMO_ENVIO = agora;
      sb.rpc('entregador_atualizar_localizacao', {
        p_entregador_id: SESSAO.entregadorId, p_pin: SESSAO.pin,
        p_lat: pos.coords.latitude, p_lng: pos.coords.longitude
      }).then(({ error }) => {
        if (error) {
          console.error('Erro ao enviar localização:', error);
          document.getElementById('textoRastreio').textContent = 'Erro ao enviar localização — veja o console (F12).';
        }
      });
    },
    () => {
      document.getElementById('dotRastreio').classList.add('off');
      document.getElementById('textoRastreio').textContent = 'Permissão de localização negada — ative pra loja te acompanhar.';
    },
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

if (SESSAO) entrarNoApp();
