// ============================================================
// CONFIGURAÇÃO — troque pelos dados do SEU projeto Supabase
// ============================================================
const SUPABASE_URL = 'https://psgffdanlpaxgvenzqeh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzZ2ZmZGFubHBheGd2ZW56cWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNDMxODAsImV4cCI6MjEwMzYxOTE4MH0.GYbEfYbRArCOsGoankz0_TNrwvd4YoURrPdnZeo9Ub4';

// Slug padrão, usado se a URL não trouxer ?loja=. Numa operação com várias
// lojas, o link de cada uma inclui o parâmetro (veja lojas.html).
const SLUG_LOJA = new URLSearchParams(location.search).get('loja') || 'minha-lanchonete';

// Chave pública VAPID gerada com `npx web-push generate-vapid-keys`
// (a chave pública é segura para expor no front-end; a privada fica só na Edge Function)
const VAPID_PUBLIC_KEY = 'BLq9xJk7tnVmUfIT3enJjI70PQjz934epwo7uXkak9U7P8NzR23QIPwalNHjXCkJVJweqiPCZEUqTywzeV_oFCE';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// ESTADO GLOBAL
// ============================================================
let LOJA = null;
let CATEGORIAS = [];
let PRODUTOS = [];
let RAIOS = [];
let CARRINHO = []; // [{produtoId, nome, preco, qtd, adicionais:[{nome,preco}], observacao}]
let PRODUTO_ATUAL = null;

// Chaves do localStorage namespaced por loja, para não misturar dados
// quando o app.js é reutilizado por vários estabelecimentos (?loja=slug)
const LS_PEDIDO = `pedido_atual_id_${SLUG_LOJA}`;
const LS_NOME = `cliente_nome_${SLUG_LOJA}`;
const LS_WHATS = `cliente_whatsapp_${SLUG_LOJA}`;
const LS_MEUS_PEDIDOS = `meus_pedidos_${SLUG_LOJA}`;

let PEDIDO_ATUAL_ID = localStorage.getItem(LS_PEDIDO) || null;
let REALTIME_CHANNEL = null;
let MEUS_PEDIDOS_CHANNEL = null;
let CLIENTE_ATUAL_ID = null;
let MEUS_PEDIDOS_IDS = JSON.parse(localStorage.getItem(LS_MEUS_PEDIDOS) || '[]');

const fmt = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const fmtTaxa = (v) => Number(v) === 0 ? 'Grátis' : fmt(v);

// ============================================================
// ÍCONES (SVG outline, substituem os emojis pelo visual)
// ============================================================
function icon(nome, tamanho = 16) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.5 2"/>',
    truck: '<rect x="2.5" y="9" width="11" height="7" rx="1"/><path d="M13.5 12h3.6l3.4 3v1h-3"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    bag: '<path d="M6.5 8h11l-1 12h-9Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9"/><path d="M15 9.8c0-1.3-1.4-1.8-3-1.8s-3 .6-3 1.8c0 2.6 6 1.2 6 3.9 0 1.3-1.4 1.8-3 1.8s-3-.5-3-1.8"/>',
    bell: '<path d="M6.5 8.5a5.5 5.5 0 0 1 11 0c0 4.6 1.8 5.8 1.8 5.8H4.7s1.8-1.2 1.8-5.8Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    phone: '<path d="M6 3h3l1.5 5-2 1.5a12 12 0 0 0 6 6l1.5-2 5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z"/>',
    chat: '<path d="M4 5h16v11H9l-4 4V5Z"/>',
  }[nome] || '';
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block">${paths}</svg>`;
}

// ============================================================
// CARREGAMENTO INICIAL
// ============================================================
async function iniciar() {
  const { data: loja } = await sb.from('estabelecimentos').select('*').eq('slug', SLUG_LOJA).single();
  if (!loja) { document.getElementById('lojaNome').textContent = 'Loja não encontrada'; return; }
  LOJA = loja;
  renderHeader();

  const { data: categorias } = await sb.from('categorias').select('*').eq('estabelecimento_id', LOJA.id).eq('ativa', true).order('ordem');
  CATEGORIAS = categorias || [];

  const { data: produtos } = await sb.from('produtos').select('*, adicionais(*), grupos_ingredientes(*, ingredientes(*))').eq('estabelecimento_id', LOJA.id).eq('ativo', true).order('ordem');
  PRODUTOS = produtos || [];

  const { data: raios } = await sb.from('raios_entrega').select('*').eq('estabelecimento_id', LOJA.id).eq('ativa', true).order('raio_km');
  RAIOS = raios || [];

  renderCategorias();
  renderProdutos();
  renderDestaques();
  renderHeaderToggle();

  // Se já existe um pedido em andamento salvo no navegador, mostra o status
  if (PEDIDO_ATUAL_ID) abrirStatusPedido(PEDIDO_ATUAL_ID);

  atualizarBadgeMeusPedidos();
  escutarMeusPedidos();

  document.getElementById('buscaInput').addEventListener('input', (e) => renderProdutos(e.target.value));
}

// Escurece um hex em `pct`% — usado pra gerar o --accent-dark (hover/estados)
// a partir da cor escolhida pela loja.
function escurecerHex(hex, pct) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, ((n >> 16) & 255) * (1 - pct));
  const g = Math.max(0, ((n >> 8) & 255) * (1 - pct));
  const b = Math.max(0, (n & 255) * (1 - pct));
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function aplicarCorDestaque() {
  const cor = LOJA.cor_destaque || '#FF5A36';
  document.documentElement.style.setProperty('--accent', cor);
  document.documentElement.style.setProperty('--accent-dark', escurecerHex(cor, 0.12));
  // O verde (--success) também vira a cor escolhida — usado no selo de
  // "disponível" da grade de destaques e no status "Aberto agora".
  document.documentElement.style.setProperty('--success', cor);
  // Fundo do cabeçalho (hoje um verde bem escuro fixo) vira um tom escuro
  // da cor escolhida, pra manter contraste com o texto branco por cima.
  document.documentElement.style.setProperty('--header-bg', escurecerHex(cor, 0.65));
  // Cor da barra do navegador/status bar do celular (fora do conteúdo do site)
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', escurecerHex(cor, 0.65));
}

function renderHeader() {
  aplicarCorDestaque();
  document.getElementById('lojaNome').textContent = LOJA.nome;
  if (LOJA.logo_url) document.getElementById('lojaLogo').innerHTML = `<img src="${LOJA.logo_url}">`;
  const aberta = LOJA.aberto && !LOJA.pausado_manualmente;
  document.getElementById('statusDot').className = 'dot' + (aberta ? '' : ' fechado');
  document.getElementById('statusTexto').textContent = aberta ? 'Aberto agora' : 'Fechado no momento';
  document.getElementById('metaTempoEntrega').innerHTML = `${icon('truck', 13)} ${LOJA.tempo_entrega_min}–${LOJA.tempo_entrega_max} min`;
  document.getElementById('metaHorario').innerHTML = `${icon('clock', 13)} Horário de hoje`;
}

function renderHeaderToggle() {
  const pillEntrega = document.getElementById('pillEntrega');
  const pillRetirada = document.getElementById('pillRetirada');
  if (!pillEntrega) return;
  pillEntrega.classList.toggle('ativo', PEDIDO_FORM.tipoEntrega === 'entrega');
  pillRetirada.classList.toggle('ativo', PEDIDO_FORM.tipoEntrega === 'retirada');
}

function setTipoEntregaPreview(tipo) {
  PEDIDO_FORM.tipoEntrega = tipo;
  renderHeaderToggle();
}

function renderDestaques() {
  const secao = document.getElementById('destaquesSection');
  const grid = document.getElementById('destaquesGrid');
  const disponiveis = PRODUTOS.filter(p => p.disponivel_hoje && !p.esgotado);

  let destaques = disponiveis.filter(p => p.preco_promocional != null);
  if (!destaques.length) destaques = disponiveis.slice(0, 4);
  else destaques = destaques.slice(0, 4);

  if (!destaques.length) { secao.classList.add('hide'); return; }
  secao.classList.remove('hide');

  grid.innerHTML = destaques.map(p => `
    <div class="destaque-card" onclick="abrirProduto('${p.id}')">
      <div class="destaque-foto">
        ${p.foto_url ? `<img src="${p.foto_url}">` : ''}
        <span class="destaque-selo">✓</span>
      </div>
      <div class="destaque-nome">${p.nome}</div>
      <div class="destaque-preco">${fmt(p.preco_promocional ?? p.preco)}</div>
    </div>
  `).join('');
}

function renderCategorias() {
  const nav = document.getElementById('categoriasNav');
  nav.innerHTML = CATEGORIAS.map((c, i) =>
    `<button class="cat-chip ${i === 0 ? 'ativa' : ''}" onclick="filtrarCategoria('${c.id}', this)">${c.nome}</button>`
  ).join('') + `<button class="cat-chip" onclick="filtrarCategoria(null, this)">Todos</button>`;
}

let CATEGORIA_FILTRO = null;
function filtrarCategoria(id, el) {
  CATEGORIA_FILTRO = id;
  document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('ativa'));
  el.classList.add('ativa');
  renderProdutos();
}

function renderProdutos(busca = '') {
  const lista = document.getElementById('listaProdutos');
  let produtosFiltrados = PRODUTOS.filter(p => p.disponivel_hoje);
  if (CATEGORIA_FILTRO) produtosFiltrados = produtosFiltrados.filter(p => p.categoria_id === CATEGORIA_FILTRO);
  if (busca) produtosFiltrados = produtosFiltrados.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase()));

  if (!produtosFiltrados.length) {
    lista.innerHTML = `<div class="empty-state">Nenhum produto encontrado.</div>`;
    return;
  }

  const porCategoria = {};
  produtosFiltrados.forEach(p => {
    const catNome = CATEGORIAS.find(c => c.id === p.categoria_id)?.nome || 'Outros';
    (porCategoria[catNome] ||= []).push(p);
  });

  lista.innerHTML = Object.entries(porCategoria).map(([catNome, prods]) => `
    <section class="secao-categoria">
      <h2>${catNome}</h2>
      ${prods.map(p => produtoCardHTML(p)).join('')}
    </section>
  `).join('');
}

function produtoCardHTML(p) {
  const preco = p.preco_promocional ?? p.preco;
  return `
    <div class="produto-card" onclick="abrirProduto('${p.id}')">
      <div class="produto-foto">${p.foto_url ? `<img src="${p.foto_url}">` : 'foto'}</div>
      <div class="produto-info">
        <h3>${p.nome}</h3>
        <p>${p.descricao || ''}</p>
        <div class="produto-preco-row">
          <span class="preco">
            ${p.preco_promocional ? `<span class="preco-antigo">${fmt(p.preco)}</span>` : ''}
            ${fmt(preco)}
          </span>
          ${p.esgotado ? '<span class="badge-esgotado">Esgotado</span>' : '<div class="btn-add">+</div>'}
        </div>
      </div>
    </div>`;
}

// ============================================================
// TELA DE PRODUTO
// ============================================================
function abrirProduto(id) {
  const p = PRODUTOS.find(x => x.id === id);
  if (!p || p.esgotado) return;
  PRODUTO_ATUAL = {
    produto: p, qtd: 1, adicionais: [], observacao: '',
    grupos: (p.grupos_ingredientes || []).filter(g => g.ativo).map(g => ({
      nome: g.nome, limite: g.limite_escolha,
      ingredientes: (g.ingredientes || []).filter(i => i.ativo).map(i => ({
        nome: i.nome, padrao: i.incluido_padrao,
        // Categoria com limite de escolha sempre começa em branco — o
        // cliente escolhe ativamente, igual iFood. Sem limite, mantém o
        // comportamento de "vem incluso, tira se não quiser".
        incluido: g.limite_escolha ? false : i.incluido_padrao
      }))
    }))
  };

  const gruposHTML = PRODUTO_ATUAL.grupos.map((g, gi) => `
    <div class="grupo-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>${g.nome}</span>
      ${g.limite ? `<span class="grupo-limite-hint" id="limiteHint_${gi}">${g.ingredientes.filter(i => i.incluido).length}/${g.limite}</span>` : ''}
    </div>
    ${g.ingredientes.map((ing, ii) => g.limite ? `
      <div class="ingrediente-toggle-row">
        <span>${ing.nome}</span>
        <button type="button" class="btn-toggle-sinal" id="toggleIng_${gi}_${ii}" onclick="toggleIngredienteGrupo(${gi}, ${ii})">+</button>
      </div>` : `
      <div class="adicional-row">
        <label><input type="checkbox" ${ing.incluido ? 'checked' : ''} onchange="toggleIngredienteSemLimite(${gi}, ${ii}, this)"> ${ing.nome}</label>
        ${!ing.padrao ? '<span class="adicional-preco">opcional</span>' : ''}
      </div>`).join('')}
  `).join('');

  const adicionaisHTML = (p.adicionais || []).filter(a => a.ativo).map(a => `
    <div class="adicional-row">
      <label><input type="checkbox" onchange="toggleAdicional('${a.id}', '${a.nome.replace(/'/g, "\\'")}', ${a.preco}, this.checked)"> ${a.nome}</label>
      <span class="adicional-preco">+ ${fmt(a.preco)}</span>
    </div>`).join('');

  document.getElementById('produtoDetalheConteudo').innerHTML = `
    <div class="produto-detalhe-foto">${p.foto_url ? `<img src="${p.foto_url}">` : ''}</div>
    <h2>${p.nome}</h2>
    <p class="desc">${p.descricao || ''}</p>
    <div class="qtd-row">
      <strong style="font-size:13.5px;">Quantidade</strong>
      <div class="qtd-control">
        <button onclick="mudarQtd(-1)">−</button>
        <span id="qtdValor">1</span>
        <button onclick="mudarQtd(1)">+</button>
      </div>
    </div>
    ${gruposHTML}
    ${adicionaisHTML ? `<div class="grupo-title">Adicionais</div>${adicionaisHTML}` : ''}
    <div class="grupo-title">Observação</div>
    <textarea rows="2" placeholder="Ex: sem cebola, molho separado…" oninput="PRODUTO_ATUAL.observacao=this.value"></textarea>
    <button class="btn-primario" onclick="adicionarAoCarrinho()">
      <span>Adicionar ao carrinho</span><span id="btnAddValor">${fmt(p.preco_promocional ?? p.preco)}</span>
    </button>
  `;
  abrirOverlay('overlayProduto');
}

function mudarQtd(delta) {
  PRODUTO_ATUAL.qtd = Math.max(1, PRODUTO_ATUAL.qtd + delta);
  document.getElementById('qtdValor').textContent = PRODUTO_ATUAL.qtd;
  atualizarValorBotaoAdd();
}

// Categorias COM limite — botão +/- (estilo iFood), nada vem marcado
function toggleIngredienteGrupo(gi, ii) {
  const grupo = PRODUTO_ATUAL.grupos[gi];
  const ing = grupo.ingredientes[ii];
  const querMarcar = !ing.incluido;

  if (querMarcar) {
    const totalMarcados = grupo.ingredientes.filter(i => i.incluido).length;
    if (totalMarcados >= grupo.limite) {
      alert(`Você já escolheu o máximo de ${grupo.limite} em "${grupo.nome}".`);
      return;
    }
  }

  ing.incluido = querMarcar;
  const btn = document.getElementById(`toggleIng_${gi}_${ii}`);
  btn.textContent = querMarcar ? '−' : '+';
  btn.classList.toggle('selecionado', querMarcar);

  const hint = document.getElementById(`limiteHint_${gi}`);
  if (hint) hint.textContent = `${grupo.ingredientes.filter(i => i.incluido).length}/${grupo.limite}`;
}

// Categorias SEM limite — checkbox tradicional, vem incluso por padrão
function toggleIngredienteSemLimite(gi, ii, checkboxEl) {
  PRODUTO_ATUAL.grupos[gi].ingredientes[ii].incluido = checkboxEl.checked;
}

function toggleAdicional(id, nome, preco, checked) {
  if (checked) PRODUTO_ATUAL.adicionais.push({ id, nome, preco });
  else PRODUTO_ATUAL.adicionais = PRODUTO_ATUAL.adicionais.filter(a => a.id !== id);
  atualizarValorBotaoAdd();
}

function atualizarValorBotaoAdd() {
  const p = PRODUTO_ATUAL.produto;
  const base = (p.preco_promocional ?? p.preco);
  const adicionaisTotal = PRODUTO_ATUAL.adicionais.reduce((s, a) => s + a.preco, 0);
  const total = (base + adicionaisTotal) * PRODUTO_ATUAL.qtd;
  document.getElementById('btnAddValor').textContent = fmt(total);
}

function adicionarAoCarrinho() {
  const p = PRODUTO_ATUAL.produto;
  const base = (p.preco_promocional ?? p.preco);
  // Categoria com limite: tudo que ficou marcado foi escolha ativa do
  // cliente (não tem "padrão" pra comparar) — entra como "adicionado".
  // Categoria sem limite: mantém a lógica de vem incluso/removeu/adicionou.
  const ingredientesRemovidos = [];
  const ingredientesAdicionados = [];
  PRODUTO_ATUAL.grupos.forEach(g => {
    g.ingredientes.forEach(i => {
      if (g.limite) {
        if (i.incluido) ingredientesAdicionados.push(i.nome);
      } else {
        if (i.padrao && !i.incluido) ingredientesRemovidos.push(i.nome);
        if (!i.padrao && i.incluido) ingredientesAdicionados.push(i.nome);
      }
    });
  });
  CARRINHO.push({
    produtoId: p.id,
    nome: p.nome,
    precoUnitario: base,
    qtd: PRODUTO_ATUAL.qtd,
    adicionais: PRODUTO_ATUAL.adicionais,
    ingredientesRemovidos,
    ingredientesAdicionados,
    observacao: PRODUTO_ATUAL.observacao
  });
  fecharOverlay('overlayProduto');
  atualizarCarrinhoFlutuante();
}

// ============================================================
// CARRINHO
// ============================================================
function itemTotal(item) {
  const adicionaisTotal = item.adicionais.reduce((s, a) => s + a.preco, 0);
  return (item.precoUnitario + adicionaisTotal) * item.qtd;
}

function ingredientesResumoHTML(item) {
  const removidos = item.ingredientesRemovidos?.length ? `<small>Sem ${item.ingredientesRemovidos.join(', ')}</small>` : '';
  const adicionados = item.ingredientesAdicionados?.length ? `<small>+ ${item.ingredientesAdicionados.join(', ')}</small>` : '';
  return removidos + adicionados;
}
function carrinhoSubtotal() {
  return CARRINHO.reduce((s, i) => s + itemTotal(i), 0);
}

function atualizarCarrinhoFlutuante() {
  const badge = document.getElementById('carrinhoBadge');
  const qtdTotal = CARRINHO.reduce((s, i) => s + i.qtd, 0);
  badge.textContent = qtdTotal;
  badge.classList.toggle('hide', qtdTotal === 0);
}

// ============================================================
// NAVEGAÇÃO INFERIOR
// ============================================================
function setNavAtiva(id) {
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('ativo'));
  document.getElementById(id).classList.add('ativo');
}

function irParaInicio() {
  setNavAtiva('navInicio');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function irParaCardapio() {
  setNavAtiva('navCardapio');
  document.getElementById('categoriasNav').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function irParaCarrinho() {
  setNavAtiva('navCarrinho');
  abrirCarrinho();
}

function abrirCarrinho() {
  renderCarrinho();
  abrirOverlay('overlayCarrinho');
}

function renderCarrinho() {
  const cont = document.getElementById('carrinhoItens');
  if (!CARRINHO.length) {
    cont.innerHTML = `<div class="empty-state">Seu carrinho está vazio.</div>`;
  } else {
    cont.innerHTML = CARRINHO.map((item, idx) => `
      <div class="item-carrinho">
        <div class="item-carrinho-info">
          <h4>${item.qtd}x ${item.nome}</h4>
          ${item.adicionais.length ? `<small>+ ${item.adicionais.map(a => a.nome).join(', ')}</small>` : ''}
          ${ingredientesResumoHTML(item)}
          ${item.observacao ? `<small>Obs: ${item.observacao}</small>` : ''}
        </div>
        <div class="item-carrinho-acoes">
          <strong style="font-size:13.5px;">${fmt(itemTotal(item))}</strong>
          <button class="link-remover" onclick="removerItem(${idx})">Remover</button>
        </div>
      </div>
    `).join('');
  }
  const subtotal = carrinhoSubtotal();
  document.getElementById('carrinhoResumoValores').innerHTML = `
    <div class="resumo-linha"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="resumo-linha"><span>Taxa de entrega</span><span>calculada a seguir</span></div>
  `;
  document.getElementById('btnCheckoutValor').textContent = fmt(subtotal);
  document.getElementById('btnIrCheckout').disabled = CARRINHO.length === 0;
}

function removerItem(idx) {
  CARRINHO.splice(idx, 1);
  renderCarrinho();
  atualizarCarrinhoFlutuante();
}

// ============================================================
// CHECKOUT (identificação → entrega → pagamento → revisão)
// ============================================================
let PEDIDO_FORM = {
  nome: localStorage.getItem(LS_NOME) || '',
  whatsapp: localStorage.getItem(LS_WHATS) || '',
  tipoEntrega: 'entrega',
  cep: '', rua: '', numero: '', bairro: '', complemento: '', referencia: '',
  latitude: null, longitude: null, taxaEntrega: null,
  formaPagamento: 'pix',
  trocoPara: ''
};

// ---- Cálculo de taxa por raio de distância (estilo iFood) ----
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Acha a menor faixa de raio que cobre a distância; null = fora da área
function raioParaDistancia(distKm) {
  const ordenados = [...RAIOS].sort((a, b) => a.raio_km - b.raio_km);
  return ordenados.find(r => distKm <= r.raio_km) || null;
}

function abrirCheckout() {
  fecharOverlay('overlayCarrinho');
  renderCheckoutIdentificacao();
  abrirOverlay('overlayCheckout');
}

function renderCheckoutIdentificacao() {
  document.getElementById('checkoutConteudo').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:4px;">${PEDIDO_FORM.nome ? `Olá, ${PEDIDO_FORM.nome}!` : 'Quase lá!'}</h2>
    <p style="font-size:12.5px;color:var(--muted);margin-bottom:16px;">Informe seus dados de contato.</p>
    <div class="campo"><label>Nome</label><input id="inpNome" value="${PEDIDO_FORM.nome}" placeholder="Seu nome"></div>
    <div class="campo"><label>WhatsApp</label><input id="inpWhats" value="${PEDIDO_FORM.whatsapp}" placeholder="(00) 00000-0000"></div>
    <button class="btn-primario" onclick="salvarIdentificacao()"><span>Continuar</span><span>→</span></button>
  `;
}

function salvarIdentificacao() {
  const nome = document.getElementById('inpNome').value.trim();
  const whatsapp = document.getElementById('inpWhats').value.trim();
  if (!nome || !whatsapp) return alert('Preencha nome e WhatsApp.');
  PEDIDO_FORM.nome = nome;
  PEDIDO_FORM.whatsapp = whatsapp;
  localStorage.setItem(LS_NOME, nome);
  localStorage.setItem(LS_WHATS, whatsapp);
  renderCheckoutEntrega();
}

function renderCheckoutEntrega() {
  document.getElementById('checkoutConteudo').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:14px;">Entrega ou retirada?</h2>
    <div class="toggle-row">
      <button class="toggle-btn ${PEDIDO_FORM.tipoEntrega === 'entrega' ? 'ativo' : ''}" onclick="setTipoEntrega('entrega')">${icon('truck', 15)} Entrega</button>
      <button class="toggle-btn ${PEDIDO_FORM.tipoEntrega === 'retirada' ? 'ativo' : ''}" onclick="setTipoEntrega('retirada')">${icon('bag', 15)} Retirar</button>
    </div>
    <div id="camposEndereco"></div>
    <button class="btn-primario" id="btnContinuarEntrega" onclick="salvarEntrega()"><span>Continuar</span><span>→</span></button>
  `;
  renderCamposEndereco();
}

function setTipoEntrega(tipo) {
  PEDIDO_FORM.tipoEntrega = tipo;
  if (tipo === 'entrega' && PEDIDO_FORM.formaPagamento === 'pdv') PEDIDO_FORM.formaPagamento = 'pix';
  renderHeaderToggle();
  renderCheckoutEntrega();
}

function renderCamposEndereco() {
  const el = document.getElementById('camposEndereco');
  if (PEDIDO_FORM.tipoEntrega === 'retirada') {
    el.innerHTML = `<p style="font-size:13px;color:var(--muted);margin-bottom:10px;">Você retira o pedido no estabelecimento.</p>`;
    document.getElementById('btnContinuarEntrega').disabled = false;
    return;
  }

  if (LOJA.latitude == null || LOJA.longitude == null) {
    el.innerHTML = `<p style="font-size:13px;color:var(--muted);margin-bottom:10px;">A loja ainda não configurou a área de entrega. Escolha "Retirar" por enquanto.</p>`;
    document.getElementById('btnContinuarEntrega').disabled = true;
    return;
  }

  el.innerHTML = `
    <div class="campo">
      <label>Marque sua localização no mapa</label>
      <div id="mapaEntrega" style="height:200px;border-radius:14px;overflow:hidden;border:1px solid var(--line);margin-bottom:8px;"></div>
      <div id="statusDistancia" class="status-distancia">Arraste o pin pro seu endereço.</div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;">⚠️ É esse pin que o entregador vai usar pra chegar até você — confira se ele está exatamente no seu endereço, não só o texto abaixo.</p>
    </div>
    <div class="campo"><label>Rua</label><input id="inpRua" value="${PEDIDO_FORM.rua}"></div>
    <div class="campo"><label>Número</label><input id="inpNumero" value="${PEDIDO_FORM.numero}"></div>
    <div class="campo"><label>Bairro</label><input id="inpBairro" value="${PEDIDO_FORM.bairro}"></div>
    <div class="campo"><label>Complemento (opcional)</label><input id="inpComplemento" value="${PEDIDO_FORM.complemento}"></div>
    <div class="campo"><label>Ponto de referência (opcional)</label><input id="inpReferencia" value="${PEDIDO_FORM.referencia}"></div>
  `;
  document.getElementById('btnContinuarEntrega').disabled = true;
  inicializarMapaEntrega();
}

// ---- Mapa (Leaflet) pro cliente marcar o endereço de entrega ----
let MAPA_ENTREGA_CLIENTE = null;
let MARCADOR_ENTREGA_CLIENTE = null;

function inicializarMapaEntrega() {
  const centroLoja = [LOJA.latitude, LOJA.longitude];
  const centroInicial = (PEDIDO_FORM.latitude != null) ? [PEDIDO_FORM.latitude, PEDIDO_FORM.longitude] : centroLoja;

  MAPA_ENTREGA_CLIENTE = L.map('mapaEntrega').setView(centroInicial, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(MAPA_ENTREGA_CLIENTE);

  MARCADOR_ENTREGA_CLIENTE = L.marker(centroInicial, { draggable: true }).addTo(MAPA_ENTREGA_CLIENTE);
  MARCADOR_ENTREGA_CLIENTE.on('dragend', () => atualizarDistanciaEntrega(true));

  const jaConfirmouAntes = PEDIDO_FORM.latitude != null;

  if (jaConfirmouAntes) {
    // Cliente já tinha confirmado a localização antes (ex: voltou pra essa etapa)
    atualizarDistanciaEntrega(true);
  } else {
    // O pin começa em cima da loja só como referência visual — NÃO conta
    // como localização confirmada, senão a distância dá 0km (grátis) sem
    // o cliente ter feito nada.
    document.getElementById('statusDistancia').textContent = 'Arraste o pin pro seu endereço exato pra calcularmos a taxa.';
    document.getElementById('btnContinuarEntrega').disabled = true;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const c = [pos.coords.latitude, pos.coords.longitude];
        MAPA_ENTREGA_CLIENTE.setView(c, 15);
        MARCADOR_ENTREGA_CLIENTE.setLatLng(c);
        atualizarDistanciaEntrega(true);
      }, () => {});
    }
  }
}

function atualizarDistanciaEntrega(confirmado) {
  const { lat, lng } = MARCADOR_ENTREGA_CLIENTE.getLatLng();
  const dist = distanciaKm(LOJA.latitude, LOJA.longitude, lat, lng);
  const raio = raioParaDistancia(dist);
  const statusEl = document.getElementById('statusDistancia');
  const btn = document.getElementById('btnContinuarEntrega');

  if (!confirmado) return;

  PEDIDO_FORM.latitude = lat;
  PEDIDO_FORM.longitude = lng;

  if (!raio) {
    statusEl.innerHTML = `${icon('x', 13)} Infelizmente não entregamos nesse endereço (${dist.toFixed(1)} km da loja).`;
    statusEl.classList.add('fora-area');
    PEDIDO_FORM.taxaEntrega = null;
    btn.disabled = true;
  } else {
    statusEl.innerHTML = `${dist.toFixed(1)} km da loja — taxa de entrega: <strong>${fmtTaxa(raio.valor)}</strong>`;
    statusEl.classList.remove('fora-area');
    PEDIDO_FORM.taxaEntrega = raio.valor;
    btn.disabled = false;
  }
}

function salvarEntrega() {
  if (PEDIDO_FORM.tipoEntrega === 'entrega') {
    const rua = document.getElementById('inpRua').value.trim();
    const numero = document.getElementById('inpNumero').value.trim();
    const bairro = document.getElementById('inpBairro').value.trim();
    if (!rua || !numero || !bairro) return alert('Preencha rua, número e bairro.');
    if (PEDIDO_FORM.taxaEntrega == null) return alert('Marque um endereço dentro da área de entrega no mapa.');
    PEDIDO_FORM.rua = rua;
    PEDIDO_FORM.numero = numero;
    PEDIDO_FORM.bairro = bairro;
    PEDIDO_FORM.complemento = document.getElementById('inpComplemento').value.trim();
    PEDIDO_FORM.referencia = document.getElementById('inpReferencia').value.trim();
  } else {
    PEDIDO_FORM.taxaEntrega = 0;
  }
  renderCheckoutPagamento();
}

function renderCheckoutPagamento() {
  document.getElementById('checkoutConteudo').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:14px;">Forma de pagamento</h2>
    <div class="toggle-row">
      <button class="toggle-btn ${PEDIDO_FORM.formaPagamento === 'pix' ? 'ativo' : ''}" onclick="setPagamento('pix')">PIX</button>
      <button class="toggle-btn ${PEDIDO_FORM.formaPagamento === 'dinheiro' ? 'ativo' : ''}" onclick="setPagamento('dinheiro')">Dinheiro</button>
      ${LOJA.aceita_cartao ? `<button class="toggle-btn ${PEDIDO_FORM.formaPagamento === 'cartao' ? 'ativo' : ''}" onclick="setPagamento('cartao')">Cartão</button>` : ''}
      ${PEDIDO_FORM.tipoEntrega === 'retirada' ? `<button class="toggle-btn ${PEDIDO_FORM.formaPagamento === 'pdv' ? 'ativo' : ''}" onclick="setPagamento('pdv')">No caixa</button>` : ''}
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:-6px 0 12px;">${PEDIDO_FORM.formaPagamento === 'cartao' ? 'O entregador leva a maquininha.' : PEDIDO_FORM.formaPagamento === 'pdv' ? 'Você paga direto no caixa ao retirar.' : 'Pagamento na entrega.'}</p>
    <div id="campoTroco"></div>
    <button class="btn-primario" onclick="irParaRevisao()"><span>Revisar pedido</span><span>→</span></button>
  `;
  renderCampoTroco();
}

function setPagamento(f) { PEDIDO_FORM.formaPagamento = f; renderCheckoutPagamento(); }

function textoPagamentoCliente() {
  const f = PEDIDO_FORM.formaPagamento;
  if (f === 'pix') return 'PIX na entrega';
  if (f === 'cartao') return 'Cartão na entrega';
  if (f === 'pdv') return 'Pagamento no caixa (retirada)';
  return 'Dinheiro' + (PEDIDO_FORM.trocoPara ? ` (troco p/ ${PEDIDO_FORM.trocoPara})` : '');
}

function renderCampoTroco() {
  const el = document.getElementById('campoTroco');
  if (PEDIDO_FORM.formaPagamento !== 'dinheiro') { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="campo"><label>Precisa de troco? Troco para quanto?</label>
    <input id="inpTroco" placeholder="Ex: 100,00" value="${PEDIDO_FORM.trocoPara}" oninput="PEDIDO_FORM.trocoPara=this.value"></div>`;
}

function irParaRevisao() {
  const subtotal = carrinhoSubtotal();
  const taxa = Number(PEDIDO_FORM.taxaEntrega || 0);
  const total = subtotal + taxa;

  document.getElementById('checkoutConteudo').innerHTML = `
    <h2 style="font-size:17px;margin-bottom:14px;">Revisar pedido</h2>
    <div id="carrinhoItens">${CARRINHO.map(item => `
      <div class="item-carrinho">
        <div class="item-carrinho-info">
          <h4>${item.qtd}x ${item.nome}</h4>
          ${item.adicionais.length ? `<small>+ ${item.adicionais.map(a => a.nome).join(', ')}</small>` : ''}
          ${ingredientesResumoHTML(item)}
        </div>
        <strong style="font-size:13.5px;">${fmt(itemTotal(item))}</strong>
      </div>`).join('')}</div>
    <div class="resumo-linha"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="resumo-linha"><span>Taxa de entrega</span><span>${fmtTaxa(taxa)}</span></div>
    <div class="resumo-linha total"><span>Total</span><span>${fmt(total)}</span></div>
    <div class="resumo-linha"><span>Pagamento</span><span>${textoPagamentoCliente()}</span></div>
    <div class="resumo-linha"><span>${PEDIDO_FORM.tipoEntrega === 'entrega' ? 'Endereço' : 'Retirada'}</span>
      <span style="text-align:right;max-width:60%;">${PEDIDO_FORM.tipoEntrega === 'entrega' ? `${PEDIDO_FORM.rua}, ${PEDIDO_FORM.numero} — ${PEDIDO_FORM.bairro}` : 'No local'}</span></div>
    <button class="btn-primario" id="btnFazerPedido" onclick="enviarPedido()"><span>Fazer pedido</span><span>${fmt(total)}</span></button>
  `;
}

async function enviarPedido() {
  const btn = document.getElementById('btnFazerPedido');
  btn.disabled = true; btn.querySelector('span').textContent = 'Enviando…';

  try {
    // 1. cliente (upsert por whatsapp)
    let { data: cliente } = await sb.from('clientes')
      .select('*').eq('estabelecimento_id', LOJA.id).eq('whatsapp', PEDIDO_FORM.whatsapp).maybeSingle();
    if (!cliente) {
      const { data: novoCliente, error } = await sb.from('clientes')
        .insert({ estabelecimento_id: LOJA.id, nome: PEDIDO_FORM.nome, whatsapp: PEDIDO_FORM.whatsapp }).select().single();
      if (error) throw error;
      cliente = novoCliente;
    }

    // 2. endereço (se entrega)
    let enderecoId = null;
    if (PEDIDO_FORM.tipoEntrega === 'entrega') {
      const { data: endereco, error } = await sb.from('enderecos').insert({
        cliente_id: cliente.id, cep: PEDIDO_FORM.cep, rua: PEDIDO_FORM.rua, numero: PEDIDO_FORM.numero,
        bairro: PEDIDO_FORM.bairro, complemento: PEDIDO_FORM.complemento, referencia: PEDIDO_FORM.referencia,
        latitude: PEDIDO_FORM.latitude, longitude: PEDIDO_FORM.longitude
      }).select().single();
      if (error) throw error;
      enderecoId = endereco.id;
    }

    // 3. pedido
    const subtotal = carrinhoSubtotal();
    const taxa = Number(PEDIDO_FORM.taxaEntrega || 0);
    const { data: pedido, error: erroPedido } = await sb.from('pedidos').insert({
      estabelecimento_id: LOJA.id, cliente_id: cliente.id, endereco_id: enderecoId,
      tipo_entrega: PEDIDO_FORM.tipoEntrega, forma_pagamento: PEDIDO_FORM.formaPagamento,
      troco_para: PEDIDO_FORM.trocoPara ? Number(PEDIDO_FORM.trocoPara.replace(',', '.')) : null,
      subtotal, taxa_entrega: taxa, total: subtotal + taxa
    }).select().single();
    if (erroPedido) throw erroPedido;

    // 4. itens + adicionais
    for (const item of CARRINHO) {
      const { data: itemPedido, error: erroItem } = await sb.from('itens_pedido').insert({
        pedido_id: pedido.id, produto_id: item.produtoId, nome_produto: item.nome,
        preco_unitario: item.precoUnitario, quantidade: item.qtd, observacao: item.observacao,
        subtotal: itemTotal(item)
      }).select().single();
      if (erroItem) throw erroItem;

      if (item.adicionais.length) {
        await sb.from('item_adicionais').insert(
          item.adicionais.map(a => ({ item_pedido_id: itemPedido.id, nome: a.nome, preco: a.preco }))
        );
      }

      const mudancasIngredientes = [
        ...(item.ingredientesRemovidos || []).map(nome => ({ item_pedido_id: itemPedido.id, nome, tipo: 'removido' })),
        ...(item.ingredientesAdicionados || []).map(nome => ({ item_pedido_id: itemPedido.id, nome, tipo: 'adicionado' }))
      ];
      if (mudancasIngredientes.length) {
        await sb.from('item_pedido_ingredientes').insert(mudancasIngredientes);
      }
    }

    // 5. limpa carrinho e mostra status
    CARRINHO = [];
    atualizarCarrinhoFlutuante();
    localStorage.setItem(LS_PEDIDO, pedido.id);
    PEDIDO_ATUAL_ID = pedido.id;
    CLIENTE_ATUAL_ID = cliente.id;
    registrarPedidoLocal(pedido.id);
    escutarMeusPedidos();
    fecharOverlay('overlayCheckout');
    abrirStatusPedido(pedido.id, true);

  } catch (err) {
    console.error(err);
    alert('Não foi possível enviar o pedido. Tente novamente.');
    btn.disabled = false; btn.querySelector('span').textContent = 'Fazer pedido';
  }
}

// ============================================================
// ACOMPANHAMENTO EM TEMPO REAL
// ============================================================
const STATUS_INFO = {
  recebido:     { label: 'Pedido recebido',   desc: 'Recebemos seu pedido.' },
  aceito:       { label: 'Pedido aceito',     desc: 'A loja confirmou seu pedido.' },
  preparando:   { label: 'Preparando',        desc: 'Seu pedido está sendo preparado.' },
  pronto:       { label: 'Pronto',            desc: 'Seu pedido está pronto.' },
  saiu_entrega: { label: 'Saiu para entrega', desc: 'Seu pedido está a caminho.' },
  entregue:     { label: 'Entregue',          desc: 'Pedido entregue. Bom apetite!' },
};
const ORDEM_STATUS = ['recebido', 'aceito', 'preparando', 'saiu_entrega', 'entregue'];
const STATUS_FINALIZADOS = ['entregue', 'cancelado', 'recusado'];

// ============================================================
// MEUS PEDIDOS — histórico local (últimos pedidos feitos neste
// navegador), pra acompanhar mais de um pedido mesmo depois de
// finalizar o anterior e pedir de novo.
// ============================================================
function registrarPedidoLocal(id) {
  MEUS_PEDIDOS_IDS = [id, ...MEUS_PEDIDOS_IDS.filter(x => x !== id)].slice(0, 10);
  localStorage.setItem(LS_MEUS_PEDIDOS, JSON.stringify(MEUS_PEDIDOS_IDS));
}

async function buscarMeusPedidos() {
  if (!MEUS_PEDIDOS_IDS.length) return [];
  const { data } = await sb.from('pedidos').select('*').in('id', MEUS_PEDIDOS_IDS).order('criado_em', { ascending: false });
  return data || [];
}

async function atualizarBadgeMeusPedidos() {
  const badge = document.getElementById('pedidosBadge');
  const pedidos = await buscarMeusPedidos();
  const ativos = pedidos.filter(p => !STATUS_FINALIZADOS.includes(p.status)).length;
  badge.textContent = ativos;
  badge.classList.toggle('hide', ativos === 0);
}

// Escuta atualizações de status de QUALQUER pedido da loja e filtra
// localmente pelos que são "meus" — evita abrir um canal por pedido.
function escutarMeusPedidos() {
  if (!MEUS_PEDIDOS_IDS.length || MEUS_PEDIDOS_CHANNEL) return;
  MEUS_PEDIDOS_CHANNEL = sb.channel('meus-pedidos-' + SLUG_LOJA)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${LOJA.id}` },
      (payload) => {
        if (!MEUS_PEDIDOS_IDS.includes(payload.new.id)) return;
        atualizarBadgeMeusPedidos();
        if (!document.getElementById('overlayMeusPedidos').classList.contains('hide')) abrirMeusPedidos();
      })
    .subscribe();
}

async function irParaMeusPedidos() {
  setNavAtiva('navPedidos');
  await abrirMeusPedidos();
}

async function abrirMeusPedidos() {
  const pedidos = await buscarMeusPedidos();
  renderMeusPedidos(pedidos);
  abrirOverlay('overlayMeusPedidos');
}

function renderMeusPedidos(pedidos) {
  const cont = document.getElementById('meusPedidosLista');
  if (!pedidos.length) {
    cont.innerHTML = `<div class="empty-state">Você ainda não fez nenhum pedido aqui.</div>`;
    return;
  }
  cont.innerHTML = pedidos.map(p => {
    const finalizado = p.status === 'entregue';
    const cancelado = p.status === 'cancelado' || p.status === 'recusado';
    const label = STATUS_INFO[p.status]?.label || (cancelado ? 'Cancelado' : p.status);
    const hora = new Date(p.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="meu-pedido-item" onclick="fecharOverlay('overlayMeusPedidos'); abrirStatusPedido('${p.id}')">
        <div class="meu-pedido-info">
          <h4>Pedido #${p.numero}</h4>
          <small>${hora} • ${fmt(p.total)}</small>
        </div>
        <span class="meu-pedido-status ${finalizado ? 'finalizado' : ''} ${cancelado ? 'cancelado' : ''}">${label}</span>
      </div>`;
  }).join('');
}

async function abrirStatusPedido(pedidoId, recemCriado = false) {
  const { data: pedido } = await sb.from('pedidos').select('*').eq('id', pedidoId).single();
  if (!pedido) { localStorage.removeItem(LS_PEDIDO); return; }

  renderStatus(pedido, recemCriado);
  abrirOverlay('overlayStatus');

  if (REALTIME_CHANNEL) sb.removeChannel(REALTIME_CHANNEL);
  REALTIME_CHANNEL = sb.channel('pedido-' + pedidoId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `id=eq.${pedidoId}` },
      (payload) => renderStatus(payload.new, false))
    .subscribe();
}

function renderStatus(pedido, recemCriado) {
  if (pedido.status === 'entregue' || pedido.status === 'cancelado') {
    localStorage.removeItem(LS_PEDIDO);
  }
  const idxAtual = ORDEM_STATUS.indexOf(pedido.status);
  const stepsHTML = ORDEM_STATUS.map((s, i) => {
    const info = STATUS_INFO[s];
    const cls = i < idxAtual ? 'feito' : i === idxAtual ? 'atual' : '';
    return `<div class="status-step ${cls}">
      <div class="status-dot">${i < idxAtual ? '✓' : ''}</div>
      <div><h4>${info.label}</h4><p>${info.desc}</p></div>
    </div>`;
  }).join('');

  const podeCancelar = ['recebido', 'aceito'].includes(pedido.status);
  const contatoHTML = LOJA.whatsapp ? `
    <div class="contato-loja">
      <p class="contato-loja-label">Pedido demorando ou alguma dúvida?</p>
      <div class="contato-loja-botoes">
        <a class="btn-contato" href="tel:+${LOJA.whatsapp}">${icon('phone', 14)} Ligar</a>
        <a class="btn-contato" target="_blank" rel="noopener" href="https://wa.me/${LOJA.whatsapp}?text=${encodeURIComponent('Olá! Sobre o meu pedido #' + pedido.numero + '...')}">${icon('chat', 14)} WhatsApp</a>
      </div>
    </div>` : '';

  document.getElementById('statusConteudo').innerHTML = `
    ${recemCriado ? `
    <div class="pedido-numero-box">
      <div class="check">✓</div>
      <h2>Pedido realizado!</h2>
      <div class="num">Pedido #${pedido.numero}</div>
    </div>` : `<h2 style="font-size:16px;margin-bottom:4px;">Pedido #${pedido.numero}</h2><p style="font-size:12.5px;color:var(--muted);margin-bottom:10px;">Total: ${fmt(pedido.total)}</p>`}
    <div class="status-track">${pedido.status === 'cancelado' ? `<p>Este pedido foi cancelado.</p>` : stepsHTML}</div>
    ${pedido.status === 'saiu_entrega' && pedido.entregador_id ? `
    <div class="entregador-tracking">
      <p class="contato-loja-label" id="nomeEntregadorTexto">Localizando entregador…</p>
      <div id="mapaAcompanhamento"></div>
    </div>` : ''}
    ${contatoHTML}
    <button class="btn-secundario hide" id="btnAtivarPush" onclick="ativarPushCliente()">${icon('bell', 16)} Avisar quando o status mudar</button>
    <button class="btn-secundario" onclick="fecharOverlay('overlayStatus')">Continuar comprando</button>
    ${podeCancelar ? `<button class="link-cancelar" onclick="abrirCancelarPedido('${pedido.id}')">${icon('x', 13)} Cancelar pedido</button>` : ''}
  `;

  // Só oferece a opção se o navegador suporta push e o cliente ainda não está inscrito
  if ('PushManager' in window && Notification.permission !== 'denied') {
    document.getElementById('btnAtivarPush').classList.remove('hide');
  }

  if (pedido.status === 'saiu_entrega' && pedido.entregador_id) {
    renderMapaEntregador(pedido);
  } else {
    pararAcompanhamentoEntregador();
  }
}

// ============================================================
// ACOMPANHAMENTO DO ENTREGADOR NO MAPA (tempo real)
// ============================================================
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

let MAPA_ACOMPANHAMENTO = null;
let MARCADOR_ENTREGADOR_ACOMP = null;
let ENTREGADOR_LOC_CHANNEL_CLIENTE = null;

function pararAcompanhamentoEntregador() {
  if (ENTREGADOR_LOC_CHANNEL_CLIENTE) { sb.removeChannel(ENTREGADOR_LOC_CHANNEL_CLIENTE); ENTREGADOR_LOC_CHANNEL_CLIENTE = null; }
  MAPA_ACOMPANHAMENTO = null;
  MARCADOR_ENTREGADOR_ACOMP = null;
}

async function renderMapaEntregador(pedido) {
  pararAcompanhamentoEntregador();

  const [{ data: entregador }, { data: endereco }, { data: loc }] = await Promise.all([
    sb.from('entregador_publico').select('nome, veiculo').eq('id', pedido.entregador_id).single(),
    pedido.endereco_id ? sb.from('enderecos').select('latitude,longitude').eq('id', pedido.endereco_id).single() : Promise.resolve({ data: null }),
    sb.from('entregador_localizacao').select('*').eq('entregador_id', pedido.entregador_id).maybeSingle()
  ]);

  const nomeEl = document.getElementById('nomeEntregadorTexto');
  if (nomeEl && entregador) nomeEl.textContent = `🛵 Seu entregador: ${entregador.nome}`;

  const mapaEl = document.getElementById('mapaAcompanhamento');
  if (!mapaEl) return; // usuário já fechou a tela

  const centro = (loc && loc.latitude != null) ? [loc.latitude, loc.longitude]
    : (endereco && endereco.latitude != null) ? [endereco.latitude, endereco.longitude]
    : [LOJA.latitude, LOJA.longitude];

  MAPA_ACOMPANHAMENTO = L.map('mapaAcompanhamento').setView(centro, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(MAPA_ACOMPANHAMENTO);

  if (endereco && endereco.latitude != null) {
    L.marker([endereco.latitude, endereco.longitude]).addTo(MAPA_ACOMPANHAMENTO).bindPopup('Você');
  }
  if (loc && loc.latitude != null) {
    MARCADOR_ENTREGADOR_ACOMP = L.marker([loc.latitude, loc.longitude], { icon: iconeEntregador(entregador?.veiculo) }).addTo(MAPA_ACOMPANHAMENTO).bindPopup('Entregador');
  }

  ENTREGADOR_LOC_CHANNEL_CLIENTE = sb.channel('acompanhar-entregador-' + pedido.entregador_id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entregador_localizacao', filter: `entregador_id=eq.${pedido.entregador_id}` },
      (payload) => {
        const { latitude, longitude } = payload.new;
        if (latitude == null || !MAPA_ACOMPANHAMENTO) return;
        if (MARCADOR_ENTREGADOR_ACOMP) MARCADOR_ENTREGADOR_ACOMP.setLatLng([latitude, longitude]);
        else MARCADOR_ENTREGADOR_ACOMP = L.marker([latitude, longitude], { icon: iconeEntregador(entregador?.veiculo) }).addTo(MAPA_ACOMPANHAMENTO).bindPopup('Entregador');
      })
    .subscribe();
}

// ============================================================
// CANCELAMENTO DE PEDIDO PELO CLIENTE
// ============================================================
const MOTIVOS_CANCELAMENTO = ['Mudei de ideia', 'Pedido demorando demais', 'Fiz o pedido errado', 'Encontrei em outro lugar', 'Outro motivo'];
let MOTIVO_CANCELAMENTO_SELECIONADO = '';

function abrirCancelarPedido(pedidoId) {
  MOTIVO_CANCELAMENTO_SELECIONADO = '';
  document.getElementById('statusConteudo').innerHTML = `
    <h2 style="font-size:16px;margin-bottom:4px;">Cancelar pedido</h2>
    <p style="font-size:12.5px;color:var(--muted);margin-bottom:14px;">Por que você quer cancelar?</p>
    <div id="motivosLista">
      ${MOTIVOS_CANCELAMENTO.map(m => `<button class="motivo-btn" onclick="selecionarMotivoCancelamento(this)">${m}</button>`).join('')}
    </div>
    <textarea id="motivoOutroTexto" rows="2" class="hide" placeholder="Conte rapidinho o motivo…" style="margin-bottom:10px;"></textarea>
    <button class="btn-primario" id="btnConfirmarCancelamento" disabled onclick="confirmarCancelamento('${pedidoId}')"><span>Confirmar cancelamento</span><span>→</span></button>
    <button class="btn-secundario" onclick="abrirStatusPedido('${pedidoId}')">Voltar</button>
  `;
  abrirOverlay('overlayStatus');
}

function selecionarMotivoCancelamento(btnEl) {
  document.querySelectorAll('.motivo-btn').forEach(b => b.classList.remove('ativo'));
  btnEl.classList.add('ativo');
  MOTIVO_CANCELAMENTO_SELECIONADO = btnEl.textContent.trim();
  document.getElementById('motivoOutroTexto').classList.toggle('hide', MOTIVO_CANCELAMENTO_SELECIONADO !== 'Outro motivo');
  document.getElementById('btnConfirmarCancelamento').disabled = false;
}

async function confirmarCancelamento(pedidoId) {
  const motivo = MOTIVO_CANCELAMENTO_SELECIONADO === 'Outro motivo'
    ? (document.getElementById('motivoOutroTexto').value.trim() || 'Outro motivo')
    : MOTIVO_CANCELAMENTO_SELECIONADO;

  const btn = document.getElementById('btnConfirmarCancelamento');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Cancelando…';

  const { error } = await sb.rpc('cancelar_pedido', { p_pedido_id: pedidoId, p_motivo: motivo });
  if (error) {
    alert(error.message && error.message.includes('não pode mais')
      ? 'Seu pedido já entrou em preparo e não pode mais ser cancelado por aqui — fale com a loja.'
      : 'Não foi possível cancelar. Tente novamente.');
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Confirmar cancelamento';
    return;
  }
  abrirStatusPedido(pedidoId);
}

// ============================================================
// PUSH NOTIFICATIONS — inscrição do cliente
// ============================================================
function base64ParaUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Seguro = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(base64Seguro);
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

async function ativarPushCliente() {
  const btn = document.getElementById('btnAtivarPush');
  if (!CLIENTE_ATUAL_ID) return;
  try {
    btn.textContent = 'Ativando…';
    const registro = await navigator.serviceWorker.ready;
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
      cliente_id: CLIENTE_ATUAL_ID,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    }, { onConflict: 'endpoint' });
    btn.innerHTML = `${icon('bell', 16)} Notificações ativadas`;
    btn.disabled = true;
  } catch (err) {
    console.error(err);
    btn.innerHTML = `${icon('bell', 16)} Avisar quando o status mudar`;
    alert('Não foi possível ativar as notificações. Verifique a permissão do navegador.');
  }
}

// ============================================================
// HELPERS DE OVERLAY
// ============================================================
function abrirOverlay(id) { document.getElementById(id).classList.remove('hide'); }
function fecharOverlay(id) { document.getElementById(id).classList.add('hide'); }

// ============================================================
// PWA — registra service worker
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

iniciar();
