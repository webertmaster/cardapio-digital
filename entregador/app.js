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
// Última posição conhecida do GPS — usada como ponto de partida ao
// planejar a rota com múltiplas entregas (ver ativarRastreamento()).
let ULTIMA_POSICAO = null;
let PEDIDOS_SELECIONADOS_ROTA = new Set();
let MAPA_ROTA = null;

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
  const checkboxRota = temCoordenadas
    ? `<label class="check-rota"><input type="checkbox" ${PEDIDOS_SELECIONADOS_ROTA.has(p.id) ? 'checked' : ''} onchange="toggleSelecaoRota('${p.id}')"> Incluir na rota</label>`
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
      ${checkboxRota}
    </div>`;
}

// ============================================================
// ROTA COM MÚLTIPLAS ENTREGAS (opcional — o entregador marca quais
// pedidos quer incluir, a gente calcula a melhor ordem de visita e
// entrega a sequência pronta pro Google Maps navegar de verdade)
// ============================================================
function toggleSelecaoRota(pedidoId) {
  if (PEDIDOS_SELECIONADOS_ROTA.has(pedidoId)) PEDIDOS_SELECIONADOS_ROTA.delete(pedidoId);
  else PEDIDOS_SELECIONADOS_ROTA.add(pedidoId);
  atualizarBotaoRota();
}

function atualizarBotaoRota() {
  const btn = document.getElementById('btnPlanejarRota');
  const n = PEDIDOS_SELECIONADOS_ROTA.size;
  btn.classList.toggle('hide', n < 2);
  document.getElementById('textoPlanejarRota').textContent = `Planejar rota (${n})`;
}

// Vizinho mais próximo: a cada passo, vai pro ponto restante mais perto
// de onde está. Não é o ótimo matemático (isso seria um TSP), mas pra
// poucas paradas (2-6) dá uma ordem muito boa e é simples de explicar.
function calcularMelhorOrdem(origem, pontos) {
  const restantes = [...pontos];
  const ordenados = [];
  let atual = origem;
  while (restantes.length) {
    let iMaisPerto = 0;
    let menorDist = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(atual.lat, atual.lng, p.lat, p.lng);
      if (d < menorDist) { menorDist = d; iMaisPerto = i; }
    });
    const [proximo] = restantes.splice(iMaisPerto, 1);
    ordenados.push(proximo);
    atual = proximo;
  }
  return ordenados;
}

function abrirModalRota() {
  const origem = ULTIMA_POSICAO || LOJA_COORDS;
  if (!origem) { alert('Aguarde sua localização ser encontrada antes de planejar a rota.'); return; }

  const pontos = PEDIDOS_ENTREGADOR
    .filter(p => PEDIDOS_SELECIONADOS_ROTA.has(p.id) && p.enderecos?.latitude != null)
    .map(p => ({
      lat: p.enderecos.latitude, lng: p.enderecos.longitude,
      nome: p.clientes?.nome || 'Cliente', numero: p.numero,
      endereco: `${p.enderecos.rua}, ${p.enderecos.numero} — ${p.enderecos.bairro}`
    }));
  if (pontos.length < 2) return;

  const ordem = calcularMelhorOrdem(origem, pontos);

  document.getElementById('listaRotaOrdenada').innerHTML = ordem.map((p, i) => `
    <div class="parada-rota">
      <span class="numero">${i + 1}</span>
      <div class="info"><strong>#${p.numero} — ${p.nome}</strong><span>${p.endereco}</span></div>
    </div>
  `).join('');

  document.getElementById('modalRota').classList.remove('hide');
  setTimeout(() => desenharMapaRota(origem, ordem), 50);
}

function desenharMapaRota(origem, ordem) {
  if (MAPA_ROTA) { MAPA_ROTA.remove(); MAPA_ROTA = null; }
  MAPA_ROTA = L.map('mapaRota').setView([origem.lat, origem.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19
  }).addTo(MAPA_ROTA);

  const pontosMapa = [[origem.lat, origem.lng]];
  L.marker([origem.lat, origem.lng], {
    icon: L.divIcon({ className: '', html: '<div class="marcador-numerado" style="background:#14251C;">📍</div>', iconSize: [26, 26] })
  }).addTo(MAPA_ROTA).bindPopup('Você está aqui');

  ordem.forEach((p, i) => {
    pontosMapa.push([p.lat, p.lng]);
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', html: `<div class="marcador-numerado">${i + 1}</div>`, iconSize: [26, 26] })
    }).addTo(MAPA_ROTA).bindPopup(`${i + 1}º — ${p.nome}`);
  });

  // O mapa acabou de aparecer dentro do modal — o container pode ainda
  // não ter o tamanho final calculado, então o Leaflet mede de novo
  // antes de enquadrar todos os pontos.
  MAPA_ROTA.invalidateSize();
  MAPA_ROTA.fitBounds(pontosMapa, { padding: [30, 30] });
}

function iniciarRotaGoogleMaps() {
  const origem = ULTIMA_POSICAO || LOJA_COORDS;
  const pontos = PEDIDOS_ENTREGADOR
    .filter(p => PEDIDOS_SELECIONADOS_ROTA.has(p.id) && p.enderecos?.latitude != null)
    .map(p => ({ lat: p.enderecos.latitude, lng: p.enderecos.longitude }));
  const ordem = calcularMelhorOrdem(origem, pontos);

  const destino = ordem[ordem.length - 1];
  const paradas = ordem.slice(0, -1);
  const waypoints = paradas.map(p => `${p.lat},${p.lng}`).join('|');

  const url = `https://www.google.com/maps/dir/?api=1&origin=${origem.lat},${origem.lng}&destination=${destino.lat},${destino.lng}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=driving`;
  window.open(url, '_blank');
  fecharModalRota();
}

function fecharModalRota() {
  document.getElementById('modalRota').classList.add('hide');
}

function abrirRota(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

// Se o pedido veio do iFood, avisa eles da mudança de status (exigido
// pela homologação). Se falhar, só avisa — o status já mudou aqui mesmo
// assim, nosso Kanban é a fonte da verdade.
async function notificarIfood(pedidoId, acao) {
  const pedido = PEDIDOS_ENTREGADOR.find(p => p.id === pedidoId);
  if (!pedido || pedido.origem !== 'ifood') return;
  const { error } = await sb.functions.invoke('ifood-status', {
    body: { pedido_id: pedidoId, acao, entregador_id: SESSAO.entregadorId, pin: SESSAO.pin }
  });
  if (error) {
    console.error('Erro ao notificar o iFood:', error);
    alert('O status mudou aqui, mas não conseguimos avisar o iFood. Tente novamente em instantes.');
  }
}

async function marcarSaiuEntrega(pedidoId) {
  if (!confirm('Confirmar que você retirou esse pedido na loja e vai sair para entrega?')) return;
  const { error } = await sb.rpc('entregador_marcar_saiu_entrega', {
    p_pedido_id: pedidoId, p_entregador_id: SESSAO.entregadorId, p_pin: SESSAO.pin
  });
  if (error) { alert('Não foi possível confirmar a retirada. Tente novamente.'); return; }
  await notificarIfood(pedidoId, 'despachar');
  carregarPedidosEntregador();
}

async function marcarEntregue(pedidoId) {
  if (!confirm('Confirmar que esse pedido foi entregue?')) return;
  const { error } = await sb.rpc('entregador_marcar_entregue', {
    p_pedido_id: pedidoId, p_entregador_id: SESSAO.entregadorId, p_pin: SESSAO.pin
  });
  if (error) { alert('Não foi possível confirmar a entrega. Tente novamente.'); return; }
  await notificarIfood(pedidoId, 'concluir');
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
      ULTIMA_POSICAO = { lat: pos.coords.latitude, lng: pos.coords.longitude };
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
