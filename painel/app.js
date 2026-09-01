// ============================================================
// CONFIGURAÇÃO — troque pelos dados do SEU projeto Supabase
// ============================================================
const SUPABASE_URL = 'https://psgffdanlpaxgvenzqeh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzZ2ZmZGFubHBheGd2ZW56cWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNDMxODAsImV4cCI6MjEwMzYxOTE4MH0.GYbEfYbRArCOsGoankz0_TNrwvd4YoURrPdnZeo9Ub4';

// Mesma chave pública VAPID usada no app do cliente (gerada com `npx web-push generate-vapid-keys`)
const VAPID_PUBLIC_KEY = 'BLq9xJk7tnVmUfIT3enJjI70PQjz934epwo7uXkak9U7P8NzR23QIPwalNHjXCkJVJweqiPCZEUqTywzeV_oFCE';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let USUARIO = null;
let LOJA = null;
let LOJAS_DO_USUARIO = [];
let PEDIDOS = [];
let PRODUTOS = [];
let CATEGORIAS = [];
let RAIOS = [];
let PEDIDO_SELECIONADO = null;

const fmt = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const fmtTaxa = (v) => Number(v) === 0 ? 'Grátis' : fmt(v);

function ingredientesResumoHTML(i, tag = 'small', classe = '') {
  const ings = i.item_pedido_ingredientes || [];
  const removidos = ings.filter(x => x.tipo === 'removido').map(x => x.nome);
  const adicionados = ings.filter(x => x.tipo === 'adicionado').map(x => x.nome);
  const abre = classe ? `<${tag} class="${classe}">` : `<${tag}>`;
  let html = '';
  if (removidos.length) html += `${abre}Sem ${removidos.join(', ')}</${tag}>`;
  if (adicionados.length) html += `${abre}+ ${adicionados.join(', ')}</${tag}>`;
  return html;
}

function textoFormaPagamento(p, curto = false) {
  if (p.forma_pagamento === 'pix') return curto ? 'PIX' : 'PIX na entrega';
  if (p.forma_pagamento === 'cartao') return curto ? 'Cartão' : 'Cartão na entrega';
  if (p.forma_pagamento === 'pdv') return curto ? 'No caixa' : 'Pagamento no caixa (retirada)';
  return curto ? 'Dinheiro' : 'Dinheiro' + (p.troco_para ? ` (troco p/ ${fmt(p.troco_para)})` : '');
}

// ============================================================
// ÍCONES (SVG outline, substituem os emojis pelo visual)
// ============================================================
function icon(nome, tamanho = 16) {
  const paths = {
    printer: '<rect x="5" y="8" width="14" height="8" rx="1"/><path d="M7.5 8V4h9v4"/><rect x="7.5" y="13.5" width="9" height="6"/>',
    mapPin: '<path d="M12 21s7-6.8 7-11.5A7 7 0 0 0 5 9.5C5 14.2 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.4"/>',
    utensils: '<path d="M6.5 2v7"/><path d="M4.5 2v3.5a2 2 0 0 0 4 0V2"/><path d="M6.5 9v13"/><path d="M17.5 2c-1.8 0-2.8 2.2-2.8 5s1 4 2.8 4v11"/>',
  }[nome] || '';
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block">${paths}</svg>`;
}

// ============================================================
// LOGIN
// ============================================================
async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value;
  const erroEl = document.getElementById('loginErro');
  erroEl.classList.add('hide');

  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) { erroEl.textContent = 'E-mail ou senha inválidos.'; erroEl.classList.remove('hide'); return; }

  await carregarLojasDoUsuario(data.user.id);
}

// Reaproveita sessão já existente (ex: ao recarregar a página)
async function checarSessao() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return;
  await carregarLojasDoUsuario(data.session.user.id);
}

// Um usuário pode administrar mais de uma loja (tabela `usuario_lojas`
// tem uma linha por combinação usuário+loja — ver migracao_v2.sql).
// Se tiver só uma, entra direto; se tiver mais de uma, mostra a seleção.
async function carregarLojasDoUsuario(userId) {
  const { data: vinculos } = await sb.from('usuario_lojas').select('*, estabelecimentos(*)').eq('id_usuario', userId);
  if (!vinculos || !vinculos.length) {
    document.getElementById('loginErro').textContent = 'Este usuário não está vinculado a nenhuma loja.';
    document.getElementById('loginErro').classList.remove('hide');
    return;
  }
  LOJAS_DO_USUARIO = vinculos;
  if (vinculos.length === 1) {
    selecionarLoja(vinculos[0]);
  } else {
    renderSeletorLojas(vinculos);
  }
}

function renderSeletorLojas(vinculos) {
  document.getElementById('telaLogin').innerHTML = `
    <div class="login-box">
      <h1>Qual loja você quer gerenciar?</h1>
      <p>Você administra ${vinculos.length} lojas.</p>
      ${vinculos.map((v, i) => `
        <button class="btn-secundario" style="text-align:left;display:flex;align-items:center;gap:10px;" onclick='selecionarLojaPorIndice(${i})'>
          <span style="width:34px;height:34px;border-radius:9px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">${v.estabelecimentos.nome[0]}</span>
          ${v.estabelecimentos.nome}
        </button>`).join('')}
    </div>`;
}
function selecionarLojaPorIndice(i) { selecionarLoja(LOJAS_DO_USUARIO[i]); }

function selecionarLoja(vinculo) {
  USUARIO = vinculo;
  LOJA = vinculo.estabelecimentos;
  document.getElementById('telaLogin').classList.add('hide');
  document.getElementById('app').classList.remove('hide');
  iniciarPainel();
}

// Botão no cabeçalho para trocar de loja, quando o usuário administra mais de uma
function mostrarTrocarLoja() {
  if (LOJAS_DO_USUARIO.length <= 1) return;
  const nomes = LOJAS_DO_USUARIO.map((v, i) => `${i + 1}. ${v.estabelecimentos.nome}`).join('\n');
  const escolha = prompt(`Trocar para qual loja?\n${nomes}\n\nDigite o número:`);
  const i = Number(escolha) - 1;
  if (LOJAS_DO_USUARIO[i]) {
    PEDIDOS_CHANNEL_ATIVO && sb.removeChannel(PEDIDOS_CHANNEL_ATIVO);
    selecionarLoja(LOJAS_DO_USUARIO[i]);
  }
}
let PEDIDOS_CHANNEL_ATIVO = null;

// ============================================================
// PUSH NOTIFICATIONS — inscrição da loja (avisa sobre pedidos novos)
// ============================================================
function base64ParaUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Seguro = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(base64Seguro);
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

async function ativarPushDaLoja() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registro = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') return;
    }
    let inscricao = await registro.pushManager.getSubscription();
    if (!inscricao) {
      inscricao = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ParaUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const json = inscricao.toJSON();
    await sb.from('push_subscriptions').upsert({
      estabelecimento_id: LOJA.id,
      usuario_id: USUARIO.id_usuario,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    }, { onConflict: 'endpoint' });
  } catch (err) {
    console.error('Não foi possível ativar push da loja:', err);
  }
}

// ============================================================
// INICIALIZAÇÃO DO PAINEL
// ============================================================
async function iniciarPainel() {
  document.getElementById('painelLojaNome').textContent = LOJA.nome + (LOJAS_DO_USUARIO.length > 1 ? ' ▾' : '');
  document.getElementById('sidebarLojaNome').textContent = LOJA.nome;
  atualizarSwitchLoja();

  await carregarCategorias();
  await carregarProdutos();
  await carregarRaiosEntrega();
  await carregarEntregadores();
  await carregarCredenciaisIfood();
  await carregarPedidos();
  await carregarContagemClientes();
  await carregarHistoricoVendas();
  renderDashboard();
  renderKanban();
  renderCardapioAdmin();
  renderRaiosEntrega();
  renderDadosLoja();
  renderCredenciaisIfood();

  // Realtime: qualquer novo pedido ou mudança de status atualiza o kanban
  PEDIDOS_CHANNEL_ATIVO = sb.channel('painel-pedidos-' + LOJA.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${LOJA.id}` },
      () => carregarPedidos()
        .then(() => Promise.all([carregarContagemClientes(), carregarHistoricoVendas()]))
        .then(() => { renderKanban(); renderDashboard(); }))
    .subscribe();

  ativarPushDaLoja();
}

function atualizarSwitchLoja() {
  const aberta = LOJA.aberto && !LOJA.pausado_manualmente;
  document.getElementById('switchLoja').className = 'switch' + (aberta ? ' on' : '');
  document.getElementById('statusLojaTexto').textContent = aberta ? 'Aberto' : 'Fechado';
  const btnPausar = document.getElementById('btnPausarKanban');
  if (btnPausar) {
    btnPausar.textContent = LOJA.pausado_manualmente ? '▶ Retomar pedidos' : '⏸ Pausar loja';
    btnPausar.classList.toggle('pausado', !!LOJA.pausado_manualmente);
  }
}

async function alternarAberto() {
  LOJA.pausado_manualmente = !LOJA.pausado_manualmente;
  atualizarSwitchLoja();
  await sb.from('estabelecimentos').update({ pausado_manualmente: LOJA.pausado_manualmente }).eq('id', LOJA.id);
}

// ============================================================
// NAVEGAÇÃO ENTRE ABAS
// ============================================================
function mudarView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('ativa'));
  document.getElementById(id).classList.add('ativa');
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('ativa', b.dataset.view === id));
  document.getElementById('fabProduto').classList.toggle('hide', id !== 'viewCardapio');
  if (id === 'viewEntregas') ativarViewEntregas();
  if (id === 'viewEntregadores') ativarViewEntregadores();
}

function abrirOverlay(id) { document.getElementById(id).classList.remove('hide'); }
function fecharOverlay(id) { document.getElementById(id).classList.add('hide'); }

// ============================================================
// PEDIDOS / KANBAN
// ============================================================
async function carregarPedidos() {
  const hojeInicio = new Date(); hojeInicio.setHours(0, 0, 0, 0);
  const { data } = await sb.from('pedidos')
    .select('*, clientes(nome, whatsapp), enderecos(*), itens_pedido(*, item_adicionais(*), item_pedido_ingredientes(*))')
    .eq('estabelecimento_id', LOJA.id)
    .gte('criado_em', hojeInicio.toISOString())
    .order('criado_em', { ascending: false });
  PEDIDOS = data || [];
}

// Conta quantos pedidos (histórico completo, não só hoje) cada cliente já
// fez nesta loja, pra poder marcar "Cliente novo" / "Segundo pedido" no card.
let CONTAGEM_CLIENTES = {};
async function carregarContagemClientes() {
  const ids = [...new Set(PEDIDOS.map(p => p.cliente_id))];
  CONTAGEM_CLIENTES = {};
  if (!ids.length) return;
  const { data } = await sb.from('pedidos').select('cliente_id').eq('estabelecimento_id', LOJA.id).in('cliente_id', ids);
  (data || []).forEach(p => { CONTAGEM_CLIENTES[p.cliente_id] = (CONTAGEM_CLIENTES[p.cliente_id] || 0) + 1; });
}

const KANBAN_COLUNAS = [
  { id: 'novos', titulo: 'Novos', cor: 'recebido', filtro: p => p.status === 'recebido' },
  { id: 'preparando', titulo: 'Preparando', cor: 'preparando', filtro: p => p.status === 'aceito' || p.status === 'preparando' },
  { id: 'pronto', titulo: 'Prontos', cor: 'pronto', filtro: p => p.status === 'pronto' },
  { id: 'entrega', titulo: 'Em entrega', cor: 'entrega', filtro: p => p.status === 'saiu_entrega' },
  { id: 'finalizados', titulo: 'Finalizados hoje', cor: 'finalizados', filtro: p => p.status === 'entregue' || p.status === 'cancelado' || p.status === 'recusado' },
];

function renderKanban() {
  const termo = (document.getElementById('kanbanBusca')?.value || '').trim().toLowerCase();
  const pedidosFiltrados = termo
    ? PEDIDOS.filter(p =>
        String(p.numero).toLowerCase().includes(termo) ||
        (p.clientes?.nome || '').toLowerCase().includes(termo) ||
        (p.clientes?.whatsapp || '').toLowerCase().includes(termo))
    : PEDIDOS;

  document.getElementById('colunasKanban').innerHTML = KANBAN_COLUNAS.map(col => {
    let pedidosCol = pedidosFiltrados.filter(col.filtro);
    if (col.id === 'finalizados') pedidosCol = pedidosCol.slice(0, 10);
    return `<div class="kanban-coluna">${renderColunaHTML(col, pedidosCol)}</div>`;
  }).join('');
}

function renderColunaHTML(coluna, pedidos) {
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  const cabecalho = `
    <div class="kanban-col-header cor-${coluna.cor}">
      <span>${coluna.titulo} <span class="contagem">${pedidos.length}</span></span>
      <span class="total">${fmt(total)}</span>
    </div>`;
  const corpo = pedidos.length ? pedidos.map(p => pedidoCardHTML(p, coluna.cor)).join('') : vazio();
  return cabecalho + corpo;
}

function vazio() { return `<div class="empty-state">Nada por aqui.</div>`; }

const STATUS_LABEL = {
  recebido: 'Novo', aceito: 'Aceito', preparando: 'Preparando', pronto: 'Pronto',
  saiu_entrega: 'Em entrega', entregue: 'Entregue', recusado: 'Recusado', cancelado: 'Cancelado'
};

// Pra cada status "ativo", qual é o próximo passo (label do botão + status alvo).
// 'pronto' depende do tipo de entrega, por isso é resolvido à parte.
const STATUS_AVANCAR = {
  recebido: { label: 'Aceitar', novoStatus: 'aceito' },
  aceito: { label: 'Iniciar preparo', novoStatus: 'preparando' },
  preparando: { label: 'Pronto', novoStatus: 'pronto' },
  saiu_entrega: { label: 'Finalizar', novoStatus: 'entregue' },
};

function pedidoCardHTML(p, corClasse) {
  const hora = new Date(p.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const pedidosDoCliente = CONTAGEM_CLIENTES[p.cliente_id] || 1;
  const tagCliente = pedidosDoCliente === 1 ? '<span class="tag-cliente">Cliente novo</span>'
    : pedidosDoCliente === 2 ? '<span class="tag-cliente">Segundo pedido</span>' : '';
  const finalizado = p.status === 'entregue' || p.status === 'cancelado' || p.status === 'recusado';
  const tagCobrar = !finalizado ? '<span class="tag-cobrar">A cobrar</span>' : '';
  const pagamentoTxt = textoFormaPagamento(p, true);

  let acoesHTML = '';
  if (!finalizado) {
    const avancar = p.status === 'pronto'
      ? (p.tipo_entrega === 'entrega' ? { label: 'Saiu p/ entrega', novoStatus: 'saiu_entrega' } : { label: 'Cliente retirou', novoStatus: 'entregue' })
      : STATUS_AVANCAR[p.status];
    const botaoRecusar = p.status === 'recebido'
      ? `<button class="btn-card-recusar" onclick="event.stopPropagation(); recusarPedido('${p.id}')">Recusar</button>` : '';
    const botaoAvancar = avancar
      ? `<button class="btn-card-avancar" onclick="event.stopPropagation(); atualizarStatus('${p.id}', '${avancar.novoStatus}')">${avancar.label}</button>` : '';
    if (botaoRecusar || botaoAvancar) acoesHTML = `<div class="pedido-card-acoes">${botaoRecusar}${botaoAvancar}</div>`;
  }
  const botaoImprimir = `<button class="btn-card-imprimir" onclick="event.stopPropagation(); imprimirComanda('${p.id}')">${icon('printer', 14)} Comanda</button>`;
  const linkMapa = p.tipo_entrega === 'entrega' && p.enderecos
    ? `<button class="btn-card-mapa" title="Ver no mapa" onclick="event.stopPropagation(); abrirNoMapa('${p.id}')">${icon('mapPin', 15)}</button>` : '';

  return `
    <div class="pedido-card cor-${corClasse}" onclick="abrirPedido('${p.id}')">
      <div class="linha1"><span>#${p.numero}</span><span>${fmt(p.total)}</span></div>
      <div class="linha2">${hora} • ${p.clientes?.nome || 'Cliente'} • ${p.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}</div>
      <div class="linha3">${pagamentoTxt} · ${p.itens_pedido?.length || 0} ${p.itens_pedido?.length === 1 ? 'item' : 'itens'}</div>
      <div class="linha-tags">${tagCliente}${tagCobrar}</div>
      ${acoesHTML}
      <div class="pedido-card-acoes">${linkMapa}${botaoImprimir}</div>
    </div>`;
}

function abrirNoMapa(id) {
  const p = PEDIDOS.find(x => x.id === id);
  if (!p?.enderecos) return;
  const e = p.enderecos;
  const endereco = `${e.rua}, ${e.numero} - ${e.bairro}`;
  window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(endereco), '_blank');
}

function abrirPedido(id) {
  const p = PEDIDOS.find(x => x.id === id);
  if (!p) return;
  PEDIDO_SELECIONADO = p;
  renderPedidoDetalhe(p);
  abrirOverlay('overlayPedido');
}

async function atribuirEntregador(pedidoId, entregadorId) {
  await sb.from('pedidos').update({ entregador_id: entregadorId || null }).eq('id', pedidoId);
  const p = PEDIDOS.find(x => x.id === pedidoId);
  if (p) p.entregador_id = entregadorId || null;
}

// Se o modal do pedido estiver aberto quando a lista de entregadores mudar
// (cadastro/desativação), atualiza as opções do seletor sem fechar o modal.
function atualizarSeletorEntregadorPedido() {
  const sel = document.getElementById('selEntregadorPedido');
  if (!sel || !PEDIDO_SELECIONADO) return;
  renderPedidoDetalhe(PEDIDO_SELECIONADO);
}

function renderPedidoDetalhe(p) {
  const itensHTML = (p.itens_pedido || []).map(i => `
    <div class="item-detalhe">
      <div>${i.quantidade}x ${i.nome_produto} — ${fmt(i.subtotal)}</div>
      ${(i.item_adicionais || []).length ? `<small>+ ${i.item_adicionais.map(a => a.nome).join(', ')}</small>` : ''}
      ${ingredientesResumoHTML(i)}
      ${i.observacao ? `<small>Obs: ${i.observacao}</small>` : ''}
    </div>`).join('');

  const enderecoTxt = p.tipo_entrega === 'entrega' && p.enderecos
    ? `${p.enderecos.rua}, ${p.enderecos.numero} — ${p.enderecos.bairro}${p.enderecos.complemento ? ' (' + p.enderecos.complemento + ')' : ''}`
    : 'Retirada no local';

  const opcoesEntregador = ENTREGADORES
    .filter(e => e.disponivel || e.id === p.entregador_id)
    .map(e => `<option value="${e.id}" ${p.entregador_id === e.id ? 'selected' : ''}>${e.nome}${!e.disponivel ? ' (indisponível)' : ''}</option>`).join('');
  const seletorEntregadorHTML = p.tipo_entrega === 'entrega' ? `
    <div class="campo" style="margin-top:10px;">
      <label>Entregador</label>
      <select id="selEntregadorPedido" onchange="atribuirEntregador('${p.id}', this.value)">
        <option value="">Sem entregador atribuído</option>${opcoesEntregador}
      </select>
    </div>` : '';

  let acoesHTML = '';
  if (p.status === 'recebido') {
    acoesHTML = `<div class="btn-row">
      <button class="btn-aceitar" onclick="atualizarStatus('${p.id}','aceito')">Aceitar pedido</button>
      <button class="btn-recusar" onclick="recusarPedido('${p.id}')">Recusar</button>
    </div>`;
  } else if (p.status === 'aceito') {
    acoesHTML = `<button class="btn-acao" onclick="atualizarStatus('${p.id}','preparando')">Iniciar preparo</button>`;
  } else if (p.status === 'preparando') {
    acoesHTML = `<button class="btn-acao" onclick="atualizarStatus('${p.id}','pronto')">Pedido pronto</button>`;
  } else if (p.status === 'pronto') {
    acoesHTML = p.tipo_entrega === 'entrega'
      ? `<button class="btn-acao" onclick="atualizarStatus('${p.id}','saiu_entrega')">Saiu para entrega</button>`
      : `<button class="btn-acao" onclick="atualizarStatus('${p.id}','entregue')">Cliente retirou</button>`;
  } else if (p.status === 'saiu_entrega') {
    acoesHTML = `<button class="btn-acao" onclick="atualizarStatus('${p.id}','entregue')">Finalizar pedido</button>`;
  }

  document.getElementById('pedidoDetalheConteudo').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:2px;">Pedido #${p.numero}</h2>
    <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">${STATUS_LABEL[p.status]}</p>
    <div class="linha-detalhe"><span>Cliente</span><span>${p.clientes?.nome || '—'}</span></div>
    <div class="linha-detalhe"><span>Telefone</span><span>${p.clientes?.whatsapp || '—'}</span></div>
    <div class="linha-detalhe"><span>Endereço</span><span style="text-align:right;max-width:60%;">${enderecoTxt}
      ${p.tipo_entrega === 'entrega' && p.enderecos ? ` <button class="btn-card-mapa" style="display:inline-flex;width:28px;height:22px;flex:none;padding:0;vertical-align:middle;" onclick="abrirNoMapa('${p.id}')">${icon('mapPin', 14)}</button>` : ''}</span></div>
    <div class="linha-detalhe"><span>Pagamento</span><span>${textoFormaPagamento(p)}</span></div>
    <h3 style="font-size:13.5px;margin:14px 0 6px;">Itens</h3>
    ${itensHTML}
    <div class="linha-detalhe" style="margin-top:8px;"><span>Subtotal</span><span>${fmt(p.subtotal)}</span></div>
    <div class="linha-detalhe"><span>Taxa de entrega</span><span>${fmtTaxa(p.taxa_entrega)}</span></div>
    <div class="linha-detalhe" style="font-weight:700;"><span>Total</span><span>${fmt(p.total)}</span></div>
    ${seletorEntregadorHTML}
    ${acoesHTML}
    <button class="btn-secundario" onclick="imprimirComanda('${p.id}')">${icon('printer', 16)} Imprimir comanda</button>
  `;
}

// ============================================================
// IMPRESSÃO DA COMANDA
// ============================================================
function imprimirComanda(id) {
  const p = PEDIDOS.find(x => x.id === id) || PEDIDO_SELECIONADO;
  if (!p) return;

  const itensHTML = (p.itens_pedido || []).map(i => `
    <div class="ic-item"><span>${i.quantidade}x ${i.nome_produto}</span><span>${fmt(i.subtotal)}</span></div>
    ${(i.item_adicionais || []).length ? `<div class="ic-sub">+ ${i.item_adicionais.map(a => a.nome).join(', ')}</div>` : ''}
    ${ingredientesResumoHTML(i, 'div', 'ic-sub')}
    ${i.observacao ? `<div class="ic-sub">Obs: ${i.observacao}</div>` : ''}
  `).join('');

  const enderecoTxt = p.tipo_entrega === 'entrega' && p.enderecos
    ? `${p.enderecos.rua}, ${p.enderecos.numero}${p.enderecos.complemento ? ' - ' + p.enderecos.complemento : ''} — ${p.enderecos.bairro}${p.enderecos.referencia ? ' (Ref: ' + p.enderecos.referencia + ')' : ''}`
    : 'Retirada no local';

  const hora = new Date(p.criado_em).toLocaleString('pt-BR');
  const pagamentoTxt = textoFormaPagamento(p);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pedido #${p.numero}</title>
    <style>
      body{font-family:'Courier New',monospace;width:280px;margin:0 auto;padding:12px;color:#000;}
      h1{font-size:15px;text-align:center;margin:0 0 4px;}
      .ic-center{text-align:center;font-size:11px;margin-bottom:8px;}
      .ic-linha{display:flex;justify-content:space-between;font-size:12px;margin:2px 0;gap:8px;}
      hr{border:none;border-top:1px dashed #000;margin:8px 0;}
      .ic-item{display:flex;justify-content:space-between;font-size:12.5px;font-weight:bold;margin-top:6px;}
      .ic-sub{font-size:11px;padding-left:8px;}
      .ic-total{font-size:14px;font-weight:bold;display:flex;justify-content:space-between;margin-top:6px;}
    </style></head>
    <body>
      <h1>${LOJA.nome}</h1>
      <div class="ic-center">Pedido #${p.numero} — ${hora}</div>
      <hr>
      <div class="ic-linha"><span>Cliente</span><span>${p.clientes?.nome || '—'}</span></div>
      <div class="ic-linha"><span>Telefone</span><span>${p.clientes?.whatsapp || '—'}</span></div>
      <div class="ic-linha"><span>${p.tipo_entrega === 'entrega' ? 'Entrega' : 'Retirada'}</span><span></span></div>
      ${p.tipo_entrega === 'entrega' ? `<div style="font-size:11px;">${enderecoTxt}</div>` : ''}
      <hr>
      ${itensHTML}
      <hr>
      <div class="ic-linha"><span>Subtotal</span><span>${fmt(p.subtotal)}</span></div>
      <div class="ic-linha"><span>Taxa de entrega</span><span>${fmtTaxa(p.taxa_entrega)}</span></div>
      <div class="ic-total"><span>TOTAL</span><span>${fmt(p.total)}</span></div>
      <hr>
      <div class="ic-linha"><span>Pagamento</span><span>${pagamentoTxt}</span></div>
      ${p.observacao_geral ? `<div style="font-size:11px;margin-top:8px;">Obs geral: ${p.observacao_geral}</div>` : ''}
    </body></html>`;

  const janela = window.open('', '_blank', 'width=340,height=600');
  if (!janela) { alert('Permita pop-ups pra imprimir a comanda.'); return; }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  janela.onload = () => janela.print();
}

async function atualizarStatus(id, novoStatus) {
  await sb.from('pedidos').update({ status: novoStatus, atualizado_em: new Date().toISOString() }).eq('id', id);
  fecharOverlay('overlayPedido');
  await carregarPedidos();
  renderKanban();
  renderDashboard();
}

async function recusarPedido(id) {
  const motivo = prompt('Motivo da recusa (item indisponível, loja fechando, endereço fora da área, outro):');
  if (motivo === null) return;
  await sb.from('pedidos').update({ status: 'recusado', motivo_recusa: motivo }).eq('id', id);
  fecharOverlay('overlayPedido');
  await carregarPedidos();
  renderKanban();
}

// ============================================================
// DASHBOARD
// ============================================================
let HISTORICO_PEDIDOS = [];
let CHART_VENDAS = null, CHART_MAISVENDIDOS = null, CHART_ORIGEM = null;
const PALETA_DONUT = ['#FF5A36', '#2E8B57', '#2563EB', '#D97706', '#8B5CF6'];

// Busca os pedidos dos últimos 14 dias (só os campos usados no gráfico
// "Vendas por dia"), pra poder comparar a semana atual com a anterior.
async function carregarHistoricoVendas() {
  const inicio = new Date(); inicio.setDate(inicio.getDate() - 13); inicio.setHours(0, 0, 0, 0);
  const { data } = await sb.from('pedidos')
    .select('total, criado_em, status')
    .eq('estabelecimento_id', LOJA.id)
    .gte('criado_em', inicio.toISOString());
  HISTORICO_PEDIDOS = data || [];
}

function renderDashboard() {
  const validos = PEDIDOS.filter(p => p.status !== 'cancelado' && p.status !== 'recusado');
  const vendas = validos.reduce((s, p) => s + Number(p.total), 0);
  const cancelados = PEDIDOS.filter(p => p.status === 'cancelado' || p.status === 'recusado').length;

  document.getElementById('statPedidosHoje').textContent = PEDIDOS.length;
  document.getElementById('statVendasHoje').textContent = fmt(vendas);
  document.getElementById('statTicketMedio').textContent = fmt(validos.length ? vendas / validos.length : 0);
  document.getElementById('statCancelados').textContent = cancelados;

  const contagem = {};
  PEDIDOS.forEach(p => (p.itens_pedido || []).forEach(i => {
    contagem[i.nome_produto] = (contagem[i.nome_produto] || 0) + i.quantidade;
  }));
  const ranking = Object.entries(contagem).sort((a, b) => b[1] - a[1]).slice(0, 5);

  renderGraficoVendasPorDia();
  renderGraficoMaisVendidos(ranking);
  renderGraficoOrigem(validos);
}

function renderGraficoVendasPorDia() {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const labels = [];
  const semanaAtual = new Array(7).fill(0);
  const semanaPassada = new Array(7).fill(0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje); d.setDate(d.getDate() - i);
    labels.push(diasSemana[d.getDay()]);
  }
  HISTORICO_PEDIDOS.forEach(p => {
    if (p.status === 'cancelado' || p.status === 'recusado') return;
    const data = new Date(p.criado_em); data.setHours(0, 0, 0, 0);
    const diffDias = Math.round((hoje - data) / 86400000);
    if (diffDias >= 0 && diffDias <= 6) semanaAtual[6 - diffDias] += Number(p.total);
    else if (diffDias >= 7 && diffDias <= 13) semanaPassada[13 - diffDias] += Number(p.total);
  });

  if (CHART_VENDAS) CHART_VENDAS.destroy();
  CHART_VENDAS = new Chart(document.getElementById('graficoVendasDia'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Esta semana', data: semanaAtual, backgroundColor: '#FF5A36', borderRadius: 6, maxBarThickness: 28 },
        { label: 'Semana passada', data: semanaPassada, backgroundColor: '#E7E3D8', borderRadius: 6, maxBarThickness: 28 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderGraficoMaisVendidos(ranking) {
  const canvas = document.getElementById('graficoMaisVendidos');
  const legenda = document.getElementById('legendaMaisVendidos');
  if (CHART_MAISVENDIDOS) CHART_MAISVENDIDOS.destroy();

  if (!ranking.length) {
    legenda.innerHTML = `<div class="empty-state">Ainda sem vendas hoje.</div>`;
    return;
  }

  const labels = ranking.map(([nome]) => nome);
  const dados = ranking.map(([, qtd]) => qtd);
  CHART_MAISVENDIDOS = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: dados, backgroundColor: PALETA_DONUT, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
  });
  legenda.innerHTML = labels.map((nome, i) => `
    <div class="legenda-item"><span><span class="legenda-dot" style="background:${PALETA_DONUT[i % PALETA_DONUT.length]}"></span>${nome}</span><span>${dados[i]}</span></div>
  `).join('');
}

function renderGraficoOrigem(validos) {
  const canvas = document.getElementById('graficoOrigem');
  const legenda = document.getElementById('legendaOrigem');
  if (CHART_ORIGEM) CHART_ORIGEM.destroy();

  const entrega = validos.filter(p => p.tipo_entrega === 'entrega').reduce((s, p) => s + Number(p.total), 0);
  const retirada = validos.filter(p => p.tipo_entrega === 'retirada').reduce((s, p) => s + Number(p.total), 0);

  if (!entrega && !retirada) {
    legenda.innerHTML = `<div class="empty-state">Ainda sem vendas hoje.</div>`;
    return;
  }

  CHART_ORIGEM = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Entrega', 'Retirada'],
      datasets: [{ data: [entrega, retirada], backgroundColor: ['#FF5A36', '#2E8B57'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
  });
  legenda.innerHTML = `
    <div class="legenda-item"><span><span class="legenda-dot" style="background:#FF5A36"></span>Entrega</span><span>${fmt(entrega)}</span></div>
    <div class="legenda-item"><span><span class="legenda-dot" style="background:#2E8B57"></span>Retirada</span><span>${fmt(retirada)}</span></div>
  `;
}

// ============================================================
// CARDÁPIO (produtos + categorias)
// ============================================================
async function carregarCategorias() {
  const { data } = await sb.from('categorias').select('*').eq('estabelecimento_id', LOJA.id).order('ordem');
  CATEGORIAS = data || [];
}

async function carregarProdutos() {
  const { data } = await sb.from('produtos').select('*, adicionais(*), grupos_ingredientes(*, ingredientes(*))').eq('estabelecimento_id', LOJA.id).order('ordem');
  PRODUTOS = data || [];
}

function renderCardapioAdmin() {
  const cont = document.getElementById('listaProdutosAdmin');
  const produtosAtivos = PRODUTOS.filter(p => p.ativo);
  if (!produtosAtivos.length) { cont.innerHTML = `<div class="empty-state">Nenhum produto cadastrado. Toque em + para adicionar.</div>`; return; }
  cont.innerHTML = produtosAtivos.map(p => `
    <div class="produto-linha">
      <div onclick="abrirFormProduto('${p.id}')" style="flex:1;">
        <h4>${p.nome}</h4>
        <small>${fmt(p.preco)} ${p.esgotado ? '· esgotado' : ''}</small>
      </div>
      <span class="chip ${p.ativo && p.disponivel_hoje && !p.esgotado ? 'on' : 'off'}" onclick="toggleDisponibilidade('${p.id}')">
        ${p.esgotado ? 'Esgotado' : p.disponivel_hoje ? 'Disponível' : 'Indisponível'}
      </span>
    </div>`).join('');
}

async function toggleDisponibilidade(id) {
  const p = PRODUTOS.find(x => x.id === id);
  const novoValor = !p.disponivel_hoje;
  await sb.from('produtos').update({ disponivel_hoje: novoValor }).eq('id', id);
  p.disponivel_hoje = novoValor;
  renderCardapioAdmin();
}

let FOTO_SELECIONADA = null; // arquivo escolhido, aguardando upload ao salvar
let GRUPOS_INGREDIENTES_FORM = [];

function abrirFormProduto(id = null) {
  FOTO_SELECIONADA = null;
  const p = id ? PRODUTOS.find(x => x.id === id) : null;
  GRUPOS_INGREDIENTES_FORM = p ? (p.grupos_ingredientes || []).map(g => ({
    nome: g.nome, limite_escolha: g.limite_escolha,
    ingredientes: (g.ingredientes || []).map(i => ({ nome: i.nome, incluido_padrao: i.incluido_padrao }))
  })) : [];
  const categoriaAtual = p ? (CATEGORIAS.find(c => c.id === p.categoria_id)?.nome || '') : '';
  const opcoesCategoria = CATEGORIAS.map(c => `<option value="${c.nome}">`).join('');

  document.getElementById('produtoFormConteudo').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:14px;">${p ? 'Editar produto' : 'Novo produto'}</h2>

    <div class="campo">
      <label>Foto do produto</label>
      <div id="previewFoto" style="width:100%;height:140px;border-radius:14px;background:var(--card);border:1px solid var(--line);
        display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:8px;color:var(--muted);font-size:12px;">
        ${p?.foto_url ? `<img src="${p.foto_url}" style="width:100%;height:100%;object-fit:cover;">` : 'Sem foto ainda'}
      </div>
      <input type="file" id="fFotoArquivo" accept="image/*" onchange="previsualizarFoto(event)">
    </div>

    <div class="campo"><label>Nome</label><input id="fNome" value="${p?.nome || ''}"></div>
    <div class="campo"><label>Descrição</label><textarea id="fDesc" rows="2">${p?.descricao || ''}</textarea></div>
    <div class="campo">
      <label>Categoria</label>
      <input id="fCategoria" list="listaCategorias" value="${categoriaAtual}" placeholder="Escolha ou digite uma nova categoria">
      <datalist id="listaCategorias">${opcoesCategoria}</datalist>
    </div>
    <div class="campo"><label>Preço (R$)</label><input id="fPreco" type="number" step="0.01" value="${p?.preco || ''}"></div>
    <div class="campo"><label>Preço promocional (opcional)</label><input id="fPrecoPromo" type="number" step="0.01" value="${p?.preco_promocional || ''}"></div>

    <div class="campo">
      <label>Categorias de ingredientes/complementos (ex: Coberturas, Molhos, Recheios, Bordas — cada uma pode ter um limite de escolha, se quiser)</label>
      <div id="listaGruposIngredientes"></div>
      <div class="campo-linha" style="margin-top:8px;">
        <input id="novoGrupoNome" placeholder="Nome da categoria (ex: Coberturas)" style="flex:2;">
        <input id="novoGrupoLimite" type="number" min="1" placeholder="Limite (opcional)" style="flex:1;">
      </div>
      <button type="button" class="btn-secundario" onclick="adicionarGrupoIngrediente()">+ Adicionar categoria</button>
    </div>

    ${p ? `
    <div class="campo"><label>Status</label>
      <select id="fEsgotado">
        <option value="false" ${!p.esgotado ? 'selected' : ''}>Disponível</option>
        <option value="true" ${p.esgotado ? 'selected' : ''}>Esgotado</option>
      </select>
    </div>` : ''}
    <button class="btn-primario" id="btnSalvarProduto" onclick="salvarProduto(${p ? `'${p.id}'` : 'null'}, ${p ? `'${p.foto_url || ''}'` : 'null'})">${p ? 'Salvar alterações' : 'Cadastrar produto'}</button>
    ${p ? `<button class="btn-secundario" onclick="desativarProduto('${p.id}')">Remover do cardápio</button>` : ''}
  `;
  renderGruposIngredientesForm();
  abrirOverlay('overlayProdutoForm');
}

function renderGruposIngredientesForm() {
  const cont = document.getElementById('listaGruposIngredientes');
  cont.innerHTML = GRUPOS_INGREDIENTES_FORM.length ? GRUPOS_INGREDIENTES_FORM.map((g, gi) => `
    <div class="grupo-ingrediente-card">
      <div class="grupo-ingrediente-header">
        <input type="text" value="${g.nome}" class="grupo-nome-input" onchange="GRUPOS_INGREDIENTES_FORM[${gi}].nome=this.value">
        <label class="grupo-limite-label">Limite
          <input type="number" min="1" value="${g.limite_escolha || ''}" placeholder="sem limite" class="grupo-limite-input"
            onchange="GRUPOS_INGREDIENTES_FORM[${gi}].limite_escolha=this.value?Number(this.value):null">
        </label>
        <button type="button" class="link-remover" style="color:var(--danger);background:none;font-size:11px;margin-left:auto;" onclick="removerGrupoIngrediente(${gi})">remover categoria</button>
      </div>
      ${g.ingredientes.map((ing, ii) => `
        <div class="linha-detalhe">
          <label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" ${ing.incluido_padrao ? 'checked' : ''} onchange="GRUPOS_INGREDIENTES_FORM[${gi}].ingredientes[${ii}].incluido_padrao=this.checked"> ${ing.nome}</label>
          <button type="button" class="link-remover" style="color:var(--danger);background:none;font-size:11px;" onclick="removerIngredienteDoGrupo(${gi}, ${ii})">remover</button>
        </div>
      `).join('') || `<p style="font-size:11.5px;color:var(--muted);margin:4px 0;">Nenhum ingrediente nessa categoria ainda.</p>`}
      <div class="campo-linha" style="margin-top:8px;align-items:center;">
        <input id="novoIngNome_${gi}" placeholder="Nome do ingrediente" style="flex:1;">
        <label class="campo-checkbox" style="margin:0;white-space:nowrap;"><input type="checkbox" id="novoIngIncluido_${gi}" checked> Incluso</label>
      </div>
      <button type="button" class="btn-secundario" style="margin-top:6px;" onclick="adicionarIngredienteAoGrupo(${gi})">+ Ingrediente</button>
    </div>
  `).join('') : `<p style="font-size:12px;color:var(--muted);">Nenhuma categoria cadastrada ainda.</p>`;
}

function adicionarGrupoIngrediente() {
  const nome = document.getElementById('novoGrupoNome').value.trim();
  if (!nome) return;
  const limiteStr = document.getElementById('novoGrupoLimite').value;
  const limite = limiteStr ? Number(limiteStr) : null;
  GRUPOS_INGREDIENTES_FORM.push({ nome, limite_escolha: limite, ingredientes: [] });
  document.getElementById('novoGrupoNome').value = '';
  document.getElementById('novoGrupoLimite').value = '';
  renderGruposIngredientesForm();
}

function removerGrupoIngrediente(gi) {
  GRUPOS_INGREDIENTES_FORM.splice(gi, 1);
  renderGruposIngredientesForm();
}

function adicionarIngredienteAoGrupo(gi) {
  const input = document.getElementById(`novoIngNome_${gi}`);
  const nome = input.value.trim();
  if (!nome) return;
  const incluidoPadrao = document.getElementById(`novoIngIncluido_${gi}`).checked;
  GRUPOS_INGREDIENTES_FORM[gi].ingredientes.push({ nome, incluido_padrao: incluidoPadrao });
  renderGruposIngredientesForm();
}

function removerIngredienteDoGrupo(gi, ii) {
  GRUPOS_INGREDIENTES_FORM[gi].ingredientes.splice(ii, 1);
  renderGruposIngredientesForm();
}

function previsualizarFoto(event) {
  const arquivo = event.target.files[0];
  if (!arquivo) return;
  if (arquivo.size > 5 * 1024 * 1024) { alert('A imagem deve ter até 5MB.'); event.target.value = ''; return; }
  FOTO_SELECIONADA = arquivo;
  document.getElementById('previewFoto').innerHTML = `<img src="${URL.createObjectURL(arquivo)}" style="width:100%;height:100%;object-fit:cover;">`;
}

// Sobe a foto para o Supabase Storage (bucket "produtos", pasta por loja)
// e devolve a URL pública para salvar em produtos.foto_url
async function enviarFotoParaStorage(arquivo) {
  const extensao = arquivo.name.split('.').pop();
  const caminho = `${LOJA.id}/${crypto.randomUUID()}.${extensao}`;
  const { error } = await sb.storage.from('produtos').upload(caminho, arquivo, { upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from('produtos').getPublicUrl(caminho);
  return data.publicUrl;
}

// Recebe o nome digitado no campo de categoria: acha a categoria existente
// (comparação sem diferenciar maiúsculas) ou cria uma nova na hora.
async function resolverCategoriaId(nomeDigitado) {
  const nome = nomeDigitado.trim();
  if (!nome) return null;
  const existente = CATEGORIAS.find(c => c.nome.toLowerCase() === nome.toLowerCase());
  if (existente) return existente.id;

  const ordem = CATEGORIAS.length ? Math.max(...CATEGORIAS.map(c => c.ordem)) + 1 : 0;
  const { data, error } = await sb.from('categorias')
    .insert({ estabelecimento_id: LOJA.id, nome, ordem })
    .select().single();
  if (error) throw error;
  CATEGORIAS.push(data);
  return data.id;
}

async function salvarProduto(id, fotoAtualUrl) {
  const btn = document.getElementById('btnSalvarProduto');
  btn.disabled = true;
  const textoOriginal = btn.textContent;

  try {
    let fotoUrl = fotoAtualUrl || null;
    if (FOTO_SELECIONADA) {
      btn.textContent = 'Enviando foto…';
      fotoUrl = await enviarFotoParaStorage(FOTO_SELECIONADA);
    }

    const categoriaId = await resolverCategoriaId(document.getElementById('fCategoria').value);

    const payload = {
      estabelecimento_id: LOJA.id,
      nome: document.getElementById('fNome').value.trim(),
      descricao: document.getElementById('fDesc').value.trim(),
      categoria_id: categoriaId,
      preco: Number(document.getElementById('fPreco').value),
      preco_promocional: document.getElementById('fPrecoPromo').value ? Number(document.getElementById('fPrecoPromo').value) : null,
      foto_url: fotoUrl,
    };
    if (!payload.nome || !payload.preco) { alert('Preencha nome e preço.'); btn.disabled = false; btn.textContent = textoOriginal; return; }

    let produtoId = id;
    if (id) {
      payload.esgotado = document.getElementById('fEsgotado').value === 'true';
      await sb.from('produtos').update(payload).eq('id', id);
    } else {
      const { data: novoProduto, error: erroProduto } = await sb.from('produtos').insert(payload).select().single();
      if (erroProduto) throw erroProduto;
      produtoId = novoProduto.id;
    }

    // Sincroniza categorias de ingredientes: apaga as antigas (o cascade
    // já leva os ingredientes junto) e recria com a lista atual
    await sb.from('grupos_ingredientes').delete().eq('produto_id', produtoId);
    for (let gi = 0; gi < GRUPOS_INGREDIENTES_FORM.length; gi++) {
      const g = GRUPOS_INGREDIENTES_FORM[gi];
      const { data: novoGrupo, error: erroGrupo } = await sb.from('grupos_ingredientes')
        .insert({ produto_id: produtoId, nome: g.nome, limite_escolha: g.limite_escolha, ordem: gi })
        .select().single();
      if (erroGrupo) throw erroGrupo;
      if (g.ingredientes.length) {
        await sb.from('ingredientes').insert(
          g.ingredientes.map((ing, ii) => ({ grupo_id: novoGrupo.id, nome: ing.nome, incluido_padrao: ing.incluido_padrao, ordem: ii }))
        );
      }
    }

    fecharOverlay('overlayProdutoForm');
    await carregarProdutos();
    renderCardapioAdmin();
  } catch (err) {
    console.error(err);
    alert('Não foi possível salvar o produto. Tente novamente.');
    btn.disabled = false; btn.textContent = textoOriginal;
  }
}

async function desativarProduto(id) {
  if (!confirm('Remover este produto do cardápio?')) return;
  await sb.from('produtos').update({ ativo: false }).eq('id', id);
  fecharOverlay('overlayProdutoForm');
  await carregarProdutos();
  renderCardapioAdmin();
}

// ============================================================
// DADOS DA LOJA
// ============================================================
let LOGO_SELECIONADO = null;

function renderDadosLoja() {
  document.getElementById('cfgNome').value = LOJA.nome;
  document.getElementById('cfgWhatsapp').value = LOJA.whatsapp || '';
  document.getElementById('cfgTempoMin').value = LOJA.tempo_entrega_min;
  document.getElementById('cfgTempoMax').value = LOJA.tempo_entrega_max;
  document.getElementById('cfgAceitaCartao').checked = !!LOJA.aceita_cartao;
  renderSeletorCores();
  document.getElementById('previewLogoLoja').innerHTML = LOJA.logo_url
    ? `<img src="${LOJA.logo_url}" style="width:100%;height:100%;object-fit:cover;">` : 'Sem foto';
  LOGO_SELECIONADO = null;
  atualizarSidebarLogo();
}

function atualizarSidebarLogo() {
  document.getElementById('sidebarBrandLogo').innerHTML = LOJA.logo_url
    ? `<img src="${LOJA.logo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:9px;">` : icon('utensils', 17);
}

const CORES_CARDAPIO = [
  { nome: 'Laranja', hex: '#FF5A36' },
  { nome: 'Vermelho', hex: '#E23D3D' },
  { nome: 'Roxo', hex: '#8B5CF6' },
  { nome: 'Verde', hex: '#2E8B57' },
  { nome: 'Azul', hex: '#2563EB' },
];
let COR_DESTAQUE_SELECIONADA = null;

function renderSeletorCores() {
  COR_DESTAQUE_SELECIONADA = LOJA.cor_destaque || '#FF5A36';
  document.getElementById('seletorCores').innerHTML = CORES_CARDAPIO.map(c => `
    <button type="button" class="cor-swatch ${c.hex === COR_DESTAQUE_SELECIONADA ? 'ativa' : ''}"
      style="background:${c.hex};" title="${c.nome}" onclick="selecionarCorDestaque('${c.hex}')"></button>
  `).join('');
}

function selecionarCorDestaque(hex) {
  COR_DESTAQUE_SELECIONADA = hex;
  document.querySelectorAll('.cor-swatch').forEach(el => el.classList.toggle('ativa', el.style.backgroundColor === hexParaRgb(hex)));
}

// Os estilos inline viram rgb() no DOM — compara nesse formato
function hexParaRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function previsualizarLogoLoja(event) {
  const arquivo = event.target.files[0];
  if (!arquivo) return;
  if (arquivo.size > 5 * 1024 * 1024) { alert('A imagem deve ter até 5MB.'); event.target.value = ''; return; }
  LOGO_SELECIONADO = arquivo;
  document.getElementById('previewLogoLoja').innerHTML = `<img src="${URL.createObjectURL(arquivo)}" style="width:100%;height:100%;object-fit:cover;">`;
}

async function salvarDadosLoja() {
  const nome = document.getElementById('cfgNome').value.trim();
  const tempoMin = Number(document.getElementById('cfgTempoMin').value);
  const tempoMax = Number(document.getElementById('cfgTempoMax').value);
  if (!nome || !tempoMin || !tempoMax) return alert('Preencha nome e tempo de entrega.');
  if (tempoMin > tempoMax) return alert('O tempo mínimo não pode ser maior que o máximo.');

  const btn = document.getElementById('btnSalvarDadosLoja');
  const textoOriginal = btn.textContent;
  btn.disabled = true;

  try {
    let logoUrl = LOJA.logo_url || null;
    if (LOGO_SELECIONADO) {
      btn.textContent = 'Enviando foto…';
      logoUrl = await enviarFotoParaStorage(LOGO_SELECIONADO);
    }

    const whatsapp = document.getElementById('cfgWhatsapp').value.replace(/\D/g, '') || null;
    const aceitaCartao = document.getElementById('cfgAceitaCartao').checked;
    const corDestaque = COR_DESTAQUE_SELECIONADA || '#FF5A36';

    await sb.from('estabelecimentos')
      .update({ nome, tempo_entrega_min: tempoMin, tempo_entrega_max: tempoMax, logo_url: logoUrl, whatsapp, aceita_cartao: aceitaCartao, cor_destaque: corDestaque })
      .eq('id', LOJA.id);

    LOJA.nome = nome;
    LOJA.tempo_entrega_min = tempoMin;
    LOJA.tempo_entrega_max = tempoMax;
    LOJA.logo_url = logoUrl;
    LOJA.whatsapp = whatsapp;
    LOJA.aceita_cartao = aceitaCartao;
    LOJA.cor_destaque = corDestaque;
    LOGO_SELECIONADO = null;
    document.getElementById('painelLojaNome').textContent = LOJA.nome + (LOJAS_DO_USUARIO.length > 1 ? ' ▾' : '');
    document.getElementById('sidebarLojaNome').textContent = LOJA.nome;
    atualizarSidebarLogo();
    alert('Dados da loja atualizados!');
  } catch (err) {
    console.error(err);
    alert('Não foi possível salvar. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ============================================================
// IFOOD — Fase 1: só armazenamento seguro da chave (client_id/secret).
// A tabela ifood_credenciais só é visível pro dono autenticado da loja
// (RLS), nunca pro anon — veja migracao_v11.sql.
// ============================================================
let IFOOD_CREDENCIAIS = null;

async function carregarCredenciaisIfood() {
  const { data, error } = await sb.from('ifood_credenciais').select('*').eq('estabelecimento_id', LOJA.id).maybeSingle();
  if (error) { console.error('Erro ao carregar credenciais do iFood:', error); return; }
  IFOOD_CREDENCIAIS = data;
}

function renderCredenciaisIfood() {
  const status = document.getElementById('ifoodStatusTexto');
  if (!status) return;
  document.getElementById('ifoodClientId').value = IFOOD_CREDENCIAIS?.client_id || '';
  if (IFOOD_CREDENCIAIS) {
    const ultimos4 = IFOOD_CREDENCIAIS.client_secret.slice(-4);
    status.textContent = `Configurado — Client Secret salvo terminando em ****${ultimos4}`;
    status.style.color = 'var(--success)';
  } else {
    status.textContent = 'Ainda não configurado.';
    status.style.color = 'var(--muted)';
  }
}

async function salvarCredenciaisIfood() {
  const clientId = document.getElementById('ifoodClientId').value.trim();
  const clientSecret = document.getElementById('ifoodClientSecret').value.trim();
  if (!clientId) return alert('Preencha o Client ID.');
  if (!clientSecret && !IFOOD_CREDENCIAIS) return alert('Preencha o Client Secret.');

  const btn = document.getElementById('btnSalvarIfood');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    const dados = { estabelecimento_id: LOJA.id, client_id: clientId, atualizado_em: new Date().toISOString() };
    if (clientSecret) dados.client_secret = clientSecret;
    else dados.client_secret = IFOOD_CREDENCIAIS.client_secret; // mantém o segredo atual se o campo ficou em branco

    const { error } = await sb.from('ifood_credenciais').upsert(dados, { onConflict: 'estabelecimento_id' });
    if (error) throw error;

    await carregarCredenciaisIfood();
    document.getElementById('ifoodClientSecret').value = '';
    renderCredenciaisIfood();
    alert('Credenciais do iFood salvas!');
  } catch (err) {
    console.error(err);
    alert('Não foi possível salvar. Tente novamente.');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ============================================================
// ENTREGAS — raio de distância (substitui taxa por bairro)
// ============================================================
let MAPA_ENTREGAS = null;
let MARCADOR_LOJA = null;
let CIRCULOS_RAIOS = [];
const CENTRO_MAPA_PADRAO = [-15.7801, -47.9292]; // fallback neutro (Brasília) se não houver local salvo nem geolocalização

// Ícone do marcador do entregador no mapa (Font Awesome) — muda conforme
// o veículo cadastrado.
function iconeEntregador(veiculo) {
  const classeIcone = veiculo === 'bicicleta' ? 'fa-bicycle' : 'fa-motorcycle';
  const cor = veiculo === 'bicicleta' ? '#2E8B57' : '#E23D3D';
  return L.divIcon({
    html: `<div style="background:${cor};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;"><i class="fa-solid ${classeIcone}" style="color:#fff;font-size:15px;"></i></div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

// Ícone da loja no mapa — substitui o pontinho preto liso por um marcador
// no mesmo padrão visual do entregador.
function iconeLoja() {
  const svg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 10 5 4h14l1 6"/><path d="M4 10v9h16v-9"/><path d="M10 19v-5h4v5"/>
  </svg>`;
  return L.divIcon({
    html: `<div style="background:#14251C;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;">${svg}</div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

async function carregarRaiosEntrega() {
  const { data } = await sb.from('raios_entrega').select('*').eq('estabelecimento_id', LOJA.id).order('raio_km');
  RAIOS = data || [];
}

function renderRaiosEntrega() {
  const cont = document.getElementById('listaRaios');
  cont.innerHTML = RAIOS.length ? RAIOS.map(r => `
    <div class="linha-detalhe"><span>Até ${r.raio_km} km</span><span>${fmtTaxa(r.valor)} <button class="link-remover" style="color:var(--danger);background:none;font-size:11px;margin-left:8px;" onclick="removerRaioEntrega('${r.id}')">remover</button></span></div>
  `).join('') : `<div class="empty-state">Nenhum raio cadastrado ainda.</div>`;
  desenharCirculosRaios();
}

async function adicionarRaioEntrega() {
  const raioKm = Number(document.getElementById('novoRaioKm').value);
  const valorStr = document.getElementById('novoRaioValor').value;
  if (!raioKm || raioKm <= 0) return alert('Informe um raio válido em km.');
  if (valorStr === '') return alert('Informe o valor (use 0 para frete grátis).');
  const valor = Number(valorStr);
  if (isNaN(valor) || valor < 0) return alert('Valor inválido.');
  if (RAIOS.some(r => r.raio_km === raioKm)) return alert('Já existe um raio cadastrado com essa distância.');

  await sb.from('raios_entrega').insert({ estabelecimento_id: LOJA.id, raio_km: raioKm, valor });
  document.getElementById('novoRaioKm').value = '';
  document.getElementById('novoRaioValor').value = '';
  await carregarRaiosEntrega();
  renderRaiosEntrega();
}

async function removerRaioEntrega(id) {
  await sb.from('raios_entrega').delete().eq('id', id);
  await carregarRaiosEntrega();
  renderRaiosEntrega();
}

// Leaflet exige que o container tenha tamanho real na tela — se a aba
// Entregas nunca foi aberta, o mapa é criado agora; se já existia (só
// estava escondida por causa da troca de aba), só recalcula o tamanho.
function ativarViewEntregas() {
  if (MAPA_ENTREGAS) { setTimeout(() => MAPA_ENTREGAS.invalidateSize(), 50); return; }
  inicializarMapaEntregas();
}

function inicializarMapaEntregas() {
  const temLocalSalvo = LOJA.latitude != null && LOJA.longitude != null;
  const centro = temLocalSalvo ? [LOJA.latitude, LOJA.longitude] : CENTRO_MAPA_PADRAO;

  MAPA_ENTREGAS = L.map('mapaEntregas').setView(centro, temLocalSalvo ? 14 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(MAPA_ENTREGAS);

  MARCADOR_LOJA = L.marker(centro, { draggable: true }).addTo(MAPA_ENTREGAS);
  MARCADOR_LOJA.on('dragend', desenharCirculosRaios);

  // Sem local salvo ainda: sugere centralizar na localização atual do navegador
  if (!temLocalSalvo && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = [pos.coords.latitude, pos.coords.longitude];
      MAPA_ENTREGAS.setView(c, 15);
      MARCADOR_LOJA.setLatLng(c);
      desenharCirculosRaios();
    }, () => {});
  }

  desenharCirculosRaios();
}

function desenharCirculosRaios() {
  if (!MAPA_ENTREGAS || !MARCADOR_LOJA) return;
  CIRCULOS_RAIOS.forEach(c => MAPA_ENTREGAS.removeLayer(c));
  CIRCULOS_RAIOS = [];
  const centro = MARCADOR_LOJA.getLatLng();
  const cores = ['#2E8B57', '#2563EB', '#D97706', '#FF5A36', '#8B5CF6'];
  [...RAIOS].sort((a, b) => b.raio_km - a.raio_km).forEach((r, i) => {
    const circulo = L.circle(centro, {
      radius: r.raio_km * 1000,
      color: cores[i % cores.length],
      weight: 2,
      fillOpacity: 0.05
    }).addTo(MAPA_ENTREGAS);
    CIRCULOS_RAIOS.push(circulo);
  });
}

async function salvarLocalizacaoLoja() {
  if (!MARCADOR_LOJA) return;
  const { lat, lng } = MARCADOR_LOJA.getLatLng();
  const btn = document.getElementById('btnSalvarLocalLoja');
  btn.disabled = true;
  await sb.from('estabelecimentos').update({ latitude: lat, longitude: lng }).eq('id', LOJA.id);
  LOJA.latitude = lat;
  LOJA.longitude = lng;
  btn.disabled = false;
  alert('Localização da loja salva!');
}

// ============================================================
// ENTREGADORES — cadastro + localização ao vivo
// ============================================================
let ENTREGADORES = [];
let MAPA_ENTREGADORES = null;
let MARCADOR_LOJA_ENTREGADORES = null;
let MARCADORES_ENTREGADORES = {};
let ENTREGADORES_LOC_CHANNEL = null;

async function carregarEntregadores() {
  const { data } = await sb.from('entregadores').select('*').eq('estabelecimento_id', LOJA.id).eq('ativo', true).order('criado_em');
  ENTREGADORES = data || [];
}

function renderEntregadores() {
  const cont = document.getElementById('listaEntregadores');
  cont.innerHTML = ENTREGADORES.length ? ENTREGADORES.map(e => `
    <div class="linha-detalhe">
      <span>${e.nome}${e.telefone ? ' · ' + e.telefone : ''} · ${e.veiculo === 'bicicleta' ? '🚲 Bicicleta' : '🏍️ Moto'}
        <span style="color:${e.disponivel ? 'var(--success)' : '#999'};font-size:11px;font-weight:600;margin-left:6px;">● ${e.disponivel ? 'Disponível' : 'Indisponível'}</span>
      </span>
      <span>PIN: <strong>${e.pin}</strong>
        <button class="link-remover" style="color:var(--danger);background:none;font-size:11px;margin-left:8px;" onclick="removerEntregador('${e.id}')">desativar</button>
      </span>
    </div>
  `).join('') : `<div class="empty-state">Nenhum entregador cadastrado ainda.</div>`;
}

function gerarPinEntregador() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function toggleFormEntregador() {
  const form = document.getElementById('formNovoEntregador');
  const aberto = form.classList.toggle('hide') === false;
  document.getElementById('btnAbrirFormEntregador').textContent = aberto ? 'Cancelar' : '+ Adicionar entregador';
}

async function adicionarEntregador() {
  const nome = document.getElementById('novoEntregadorNome').value.trim();
  const telefone = document.getElementById('novoEntregadorTelefone').value.trim();
  const veiculo = document.getElementById('novoEntregadorVeiculo').value;
  if (!nome) return alert('Preencha o nome do entregador.');
  const pin = gerarPinEntregador();

  const { error } = await sb.from('entregadores').insert({ estabelecimento_id: LOJA.id, nome, telefone: telefone || null, veiculo, pin });
  if (error) { console.error(error); alert('Não foi possível cadastrar. Tente novamente.'); return; }

  document.getElementById('novoEntregadorNome').value = '';
  document.getElementById('novoEntregadorTelefone').value = '';
  document.getElementById('novoEntregadorVeiculo').value = 'moto';
  document.getElementById('formNovoEntregador').classList.add('hide');
  document.getElementById('btnAbrirFormEntregador').textContent = '+ Adicionar entregador';
  await carregarEntregadores();
  renderEntregadores();
  atualizarSeletorEntregadorPedido();
  alert(`Entregador cadastrado! PIN de acesso ao app do entregador: ${pin}`);
}

async function removerEntregador(id) {
  if (!confirm('Desativar este entregador? Ele deixa de aparecer na lista, mas o histórico de entregas dele é mantido.')) return;
  await sb.from('entregadores').update({ ativo: false }).eq('id', id);
  await carregarEntregadores();
  renderEntregadores();
  atualizarSeletorEntregadorPedido();
}

function ativarViewEntregadores() {
  renderEntregadores();
  if (MAPA_ENTREGADORES) { setTimeout(() => MAPA_ENTREGADORES.invalidateSize(), 50); return; }
  inicializarMapaEntregadores();
}

function inicializarMapaEntregadores() {
  const temLocal = LOJA.latitude != null && LOJA.longitude != null;
  const centro = temLocal ? [LOJA.latitude, LOJA.longitude] : CENTRO_MAPA_PADRAO;

  MAPA_ENTREGADORES = L.map('mapaEntregadores').setView(centro, temLocal ? 13 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(MAPA_ENTREGADORES);

  if (temLocal) {
    MARCADOR_LOJA_ENTREGADORES = L.marker(centro, { icon: iconeLoja() })
      .addTo(MAPA_ENTREGADORES).bindPopup('Loja');
  }

  carregarLocalizacoesEntregadores();
  // Reforço além do realtime: se por algum motivo o evento não chegar
  // (rede instável, canal caiu), o mapa se corrige sozinho a cada 8s.
  setInterval(carregarLocalizacoesEntregadores, 8000);

  ENTREGADORES_LOC_CHANNEL = sb.channel('loc-entregadores-' + LOJA.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entregador_localizacao' },
      (payload) => {
        if (payload.eventType === 'DELETE') removerMarcadorEntregador(payload.old.entregador_id);
        else atualizarMarcadorEntregador(payload.new);
      })
    .subscribe();
}

// Some do mapa assim que o entregador desliga a disponibilidade (a
// localização é apagada na hora, veja entregador_definir_disponibilidade).
function removerMarcadorEntregador(entregadorId) {
  if (MARCADORES_ENTREGADORES[entregadorId]) {
    MAPA_ENTREGADORES.removeLayer(MARCADORES_ENTREGADORES[entregadorId]);
    delete MARCADORES_ENTREGADORES[entregadorId];
  }
  const entregador = ENTREGADORES.find(e => e.id === entregadorId);
  if (entregador && entregador.disponivel) {
    entregador.disponivel = false;
    renderEntregadores();
    atualizarSeletorEntregadorPedido();
  }
}

async function carregarLocalizacoesEntregadores() {
  const ids = ENTREGADORES.map(e => e.id);
  if (!ids.length) return;
  const { data, error } = await sb.from('entregador_localizacao').select('*').in('entregador_id', ids);
  if (error) { console.error('Erro ao carregar localização dos entregadores:', error); return; }
  const presentes = new Set((data || []).map(l => l.entregador_id));
  (data || []).forEach(atualizarMarcadorEntregador);
  Object.keys(MARCADORES_ENTREGADORES).forEach((id) => {
    if (!presentes.has(id)) removerMarcadorEntregador(id);
  });
}

function atualizarMarcadorEntregador(loc) {
  if (!MAPA_ENTREGADORES || loc.latitude == null || loc.longitude == null) return;
  const entregador = ENTREGADORES.find(e => e.id === loc.entregador_id);
  if (!entregador) return; // não é entregador desta loja

  if (!entregador.disponivel) {
    entregador.disponivel = true;
    renderEntregadores();
    atualizarSeletorEntregadorPedido();
  }

  if (MARCADORES_ENTREGADORES[loc.entregador_id]) {
    MARCADORES_ENTREGADORES[loc.entregador_id].setLatLng([loc.latitude, loc.longitude]);
  } else {
    MARCADORES_ENTREGADORES[loc.entregador_id] = L.marker([loc.latitude, loc.longitude], { icon: iconeEntregador(entregador.veiculo) })
      .addTo(MAPA_ENTREGADORES)
      .bindTooltip(entregador.nome, { direction: 'top', offset: [0, -16] })
      .bindPopup(entregador.nome);
  }
}

// ============================================================
checarSessao();
