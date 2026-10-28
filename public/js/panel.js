function safeLogoUrl(value) {
  if (typeof value === 'string') {
    const v = value.trim();
    if (/^\/(?!\/)[a-zA-Z0-9_./-]+$/.test(v) && !v.includes('..')) return v;
    if (/^https?:\/\/[a-zA-Z0-9_.:/-]+$/.test(v)) return v;
    if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(v)) return v;
  }
  return '/assets/brand/chronos-bios.png';
}

const STATUS_LABELS = {
  recebido: 'Recebido',
  analise: 'Em análise',
  aguardando_aprovacao: 'Aguardando aprovação',
  aguardando: 'Aguardando peças',
  manutencao: 'Em manutenção',
  pronto: 'Pronto para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado'
};

const PART_STATUS_LABELS = {
  em_estoque: 'Em estoque',
  sob_encomenda: 'Sob encomenda',
  a_confirmar: 'A confirmar'
};

const QUOTE_STATUS_LABELS = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  convertido_os: 'Convertido em OS'
};

function fetchAdmin(url, options = {}) {
  options.credentials = 'same-origin';
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
    options.headers = { ...options.headers, 'Content-Type': 'application/json' };
    if (options.body === undefined) options.body = '{}';
  }
  options.headers = { ...options.headers, 'X-Bios-Request': '1' };
  return fetch(url, options).then(async response => {
    if (response.status === 401) {
      resetSession();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (response.status === 403) {
      const body = await response.clone().json().catch(() => ({}));
      if (body.code === 'PASSWORD_CHANGE_REQUIRED') showCredentials();
    }
    return response;
  });
}

const DB = {
  cache: { clients: [], services: [], orders: [], parts: [], quotes: [], settings: {}, suppliers: [], supplierOffers: [], supplierSettings: {} },
  get(key) { return this.cache[key] || (key === 'settings' || key === 'supplierSettings' ? {} : []); },
  set(key, val) { this.cache[key] = val; },
  async sync() {
    try {
      const [c, s, o, p, q, cfg, sups, offers, supCfg] = await Promise.all([
        fetchAdmin('/api/clients').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetchAdmin('/api/services').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetchAdmin('/api/orders').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetchAdmin('/api/parts').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetchAdmin('/api/quotes').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetchAdmin('/api/company-settings').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetchAdmin('/api/suppliers').then(r => r.ok ? r.json() : []).catch(() => []),
        fetchAdmin('/api/supplier-offers').then(r => r.ok ? r.json() : []).catch(() => []),
        fetchAdmin('/api/supplier-settings').then(r => r.ok ? r.json() : {}).catch(() => ({}))
      ]);
      this.cache.clients = c;
      this.cache.services = s;
      this.cache.orders = o;
      this.cache.parts = p;
      this.cache.quotes = q;
      this.cache.settings = cfg;
      this.cache.suppliers = sups;
      this.cache.supplierOffers = offers;
      this.cache.supplierSettings = supCfg;
      return true;
    } catch (e) {
      console.error('Erro ao sincronizar dados com o servidor:', e);
      showToast('Não foi possível atualizar os dados. Confira a conexão e os logs do servidor.', 'error');
      return false;
    }
  }
};

async function doLogin(event) {
  event.preventDefault();
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Bios-Request': '1' },
      body: JSON.stringify({
        username: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível autenticar.');
    await openSession(data);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function doLogout() {
  fetchAdmin('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .catch(() => {})
    .finally(resetSession);
}

function showPage(pageId) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    if (item.getAttribute('onclick')?.includes('"' + pageId + '"')) item.classList.add('active');
  });

  const titles = {
    dashboard: 'Dashboard',
    os: 'Ordens de Serviço',
    orcamentos: 'Orçamentos & Propostas Detalhadas',
    pecas: 'Catálogo de Peças & Componentes',
    clientes: 'Clientes',
    servicos: 'Catálogo de Serviços',
    financeiro: 'Financeiro',
    relatorios: 'Relatórios de Atendimento',
    configuracoes: 'Configurações do Sistema',
    fornecedores: 'Fornecedores & Monitoramento de Preços'
  };
  document.getElementById('pageTitle').textContent = titles[pageId] || 'Painel';

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');

  DB.sync().then(() => {
    if (pageId === 'dashboard') renderDashboard();
    if (pageId === 'os') renderOS();
    if (pageId === 'orcamentos') renderQuotes();
    if (pageId === 'pecas') renderParts();
    if (pageId === 'clientes') renderClients();
    if (pageId === 'servicos') renderServices();
    if (pageId === 'financeiro') renderFinance();
    if (pageId === 'relatorios') renderReports();
    if (pageId === 'configuracoes') renderConfig();
    if (pageId === 'fornecedores') renderSuppliers();
  });
}

function renderConfig() {
  const form = document.getElementById('credentialsForm');
  if (form) form.reset();
  const cfg = DB.get('settings') || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('cfgCompanyName', cfg.company_name);
  setVal('cfgTradeName', cfg.trade_name);
  setVal('cfgPhone', cfg.phone);
  setVal('cfgWhatsapp', cfg.whatsapp);
  setVal('cfgEmail', cfg.email);
  setVal('cfgLogoUrl', cfg.logo_url);
  setVal('cfgCity', cfg.city);
  setVal('cfgAddress', cfg.address);
  setVal('cfgDefaultValidity', cfg.default_validity_days || '7');
  setVal('cfgDefaultDelivery', cfg.default_delivery_time);
  setVal('cfgDefaultPayment', cfg.default_payment_terms);
  setVal('cfgWarranty', cfg.warranty_terms);
}

async function saveCompanySettings(e) {
  e.preventDefault();
  const payload = {
    company_name: document.getElementById('cfgCompanyName').value.trim(),
    trade_name: document.getElementById('cfgTradeName').value.trim(),
    phone: document.getElementById('cfgPhone').value.trim(),
    whatsapp: document.getElementById('cfgWhatsapp').value.trim(),
    email: document.getElementById('cfgEmail').value.trim(),
    logo_url: document.getElementById('cfgLogoUrl').value.trim(),
    city: document.getElementById('cfgCity').value.trim(),
    address: document.getElementById('cfgAddress').value.trim(),
    default_validity_days: document.getElementById('cfgDefaultValidity').value.trim(),
    default_delivery_time: document.getElementById('cfgDefaultDelivery').value.trim(),
    default_payment_terms: document.getElementById('cfgDefaultPayment').value.trim(),
    warranty_terms: document.getElementById('cfgWarranty').value.trim()
  };

  try {
    const res = await fetchAdmin('/api/company-settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erro ao salvar configurações.');
    }
    showToast('Dados comerciais e identidade da empresa atualizados com sucesso!');
    await DB.sync();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateCredentials(e) {
  e.preventDefault();
  const currentUsername = document.getElementById('credCurrentUsername').value;
  const currentPassword = document.getElementById('credCurrentPassword').value;
  const newUsername = document.getElementById('credNewUsername').value;
  const newPassword = document.getElementById('credNewPassword').value;

  if (newPassword.length < 12) {
    return showToast('A nova senha deve ter pelo menos 12 caracteres.', 'error');
  }

  fetchAdmin('/api/admin/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentUsername, currentPassword, newUsername, newPassword })
  })
    .then(res => res.ok ? res.json() : res.json().then(b => { throw new Error(b.error || 'Erro ao atualizar.'); }))
    .then(() => {
      showToast('Credenciais alteradas com sucesso! Faça login novamente.', 'success');
      setTimeout(resetSession, 1200);
    })
    .catch(err => showToast(err.message, 'error'));
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('active');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  if (value.includes('/')) return value.split(' às ')[0];
  const d = new Date(value.length === 10 ? value + 'T12:00:00' : value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function formatCurrency(val) {
  return 'R$ ' + parseFloat(val || 0).toFixed(2).replace('.', ',');
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function getStatusBadge(status) {
  const cls = 'badge-' + (status || 'recebido');
  return '<span class="badge ' + cls + '">' + escapeHtml(getStatusLabel(status)) + '</span>';
}

function getQuoteBadge(order) {
  if (order.quoteEnabled && order.approvedVersion === order.quoteVersion) {
    return '<span class="badge badge-approved" title="Orçamento aprovado pelo cliente">✓ Orçamento v' + order.quoteVersion + ' aprovado</span>';
  }
  if (order.quoteEnabled) {
    return '<span class="badge badge-aguardando_aprovacao" title="Orçamento enviado ao cliente, aguardando aprovação">Aguardando aprovação (v' + order.quoteVersion + ')</span>';
  }
  return '<span class="badge badge-muted">Sem orçamento</span>';
}

function getPayStatusBadge(status) {
  const config = {
    pendente: ['badge-warning', 'Pendente'],
    pago: ['badge-success', 'Pago'],
    cancelado: ['badge-danger', 'Cancelado']
  }[status] || ['badge-muted', status || 'Pendente'];
  return '<span class="badge ' + config[0] + '">' + escapeHtml(config[1]) + '</span>';
}

function getPayMethodLabel(method) {
  return {
    dinheiro: 'Dinheiro',
    pix: 'PIX',
    cartao_credito: 'Cartão de Crédito',
    cartao_debito: 'Cartão de Débito',
    boleto: 'Boleto',
    transferencia: 'Transferência'
  }[method] || method || '—';
}

function getClientName(clientId) {
  const c = DB.get('clients').find(x => x.id === clientId);
  return c ? c.name : 'Cliente removido';
}

function getClientPhone(clientId) {
  const c = DB.get('clients').find(x => x.id === clientId);
  return c ? c.phone : '—';
}

function getServiceName(serviceId) {
  const s = DB.get('services').find(x => x.id === serviceId);
  return s ? s.name : 'Serviço removido';
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.className = 'toast ' + type;
  document.getElementById('toastMessage').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function closeModal(event, overlayId) {
  if (event.target === event.currentTarget) closeModalDirect(overlayId);
}

function closeModalDirect(overlayId) {
  const el = document.getElementById(overlayId);
  if (el) el.classList.remove('active');
}

function openModal(overlayId) {
  const el = document.getElementById(overlayId);
  if (el) el.classList.add('active');
}

/* ==========================================================================
   Render Dashboard
   ========================================================================== */
function renderDashboard() {
  const orders = DB.get('orders') || [];
  const clients = DB.get('clients') || [];

  // 1. OS em Andamento (não concluídas/canceladas)
  const inProgress = orders.filter(o => ['recebido', 'analise', 'aguardando', 'manutencao'].includes(o.status)).length;
  // 2. Aguardando Aprovação (específico para orçamentos aguardando resposta)
  const awaitingApproval = orders.filter(o => o.status === 'aguardando_aprovacao' || (o.quoteEnabled && o.approvedVersion !== o.quoteVersion && o.status !== 'cancelado')).length;
  // 3. Prontas para Entrega
  const ready = orders.filter(o => o.status === 'pronto').length;
  // 4. Entregues / Concluídas
  const delivered = orders.filter(o => o.status === 'entregue').length;

  const elPendentes = document.getElementById('dashPendentes');
  if (elPendentes) elPendentes.textContent = inProgress;

  const elAguardando = document.getElementById('dashAguardandoAprovacao');
  if (elAguardando) elAguardando.textContent = awaitingApproval;

  const elProntas = document.getElementById('dashProntas');
  if (elProntas) elProntas.textContent = ready;

  const elEntregues = document.getElementById('dashEntregues');
  if (elEntregues) elEntregues.textContent = delivered;

  const elClientesSub = document.getElementById('dashClientesSub');
  if (elClientesSub) elClientesSub.textContent = `Total de clientes cadastrados: ${clients.length}`;

  // Gráfico de distribuição
  const counts = { recebido: 0, analise: 0, aguardando_aprovacao: 0, aguardando: 0, manutencao: 0, pronto: 0 };
  orders.forEach(o => { if (counts[o.status] !== undefined) counts[o.status]++; });
  const total = orders.length || 1;

  [
    ['Recebido', counts.recebido],
    ['Analise', counts.analise],
    ['AguardandoAprovacao', counts.aguardando_aprovacao],
    ['Aguardando', counts.aguardando],
    ['Manutencao', counts.manutencao],
    ['Pronto', counts.pronto]
  ].forEach(([key, cnt]) => {
    const textEl = document.getElementById('chart' + key);
    const barEl = document.getElementById('bar' + key);
    if (textEl) textEl.textContent = cnt;
    if (barEl) barEl.style.width = ((cnt / total) * 100) + '%';
  });

  // Tabela de OS Recentes
  const tbody = document.querySelector('#dashOSTable tbody');
  const recent = [...orders].sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, 6);
  if (tbody) {
    tbody.innerHTML = recent.length
      ? recent.map(o => `
        <tr>
          <td>
            <strong style="color:var(--accent);cursor:pointer;display:block" onclick="viewOS('${escapeHtml(o.id)}')">${escapeHtml(o.publicCode || o.id)}</strong>
            <div style="font-size:0.72rem;color:var(--muted)">${escapeHtml(o.id)}</div>
          </td>
          <td>${escapeHtml(getClientName(o.clientId))}</td>
          <td>${escapeHtml(o.device)}</td>
          <td>${getStatusBadge(o.status)}</td>
          <td>${formatDate(o.created)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="empty-state"><p>Nenhuma ordem de serviço cadastrada.</p></td></tr>';
  }
}

/* ==========================================================================
   Render Ordens de Serviço
   ========================================================================== */
function renderOS() {
  const orders = DB.get('orders') || [];
  const query = (document.getElementById('osSearch')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('osFilterStatus')?.value || '';
  const tbody = document.querySelector('#osTable tbody');
  if (!tbody) return;

  let list = orders;
  if (query) {
    list = list.filter(o => {
      const haystack = (o.id + ' ' + (o.publicCode || '') + ' ' + getClientName(o.clientId) + ' ' + o.device + ' ' + (o.brand || '') + ' ' + (o.problem || '')).toLowerCase();
      return haystack.includes(query);
    });
  }
  if (filter) {
    list = list.filter(o => o.status === filter);
  }

  list = list.sort((a, b) => new Date(b.created) - new Date(a.created));

  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <h4>Nenhuma Ordem de Serviço encontrada</h4>
          <p>${query || filter ? 'Tente ajustar os filtros ou a busca acima.' : 'Cadastre sua primeira OS pelo botão acima.'}</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(o => `
    <tr>
      <td>
        <strong style="color:var(--accent);cursor:pointer;font-size:0.95rem;display:block" onclick="viewOS('${escapeHtml(o.id)}')">${escapeHtml(o.publicCode || o.id)}</strong>
        <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(o.id)}</div>
      </td>
      <td>
        <strong>${escapeHtml(getClientName(o.clientId))}</strong>
        <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(getClientPhone(o.clientId))}</div>
      </td>
      <td>
        ${escapeHtml(o.device)}
        <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(o.brand || 'Sem marca')}</div>
      </td>
      <td>${escapeHtml(getServiceName(o.serviceId))}</td>
      <td>${getStatusBadge(o.status)}</td>
      <td>${getQuoteBadge(o)}</td>
      <td>${getPayStatusBadge(o.payStatus)}</td>
      <td>${formatDate(o.created)}</td>
      <td><strong>${formatCurrency(o.value)}</strong></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="viewOS('${escapeHtml(o.id)}')" title="Ver detalhes da OS">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="editOS('${escapeHtml(o.id)}')" title="Editar OS">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteOS('${escapeHtml(o.id)}')" title="Excluir OS" style="color:var(--danger)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function filterOS() {
  renderOS();
}

function openOSModal() {
  document.getElementById('osForm').reset();
  document.getElementById('osId').value = '';
  document.getElementById('osModalTitle').textContent = 'Nova Ordem de Serviço';
  populateClientSelect();
  populateServiceSelect();
  openModal('osModalOverlay');
}

function populateClientSelect() {
  const el = document.getElementById('osClientId');
  const clients = DB.get('clients') || [];
  el.innerHTML = '<option value="">Selecione um cliente...</option>' +
    clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${escapeHtml(c.phone)})</option>`).join('');
}

function populateServiceSelect() {
  const el = document.getElementById('osService');
  const services = DB.get('services') || [];
  el.innerHTML = '<option value="">Selecione...</option>' +
    services.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${formatCurrency(s.price)}</option>`).join('');
}

function saveOS(event) {
  event.preventDefault();
  const id = document.getElementById('osId').value;
  const payload = {
    clientId: document.getElementById('osClientId').value,
    device: document.getElementById('osDevice').value,
    brand: document.getElementById('osBrand').value,
    serviceId: document.getElementById('osService').value,
    status: document.getElementById('osStatus').value,
    value: parseFloat(document.getElementById('osValue').value) || 0,
    problem: document.getElementById('osProblem').value,
    solution: document.getElementById('osSolution').value,
    payStatus: document.getElementById('osPayStatus').value,
    payMethod: document.getElementById('osPayMethod').value,
    dueDate: document.getElementById('osDueDate').value,
    payDate: document.getElementById('osPayDate').value,
    payObs: id ? (DB.get('orders').find(o => o.id === id)?.payObs || '') : ''
  };

  if (!payload.clientId || !payload.device || !payload.serviceId) {
    return showToast('Preencha os campos obrigatórios (Cliente, Equipamento e Serviço).', 'error');
  }

  fetchAdmin(id ? `/api/orders/${encodeURIComponent(id)}` : '/api/orders', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => {
      if (!r.ok) throw new Error('Falha ao salvar a Ordem de Serviço.');
      return r.json();
    })
    .then(() => {
      closeModalDirect('osModalOverlay');
      DB.sync().then(() => {
        renderOS();
        renderDashboard();
        renderFinance();
        showToast(id ? 'OS atualizada com sucesso!' : 'OS cadastrada com sucesso!', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

function editOS(id) {
  const order = DB.get('orders').find(o => o.id === id);
  if (!order) return;
  document.getElementById('osId').value = order.id;
  document.getElementById('osModalTitle').textContent = 'Editar OS ' + order.id;
  populateClientSelect();
  populateServiceSelect();
  document.getElementById('osClientId').value = order.clientId;
  document.getElementById('osDevice').value = order.device;
  document.getElementById('osBrand').value = order.brand || '';
  document.getElementById('osService').value = order.serviceId;
  document.getElementById('osStatus').value = order.status;
  document.getElementById('osValue').value = order.value || '';
  document.getElementById('osProblem').value = order.problem || '';
  document.getElementById('osSolution').value = order.solution || '';
  document.getElementById('osPayStatus').value = order.payStatus || 'pendente';
  document.getElementById('osPayMethod').value = order.payMethod || '';
  document.getElementById('osDueDate').value = order.dueDate || '';
  document.getElementById('osPayDate').value = order.payDate || '';
  openModal('osModalOverlay');
}

function deleteOS(id) {
  if (!confirm(`Tem certeza que deseja excluir a OS ${id}? Esta ação não pode ser desfeita.`)) return;
  fetchAdmin(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(r => {
      if (!r.ok) throw new Error('Não foi possível excluir a OS.');
      return r.json();
    })
    .then(() => {
      DB.sync().then(() => {
        renderOS();
        renderDashboard();
        renderFinance();
        showToast('OS excluída com sucesso.', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

/* ==========================================================================
   Visualização Detalhada da OS (viewOS)
   ========================================================================== */
let currentViewOSId = '';

function trackingLink(order) {
  return location.origin + '/acompanhar#' + order.trackingToken;
}

function viewOS(id) {
  currentViewOSId = id;
  const order = DB.get('orders').find(o => o.id === id);
  if (!order) return;

  const client = DB.get('clients').find(c => c.id === order.clientId);
  const service = DB.get('services').find(s => s.id === order.serviceId);

  document.getElementById('viewOSTitle').textContent = `OS ${order.publicCode || order.id} (${order.id}) · ${order.device}`;

  // Etapas visuais
  const steps = ['recebido', 'analise', 'aguardando_aprovacao', 'aguardando', 'manutencao', 'pronto', 'entregue'];
  let stepsHtml = '<div class="os-steps">';
  steps.forEach((st, idx) => {
    const isDone = steps.indexOf(order.status) > idx;
    const isCurrent = order.status === st;
    stepsHtml += `
      <div class="os-step-item ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}" onclick="quickStatusChange('${escapeHtml(id)}','${escapeHtml(st)}')">
        <div class="os-step-dot">${isDone ? '✓' : (idx + 1)}</div>
        <span class="os-step-label">${escapeHtml(getStatusLabel(st))}</span>
      </div>
    `;
  });
  stepsHtml += '</div>';

  // Banner do Orçamento (status da aprovação vs status da OS)
  let quoteBanner = '';
  if (order.quoteId) {
    const linkedQ = (DB.get('quotes') || []).find(q => q.id === order.quoteId);
    quoteBanner = `
      <div class="quote-banner approved" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>📋 Orçamento Detalhado Vinculado: <strong>${escapeHtml(linkedQ?.publicCode || order.quoteId)}</strong> (${formatCurrency(order.value)})</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeModalDirect('viewOSModalOverlay');viewQuote('${escapeHtml(order.quoteId)}')" style="background:#132219;border-color:var(--accent-border);color:var(--accent)">
          Ver Orçamento Detalhado ↗
        </button>
      </div>
    `;
  } else if (order.quoteEnabled && order.approvedVersion === order.quoteVersion) {
    quoteBanner = `<div class="quote-banner approved"><span>✓ Orçamento versão ${order.quoteVersion} aprovado pelo cliente (${formatCurrency(order.value)})</span></div>`;
  } else if (order.quoteEnabled) {
    quoteBanner = `<div class="quote-banner pending"><span>⏳ Orçamento versão ${order.quoteVersion} publicado (${formatCurrency(order.value)}) — aguardando aprovação do cliente</span></div>`;
  } else {
    quoteBanner = `<div class="quote-banner disabled"><span>Nenhum orçamento ativo publicado. Clique em "Publicar orçamento" abaixo para emitir ao cliente.</span></div>`;
  }

  // Grid com dados principais
  const gridHtml = `
    <div class="os-view-grid">
      <div class="os-view-cell">
        <div class="os-view-cell-label">Cliente</div>
        <div class="os-view-cell-val">${escapeHtml(client?.name || 'Não informado')}</div>
        <div class="os-view-cell-sub">Telefone: ${escapeHtml(client?.phone || '—')}</div>
        <div class="os-view-cell-sub">${escapeHtml(client?.city || '')} ${client?.neighborhood ? '· ' + escapeHtml(client.neighborhood) : ''}</div>
      </div>
      <div class="os-view-cell">
        <div class="os-view-cell-label">Equipamento</div>
        <div class="os-view-cell-val">${escapeHtml(order.device)}</div>
        <div class="os-view-cell-sub">Marca: ${escapeHtml(order.brand || 'Não informada')}</div>
        <div class="os-view-cell-sub">Status: <strong>${escapeHtml(getStatusLabel(order.status))}</strong></div>
      </div>
      <div class="os-view-cell">
        <div class="os-view-cell-label">Serviço & Valor</div>
        <div class="os-view-cell-val">${escapeHtml(service?.name || 'Serviço personalizado')}</div>
        <div class="os-view-cell-sub">Valor Atual: <strong>${formatCurrency(order.value)}</strong></div>
      </div>
      <div class="os-view-cell">
        <div class="os-view-cell-label">Prazos & Financeiro</div>
        <div class="os-view-cell-sub">Entrada: <strong>${formatDate(order.created)}</strong></div>
        <div class="os-view-cell-sub">Previsão: <strong>${formatDate(order.dueDate)}</strong></div>
        <div class="os-view-cell-sub">Pagamento: ${getPayStatusBadge(order.payStatus)} (${escapeHtml(getPayMethodLabel(order.payMethod))})</div>
      </div>
    </div>

    <div class="os-view-block">
      <div class="os-view-cell-label">Defeito Relatado pelo Cliente</div>
      <div style="font-size:0.92rem;line-height:1.6">${escapeHtml(order.problem || 'Não informado')}</div>
    </div>

    ${order.solution ? `
      <div class="os-view-block">
        <div class="os-view-cell-label">Solução / Registro Técnico Interno</div>
        <div style="font-size:0.92rem;line-height:1.6;color:var(--text)">${escapeHtml(order.solution)}</div>
      </div>
    ` : ''}
  `;

  // Bloco de Rastreio e Orçamento
  const trackingSection = `
    <div class="tracking-tools">
      <h4>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Link Exclusivo de Acompanhamento do Cliente
      </h4>
      <p class="security-note">O cliente consulta o status e aprova o orçamento por este link sem expor dados confidenciais ou número sequencial da OS.</p>
      <input id="trackingLinkInput" readonly value="${trackingLink(order)}" aria-label="Link exclusivo de rastreio">
      
      <div class="tool-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="btnCopyTracking">
          Copiar Link
        </button>
        <button type="button" class="btn btn-whatsapp btn-sm" onclick="sendOSWhatsApp()">
          Enviar por WhatsApp ↗
        </button>
        <button type="button" class="btn btn-ghost btn-sm" id="btnRotateTracking" style="color:var(--danger)">
          Invalidar Link Anterior (Gerar Novo)
        </button>
      </div>

      <div class="quote-box">
        <h4>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Orçamento para Aprovação do Cliente
        </h4>
        <p class="security-note">Descreva detalhadamente peças, mão de obra, condições de garantia e prazos. Esta descrição será exibida diretamente na página do cliente.</p>
        
        <form id="quoteFormModal">
          <div class="form-group">
            <label for="quoteDescInput">Descrição dos Itens, Peças e Mão de Obra *</label>
            <textarea id="quoteDescInput" required maxlength="4000" rows="4" placeholder="Ex: Mão de obra para troca de tela e limpeza R$ 120,00 + Tela nova original R$ 250,00. Garantia de 90 dias.">${escapeHtml(order.quoteDescription || '')}</textarea>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-end;margin-top:10px;flex-wrap:wrap">
            <div class="form-group" style="min-width:180px">
              <label for="quoteValInput">Valor Total do Orçamento (R$) *</label>
              <input id="quoteValInput" type="number" min="0" max="9999999" step="0.01" required value="${order.value || 0}">
            </div>
            <button class="btn btn-primary" type="submit" style="height:42px">
              Publicar Orçamento para Aprovação ↗
            </button>
          </div>
        </form>
      </div>

      <div id="osTimelineBox" style="margin-top:var(--space-md)"></div>
    </div>
  `;

  document.getElementById('viewOSBody').innerHTML = stepsHtml + quoteBanner + gridHtml + trackingSection;

  // Listeners do Modal
  document.getElementById('btnCopyTracking').onclick = async () => {
    try {
      await navigator.clipboard.writeText(trackingLink(order));
      showToast('Link de acompanhamento copiado!', 'success');
    } catch {
      document.getElementById('trackingLinkInput').select();
      showToast('Selecione e copie o link destacado.', 'info');
    }
  };

  document.getElementById('btnRotateTracking').onclick = async () => {
    if (!confirm('Atenção: O link anterior deixará de funcionar imediatamente. Será necessário enviar o novo link ao cliente. Confirmar rotação?')) return;
    try {
      const res = await fetchAdmin(`/api/orders/${encodeURIComponent(id)}/rotate-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!res.ok) throw new Error('Não foi possível invalidar o link.');
      await DB.sync();
      viewOS(id);
      showToast('Novo link gerado com sucesso! O anterior foi invalidado.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('quoteFormModal').onsubmit = async (e) => {
    e.preventDefault();
    const desc = document.getElementById('quoteDescInput').value;
    const val = Number(document.getElementById('quoteValInput').value);

    if (!confirm('Publicar este orçamento e solicitar aprovação do cliente? O status mudará para "Aguardando aprovação".')) return;

    try {
      const res = await fetchAdmin(`/api/orders/${encodeURIComponent(id)}/quote`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, value: val })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao publicar orçamento.');
      await DB.sync();
      viewOS(id);
      renderAll();
      showToast('Orçamento publicado! Envie o link ao cliente para aprovação.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Carregar histórico e aprovações
  fetchAdmin(`/api/orders/${encodeURIComponent(id)}/history`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || currentViewOSId !== id) return;
      const box = document.getElementById('osTimelineBox');
      if (!box) return;

      let historyHtml = '<h4>Histórico de Eventos & Aprovações</h4><div class="timeline">';
      
      if (data.approvals?.length) {
        data.approvals.forEach(app => {
          historyHtml += `
            <div class="timeline-item approval">
              <span class="timeline-time">${new Date(app.created).toLocaleString('pt-BR')}</span>
              <strong style="color:var(--accent)">✓ Aprovação Registrada (Versão ${app.version})</strong> — ${formatCurrency(app.value)}
              <div style="font-size:0.78rem;color:var(--muted);margin-top:2px">${escapeHtml(app.description)}</div>
            </div>
          `;
        });
      }

      if (data.events?.length) {
        data.events.forEach(ev => {
          historyHtml += `
            <div class="timeline-item">
              <span class="timeline-time">${new Date(ev.created).toLocaleString('pt-BR')}</span>
              <strong>${escapeHtml(getStatusLabel(ev.status))}</strong> por <em>${escapeHtml(ev.actor || 'sistema')}</em>
            </div>
          `;
        });
      }

      historyHtml += '</div>';
      box.innerHTML = historyHtml;
    })
    .catch(() => {});

  document.getElementById('viewOSEditBtn').onclick = () => {
    closeModalDirect('viewOSModalOverlay');
    editOS(id);
  };

  openModal('viewOSModalOverlay');
}

function quickStatusChange(id, newStatus) {
  const order = DB.get('orders').find(o => o.id === id);
  if (!order) return;
  const payload = { ...order, status: newStatus };

  fetchAdmin(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => {
      if (!r.ok) throw new Error('Não foi possível alterar o status.');
      return r.json();
    })
    .then(() => {
      DB.sync().then(() => {
        viewOS(id);
        renderOS();
        renderDashboard();
        showToast(`Status atualizado para: ${getStatusLabel(newStatus)}`, 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

/* ==========================================================================
   Envio Manual por WhatsApp
   ========================================================================== */
function sendOSWhatsApp() {
  const order = DB.get('orders').find(o => o.id === currentViewOSId);
  if (!order) return;
  const client = DB.get('clients').find(c => c.id === order.clientId);
  if (!client) return;

  let phone = client.phone.replace(/\D/g, '');
  if (phone.length === 10 || phone.length === 11) phone = '55' + phone;
  if (!/^55\d{10,11}$/.test(phone)) {
    return showToast('Confira o telefone do cliente com DDD (deve conter 10 ou 11 dígitos).', 'error');
  }

  const osLabel = order.publicCode ? `${order.publicCode} (${order.id})` : order.id;
  const msg = `Olá, ${client.name}! Aqui é da Bios Informática.\n\nOS: ${osLabel} · ${order.device}\nStatus: ${getStatusLabel(order.status)}\n\nAcompanhe os detalhes e aprove seu orçamento pelo link exclusivo:\n${trackingLink(order)}\n\nGuarde este link para acompanhar o andamento. Qualquer dúvida, estamos à disposição!`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}

/* ==========================================================================
   Impressão Própria para Papel (Fundo Branco, A4)
   ========================================================================== */
function printOS() {
  printDocument(false);
}

function printNF() {
  printDocument(true);
}

function printDocument(isReceipt) {
  const order = DB.get('orders').find(o => o.id === currentViewOSId);
  if (!order) return;
  const client = DB.get('clients').find(c => c.id === order.clientId);
  const service = DB.get('services').find(s => s.id === order.serviceId);

  const popup = window.open('', '_blank');
  if (!popup) return showToast('Permita a abertura de janelas pop-up para impressão.', 'error');

  const title = isReceipt ? 'COMPROVANTE DE ENTREGA E PAGAMENTO' : 'ORDEM DE SERVIÇO';

  popup.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${title} · OS ${escapeHtml(order.publicCode || order.id)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: #ffffff !important;
      color: #111111 !important;
      line-height: 1.45;
      font-size: 13px;
      padding: 15px;
    }
    .print-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #222;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .brand-box h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.03em; }
    .brand-box p { font-size: 11px; color: #555; }
    .os-badge {
      text-align: right;
    }
    .os-badge .num { font-size: 20px; font-weight: 800; color: #111; letter-spacing: -0.02em; }
    .os-badge .sub { font-size: 11px; color: #666; font-weight: 600; margin-bottom: 2px; }
    .os-badge .date { font-size: 11px; color: #666; }
    .doc-title {
      font-size: 14px;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 14px;
      padding: 6px 10px;
      background: #f1f3f2;
      border-left: 4px solid #172321;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .card-print {
      border: 1px solid #dcdcdc;
      border-radius: 4px;
      padding: 10px 12px;
    }
    .card-print h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #444;
      border-bottom: 1px solid #eee;
      padding-bottom: 4px;
      margin-bottom: 8px;
    }
    .row { display: flex; margin-bottom: 4px; }
    .row .label { width: 110px; font-weight: 600; color: #555; font-size: 12px; }
    .row .val { flex: 1; color: #111; font-size: 12px; }
    .quote-box-print {
      border: 1px solid #dcdcdc;
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 14px;
      background: #fafafa;
    }
    .quote-box-print h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #333;
      margin-bottom: 6px;
    }
    .quote-desc { white-space: pre-wrap; font-size: 12px; line-height: 1.5; color: #222; }
    .total-line {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 15px;
      font-size: 15px;
      border-top: 1px solid #ddd;
      padding-top: 8px;
      margin-top: 8px;
    }
    .disclaimer {
      font-size: 10px;
      color: #666;
      border-top: 1px dashed #ccc;
      padding-top: 10px;
      margin-top: 20px;
      line-height: 1.4;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 45px;
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #444;
      padding-top: 6px;
      font-size: 11px;
      color: #333;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="brand-box">
      <img src="${escapeHtml(safeLogoUrl((DB.get('settings') || {}).logo_url))}" alt="Bios Informática" width="64" height="70" style="object-fit:contain;float:left;margin-right:12px">
      <h1>Bios Informática</h1>
      <p>Manutenção de Computadores & Notebooks · Santos e Guarujá</p>
      <p>WhatsApp: (13) 99622-2130 · biosinformatica.store</p>
    </div>
    <div class="os-badge">
      <div class="num">${escapeHtml(order.publicCode || order.id)}</div>
      <div class="date">Emissão: ${new Date().toLocaleDateString('pt-BR')}</div>
    </div>
  </div>

  <div class="doc-title">${title}</div>

  <div class="grid-2">
    <div class="card-print">
      <h3>Dados do Cliente</h3>
      <div class="row"><span class="label">Nome:</span><span class="val"><strong>${escapeHtml(client?.name || '—')}</strong></span></div>
      <div class="row"><span class="label">Telefone:</span><span class="val">${escapeHtml(client?.phone || '—')}</span></div>
      <div class="row"><span class="label">Cidade/Bairro:</span><span class="val">${escapeHtml(client?.city || '—')} ${client?.neighborhood ? '· ' + escapeHtml(client.neighborhood) : ''}</span></div>
      <div class="row"><span class="label">Documento:</span><span class="val">${escapeHtml(client?.doc || '—')}</span></div>
    </div>
    <div class="card-print">
      <h3>Dados do Equipamento</h3>
      <div class="row"><span class="label">Equipamento:</span><span class="val"><strong>${escapeHtml(order.device)}</strong></span></div>
      <div class="row"><span class="label">Marca:</span><span class="val">${escapeHtml(order.brand || '—')}</span></div>
      <div class="row"><span class="label">Data Entrada:</span><span class="val">${formatDate(order.created)}</span></div>
      <div class="row"><span class="label">Status Atual:</span><span class="val">${escapeHtml(getStatusLabel(order.status))}</span></div>
    </div>
  </div>

  <div class="card-print" style="margin-bottom:14px">
    <h3>Defeito / Relato do Cliente</h3>
    <div style="font-size:12px;white-space:pre-wrap">${escapeHtml(order.problem || 'Não informado')}</div>
  </div>

  ${order.solution ? `
    <div class="card-print" style="margin-bottom:14px">
      <h3>Serviço Realizado / Laudo Técnico</h3>
      <div style="font-size:12px;white-space:pre-wrap">${escapeHtml(order.solution)}</div>
    </div>
  ` : ''}

  <div class="quote-box-print">
    <h3>Orçamento & Condições</h3>
    <div class="quote-desc">${escapeHtml(order.quoteDescription || service?.name || 'Serviço prestado')}</div>
    ${order.approvedVersion ? `<div style="font-size:11px;color:#1e4620;font-weight:bold;margin-top:6px">✓ Orçamento aprovado na versão ${order.approvedVersion}</div>` : ''}
    <div class="total-line">
      <span>Situação do Pagamento: <strong>${order.payStatus === 'pago' ? 'PAGO' : order.payStatus === 'cancelado' ? 'CANCELADO' : 'PENDENTE'}</strong></span>
      <span>Total: <strong>${formatCurrency(order.value)}</strong></span>
    </div>
  </div>

  <p class="disclaimer">
    Este documento é um registro de controle técnico e comprovação de atendimento emitido pela Bios Informática.
    Não substitui documento fiscal. Garantia legal de 90 dias referente aos serviços executados conforme artigo 26 do Código de Defesa do Consumidor, não cobrindo mau uso, quedas ou intervenções de terceiros.
  </p>

  <div class="signatures">
    <div class="sig-line">Bios Informática (Técnico Responsável)</div>
    <div class="sig-line">Cliente: ${escapeHtml(client?.name || '')}</div>
  </div>
</body>
</html>`);

  popup.document.close();
  setTimeout(() => popup.print(), 350);
}

/* ==========================================================================
   Clientes CRUD
   ========================================================================== */
function renderClients() {
  const clients = DB.get('clients') || [];
  const query = (document.getElementById('clientSearch')?.value || '').toLowerCase().trim();
  const orders = DB.get('orders') || [];
  const tbody = document.querySelector('#clientTable tbody');
  if (!tbody) return;

  let list = clients;
  if (query) {
    list = list.filter(c => (c.name + ' ' + c.phone + ' ' + (c.email || '') + ' ' + (c.city || '')).toLowerCase().includes(query));
  }
  list = list.sort((a, b) => a.name.localeCompare(b.name));

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Nenhum cliente cadastrado.</p></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(c => {
    const activeOrders = orders.filter(o => o.clientId === c.id && !['pronto', 'entregue', 'cancelado'].includes(o.status)).length;
    return `
      <tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td>${escapeHtml(c.city || '—')}</td>
        <td>${activeOrders > 0 ? `<span class="badge badge-warning">${activeOrders} ativa(s)</span>` : '<span class="badge badge-muted">Nenhuma</span>'}</td>
        <td style="text-align:right">
          <button class="btn btn-ghost btn-sm" onclick="editClient('${escapeHtml(c.id)}')" title="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="deleteClient('${escapeHtml(c.id)}')" title="Excluir" style="color:var(--danger)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterClients() {
  renderClients();
}

function openClientModal() {
  document.getElementById('clientForm').reset();
  document.getElementById('clientId').value = '';
  document.getElementById('clientModalTitle').textContent = 'Novo Cliente';
  openModal('clientModalOverlay');
}

function saveClient(e) {
  e.preventDefault();
  const id = document.getElementById('clientId').value;
  const payload = {
    name: document.getElementById('clientName').value,
    phone: document.getElementById('clientPhone').value,
    email: document.getElementById('clientEmail').value,
    doc: document.getElementById('clientDoc').value,
    city: document.getElementById('clientCity').value,
    neighborhood: document.getElementById('clientNeighborhood').value,
    address: document.getElementById('clientAddress').value,
    obs: document.getElementById('clientObs').value
  };

  if (!payload.name || !payload.phone) return showToast('Nome e Telefone são obrigatórios.', 'error');

  fetchAdmin(id ? `/api/clients/${encodeURIComponent(id)}` : '/api/clients', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => {
      if (!r.ok) throw new Error('Não foi possível salvar o cliente.');
      return r.json();
    })
    .then(() => {
      closeModalDirect('clientModalOverlay');
      DB.sync().then(() => {
        renderClients();
        renderDashboard();
        populateClientSelect();
        showToast(id ? 'Cliente atualizado!' : 'Cliente cadastrado com sucesso!', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

function editClient(id) {
  const c = DB.get('clients').find(x => x.id === id);
  if (!c) return;
  document.getElementById('clientId').value = c.id;
  document.getElementById('clientModalTitle').textContent = 'Editar Cliente';
  document.getElementById('clientName').value = c.name;
  document.getElementById('clientPhone').value = c.phone;
  document.getElementById('clientEmail').value = c.email || '';
  document.getElementById('clientDoc').value = c.doc || '';
  document.getElementById('clientCity').value = c.city || '';
  document.getElementById('clientNeighborhood').value = c.neighborhood || '';
  document.getElementById('clientAddress').value = c.address || '';
  document.getElementById('clientObs').value = c.obs || '';
  openModal('clientModalOverlay');
}

function deleteClient(id) {
  const hasOrders = (DB.get('orders') || []).some(o => o.clientId === id);
  if (hasOrders) return showToast('Este cliente possui Ordens de Serviço vinculadas. Exclua as OS primeiro.', 'error');
  if (!confirm('Deseja excluir este cliente permanentemente?')) return;

  fetchAdmin(`/api/clients/${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(r => {
      if (!r.ok) throw new Error('Erro ao excluir cliente.');
      return r.json();
    })
    .then(() => {
      DB.sync().then(() => {
        renderClients();
        renderDashboard();
        populateClientSelect();
        showToast('Cliente excluído com sucesso.', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

/* ==========================================================================
   Serviços CRUD
   ========================================================================== */
function renderServices() {
  const services = DB.get('services') || [];
  const tbody = document.querySelector('#serviceTable tbody');
  if (!tbody) return;

  if (!services.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Nenhum serviço cadastrado.</p></td></tr>';
    return;
  }

  tbody.innerHTML = services.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td><span class="badge badge-info">${escapeHtml(s.category)}</span></td>
      <td style="color:var(--muted)">${escapeHtml(s.desc || '—')}</td>
      <td><strong>${formatCurrency(s.price)}</strong></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="editService('${escapeHtml(s.id)}')" title="Editar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteService('${escapeHtml(s.id)}')" title="Excluir" style="color:var(--danger)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function openServiceModal() {
  document.getElementById('serviceForm').reset();
  document.getElementById('serviceId').value = '';
  document.getElementById('serviceModalTitle').textContent = 'Novo Serviço';
  openModal('serviceModalOverlay');
}

function saveService(e) {
  e.preventDefault();
  const id = document.getElementById('serviceId').value;
  const payload = {
    name: document.getElementById('serviceName').value,
    category: document.getElementById('serviceCategory').value,
    price: parseFloat(document.getElementById('servicePrice').value) || 0,
    desc: document.getElementById('serviceDesc').value
  };

  if (!payload.name || !payload.category) return showToast('Nome e Categoria são obrigatórios.', 'error');

  fetchAdmin(id ? `/api/services/${encodeURIComponent(id)}` : '/api/services', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => {
      if (!r.ok) throw new Error('Não foi possível salvar o serviço.');
      return r.json();
    })
    .then(() => {
      closeModalDirect('serviceModalOverlay');
      DB.sync().then(() => {
        renderServices();
        populateServiceSelect();
        showToast(id ? 'Serviço atualizado!' : 'Serviço cadastrado com sucesso!', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

function editService(id) {
  const s = DB.get('services').find(x => x.id === id);
  if (!s) return;
  document.getElementById('serviceId').value = s.id;
  document.getElementById('serviceModalTitle').textContent = 'Editar Serviço';
  document.getElementById('serviceName').value = s.name;
  document.getElementById('serviceCategory').value = s.category;
  document.getElementById('servicePrice').value = s.price || '';
  document.getElementById('serviceDesc').value = s.desc || '';
  openModal('serviceModalOverlay');
}

function deleteService(id) {
  const hasOrders = (DB.get('orders') || []).some(o => o.serviceId === id);
  if (hasOrders) return showToast('Este serviço está vinculado a OS. Altere as OS antes de excluir.', 'error');
  if (!confirm('Excluir este serviço do catálogo?')) return;

  fetchAdmin(`/api/services/${encodeURIComponent(id)}`, { method: 'DELETE' })
    .then(r => {
      if (!r.ok) throw new Error('Erro ao excluir serviço.');
      return r.json();
    })
    .then(() => {
      DB.sync().then(() => {
        renderServices();
        populateServiceSelect();
        showToast('Serviço excluído com sucesso.', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

/* ==========================================================================
   Financeiro
   ========================================================================== */
function renderFinance() {
  const orders = DB.get('orders') || [];
  const query = (document.getElementById('finSearch')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('finFilterStatus')?.value || '';
  const tbody = document.querySelector('#financeTable tbody');
  if (!tbody) return;

  let list = orders;
  if (query) {
    list = list.filter(o => (o.id + ' ' + getClientName(o.clientId) + ' ' + getServiceName(o.serviceId)).toLowerCase().includes(query));
  }
  if (filter) {
    list = list.filter(o => o.payStatus === filter);
  }
  list = list.sort((a, b) => new Date(b.created) - new Date(a.created));

  const totalReceber = orders.filter(o => o.payStatus === 'pendente' && o.status !== 'cancelado').reduce((acc, o) => acc + (parseFloat(o.value) || 0), 0);
  const totalRecebido = orders.filter(o => o.payStatus === 'pago').reduce((acc, o) => acc + (parseFloat(o.value) || 0), 0);
  const totalValidas = orders.filter(o => o.status !== 'cancelado' && o.payStatus !== 'cancelado').reduce((acc, o) => acc + (parseFloat(o.value) || 0), 0);

  document.getElementById('finTotalReceber').textContent = formatCurrency(totalReceber);
  document.getElementById('finTotalRecebido').textContent = formatCurrency(totalRecebido);
  document.getElementById('finFaturamento').textContent = formatCurrency(totalValidas);

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Nenhum lançamento financeiro encontrado.</p></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(o => `
    <tr>
      <td><strong style="color:var(--accent);cursor:pointer" onclick="viewOS('${escapeHtml(o.id)}')">${escapeHtml(o.id)}</strong></td>
      <td>${escapeHtml(getClientName(o.clientId))}</td>
      <td>${escapeHtml(getServiceName(o.serviceId))}</td>
      <td><strong>${formatCurrency(o.value)}</strong></td>
      <td>${formatDate(o.dueDate)}</td>
      <td>${getPayStatusBadge(o.payStatus)}</td>
      <td>${escapeHtml(getPayMethodLabel(o.payMethod))}</td>
      <td style="text-align:right">
        ${o.payStatus === 'pendente' ? `<button class="btn btn-primary btn-sm" onclick="openPayModal('${escapeHtml(o.id)}')">Receber</button>` : `<button class="btn btn-secondary btn-sm" onclick="openPayModal('${escapeHtml(o.id)}')">Ver</button>`}
      </td>
    </tr>
  `).join('');
}

function filterFinance() {
  renderFinance();
}

function openPayModal(id) {
  const order = DB.get('orders').find(o => o.id === id);
  if (!order) return;
  document.getElementById('payOSId').value = id;
  document.getElementById('payOSNum').value = id;
  document.getElementById('payValue').value = order.value || '';
  document.getElementById('payDate').value = order.payDate || new Date().toISOString().split('T')[0];
  document.getElementById('payMethod').value = order.payMethod || '';
  document.getElementById('payObs').value = order.payObs || '';
  openModal('payModalOverlay');
}

function savePayment(e) {
  e.preventDefault();
  const id = document.getElementById('payOSId').value;
  const order = DB.get('orders').find(o => o.id === id);
  if (!order) return;

  const payload = {
    ...order,
    value: parseFloat(document.getElementById('payValue').value) || 0,
    payDate: document.getElementById('payDate').value,
    payMethod: document.getElementById('payMethod').value,
    payObs: document.getElementById('payObs').value,
    payStatus: 'pago',
    updated: new Date().toISOString().split('T')[0]
  };

  fetchAdmin(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => {
      if (!r.ok) throw new Error('Não foi possível registrar o pagamento.');
      return r.json();
    })
    .then(() => {
      closeModalDirect('payModalOverlay');
      DB.sync().then(() => {
        renderFinance();
        renderOS();
        renderDashboard();
        renderReports();
        showToast('Pagamento registrado com sucesso!', 'success');
      });
    })
    .catch(err => showToast(err.message, 'error'));
}

/* ==========================================================================
   Relatórios
   ========================================================================== */
function renderReports() {
  const all = DB.get('orders') || [];
  const valid = all.filter(o => o.status !== 'cancelado' && o.payStatus !== 'cancelado');
  const sum = valid.reduce((acc, o) => acc + (parseFloat(o.value) || 0), 0);

  document.getElementById('relFaturamento').textContent = formatCurrency(sum);
  document.getElementById('relTicket').textContent = formatCurrency(valid.length ? sum / valid.length : 0);
  document.getElementById('relConcluidas').textContent = `${all.filter(o => ['pronto', 'entregue'].includes(o.status)).length} / ${all.length}`;

  const counts = new Map();
  all.forEach(o => counts.set(o.serviceId, (counts.get(o.serviceId) || 0) + 1));
  const servicesArea = document.getElementById('relServicos');
  servicesArea.replaceChildren();

  if (!all.length) {
    servicesArea.innerHTML = '<p class="empty-state">Sem dados suficientes para estatísticas.</p>';
  } else {
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([srvId, cnt]) => {
      const p = document.createElement('div');
      p.style.cssText = 'display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg);border-radius:6px;border:1px solid var(--line);font-size:0.86rem';
      p.innerHTML = `<strong>${escapeHtml(getServiceName(srvId))}</strong> <span>${cnt} OS</span>`;
      servicesArea.appendChild(p);
    });
  }

  const rows = [...all].sort((a, b) => new Date(b.created) - new Date(a.created));
  const tbody = document.querySelector('#relTable tbody');
  if (tbody) {
    tbody.innerHTML = rows.length
      ? rows.map(o => `
        <tr>
          <td>${escapeHtml(o.id)}</td>
          <td>${escapeHtml(getClientName(o.clientId))}</td>
          <td>${escapeHtml(getServiceName(o.serviceId))}</td>
          <td>${getStatusBadge(o.status)}</td>
          <td>${formatCurrency(o.value)}</td>
          <td>${getPayStatusBadge(o.payStatus)}</td>
          <td>${formatDate(o.created)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="7" class="empty-state"><p>Nenhum dado disponível.</p></td></tr>';
  }
}

/* ==========================================================================
   Catálogo de Peças & Componentes (Frontend Logic)
   ========================================================================== */
function getPartStatusBadge(status) {
  const map = {
    em_estoque: ['badge-em_estoque', 'Em estoque'],
    sob_encomenda: ['badge-sob_encomenda', 'Sob encomenda'],
    a_confirmar: ['badge-a_confirmar', 'A confirmar']
  };
  const cfg = map[status] || ['badge-muted', status || 'A confirmar'];
  return `<span class="badge ${cfg[0]}">${escapeHtml(cfg[1])}</span>`;
}

function getPartActiveBadge(active) {
  return active
    ? '<span class="badge badge-success">Ativa</span>'
    : '<span class="badge badge-inativo">Inativa</span>';
}

function calcPartModalMargin() {
  const cost = parseFloat(document.getElementById('partCost')?.value || 0);
  const price = parseFloat(document.getElementById('partPrice')?.value || 0);
  const profit = price - cost;
  const pct = cost > 0 ? ((profit / cost) * 100).toFixed(1) : (profit > 0 ? '100.0' : '0.0');
  const infoEl = document.getElementById('partModalMarginInfo');
  if (infoEl) {
    infoEl.innerHTML = `Margem estimada: <strong>${formatCurrency(profit)}</strong> (${pct}%) · Custo: ${formatCurrency(cost)} · Venda: ${formatCurrency(price)}`;
  }
}

function openPartModal(partId) {
  const form = document.getElementById('partForm');
  if (form) form.reset();
  document.getElementById('partId').value = '';
  document.getElementById('partModalTitle').textContent = 'Nova Peça / Componente';
  document.getElementById('partActive').value = '1';
  document.getElementById('partStatus').value = 'em_estoque';

  if (partId) {
    const part = (DB.get('parts') || []).find(p => p.id === partId);
    if (part) {
      document.getElementById('partModalTitle').textContent = `Editar Peça: ${part.brand} ${part.model}`;
      document.getElementById('partId').value = part.id;
      document.getElementById('partCategory').value = part.category || '';
      document.getElementById('partBrand').value = part.brand || '';
      document.getElementById('partModel').value = part.model || '';
      document.getElementById('partSku').value = part.sku || '';
      document.getElementById('partSupplier').value = part.supplier || '';
      document.getElementById('partCost').value = (part.cost || 0).toFixed(2);
      document.getElementById('partPrice').value = (part.price || 0).toFixed(2);
      document.getElementById('partStatus').value = part.status || 'em_estoque';
      document.getElementById('partActive').value = String(part.active != null ? part.active : 1);
      document.getElementById('partSpecs').value = part.specs || '';
      document.getElementById('partNotes').value = part.notes || '';
    }
  }
  calcPartModalMargin();
  openModal('partModalOverlay');
}

async function savePart(e) {
  e.preventDefault();
  const id = document.getElementById('partId').value;
  const payload = {
    category: document.getElementById('partCategory').value.trim(),
    brand: document.getElementById('partBrand').value.trim(),
    model: document.getElementById('partModel').value.trim(),
    sku: document.getElementById('partSku').value.trim(),
    supplier: document.getElementById('partSupplier').value.trim(),
    cost: parseFloat(document.getElementById('partCost').value) || 0,
    price: parseFloat(document.getElementById('partPrice').value) || 0,
    status: document.getElementById('partStatus').value,
    active: parseInt(document.getElementById('partActive').value, 10) || 0,
    specs: document.getElementById('partSpecs').value.trim(),
    notes: document.getElementById('partNotes').value.trim()
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/parts/${encodeURIComponent(id)}` : '/api/parts';
    const res = await fetchAdmin(url, {
      method,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Não foi possível salvar o componente.');
    }
    closeModalDirect('partModalOverlay');
    showToast(id ? 'Peça atualizada com sucesso!' : 'Peça cadastrada no catálogo!');
    await DB.sync();
    renderParts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function togglePartActive(id) {
  try {
    const res = await fetchAdmin(`/api/parts/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: '{}'
    });
    if (!res.ok) throw new Error('Não foi possível alterar o status.');
    await DB.sync();
    renderParts();
    showToast('Status da peça atualizado!');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deletePart(id) {
  const part = (DB.get('parts') || []).find(p => p.id === id);
  if (!confirm(`Deseja inativar a peça "${part ? part.brand + ' ' + part.model : id}" do catálogo? O histórico em orçamentos anteriores será preservado.`)) {
    return;
  }
  try {
    const res = await fetchAdmin(`/api/parts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: '{}'
    });
    if (!res.ok) throw new Error('Não foi possível inativar a peça.');
    await DB.sync();
    renderParts();
    showToast('Peça inativada do catálogo.');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function filterParts() {
  renderParts();
}

function renderParts() {
  const parts = DB.get('parts') || [];
  const q = (document.getElementById('partSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('partFilterCategory')?.value || '';
  const status = document.getElementById('partFilterStatus')?.value || '';
  const active = document.getElementById('partFilterActive')?.value || '1';

  // KPI calculations
  const totalActive = parts.filter(p => p.active === 1).length;
  const inStock = parts.filter(p => p.active === 1 && p.status === 'em_estoque').length;
  const onDemand = parts.filter(p => p.active === 1 && p.status === 'sob_encomenda').length;
  const toConfirm = parts.filter(p => p.active === 1 && p.status === 'a_confirmar').length;

  const setKpi = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setKpi('kpiPartsTotal', totalActive);
  setKpi('kpiPartsInStock', inStock);
  setKpi('kpiPartsOnDemand', onDemand);
  setKpi('kpiPartsToConfirm', toConfirm);

  const filtered = parts.filter(p => {
    if (active === '1' && p.active !== 1) return false;
    if (active === '0' && p.active !== 0) return false;
    if (cat && p.category !== cat) return false;
    if (status && p.status !== status) return false;
    if (q) {
      const match = `${p.brand} ${p.model} ${p.sku || ''} ${p.category} ${p.supplier || ''} ${p.specs || ''}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const tbody = document.querySelector('#partsTable tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><p>Nenhuma peça encontrada no catálogo com os filtros selecionados.</p></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const profit = (p.price || 0) - (p.cost || 0);
    const pct = p.cost > 0 ? ((profit / p.cost) * 100).toFixed(0) : (profit > 0 ? '100' : '0');
    return `
      <tr>
        <td><code>${escapeHtml(p.sku || '—')}</code></td>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" style="width:36px;height:36px;object-fit:contain;background:#fff;border-radius:4px;padding:1px;flex-shrink:0" alt="Foto">` : ''}
            <div>
              <div style="font-weight:650;color:var(--text)">
                ${escapeHtml(p.brand)} ${escapeHtml(p.model)}
                ${p.notes && p.notes.startsWith('http') ? `<a href="${escapeHtml(p.notes)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:0.75rem;margin-left:6px" title="Abrir link original na loja">↗ ${escapeHtml(p.supplier || 'Loja')}</a>` : ''}
              </div>
              ${p.specs ? `<div style="font-size:0.75rem;color:var(--muted);max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.specs)}</div>` : ''}
            </div>
          </div>
        </td>
        <td><span class="badge badge-muted">${escapeHtml(p.category)}</span></td>
        <td style="color:var(--muted)">${formatCurrency(p.cost)}</td>
        <td style="font-weight:700;color:var(--accent)">${formatCurrency(p.price)}</td>
        <td style="font-size:0.82rem;color:${profit >= 0 ? 'var(--accent)' : 'var(--danger)'}">
          ${formatCurrency(profit)} (${pct}%)
        </td>
        <td>${getPartStatusBadge(p.status)}</td>
        <td>${getPartActiveBadge(p.active)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="openPartModal('${escapeHtml(p.id)}')" title="Editar Peça">Editar</button>
          <button class="btn btn-secondary btn-sm" onclick="togglePartActive('${escapeHtml(p.id)}')" title="${p.active ? 'Inativar' : 'Ativar'}">${p.active ? 'Inativar' : 'Ativar'}</button>
          <button class="btn btn-danger btn-sm" onclick="deletePart('${escapeHtml(p.id)}')" title="Excluir">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

/* ==========================================================================
   Orçamentos & Propostas Detalhadas (Frontend Logic)
   ========================================================================== */
let currentQuoteItems = [];

function getQuoteStatusBadge(status, version) {
  const v = version ? ` (v${version})` : '';
  const map = {
    rascunho: ['badge-rascunho', `Rascunho${v}`],
    aguardando_aprovacao: ['badge-aguardando_aprovacao', `Aguardando aprovação${v}`],
    aprovado: ['badge-aprovado', `✓ Aprovado${v}`],
    convertido_os: ['badge-convertido_os', `Convertido em OS${v}`],
    rejeitado: ['badge-rejeitado', `Rejeitado${v}`],
    expirado: ['badge-expirado', `Expirado${v}`]
  };
  const cfg = map[status] || ['badge-muted', `${status || 'Pendente'}${v}`];
  return `<span class="badge ${cfg[0]}">${escapeHtml(cfg[1])}</span>`;
}

function getItemTypeBadge(type) {
  const map = {
    peca: ['item-type-part', 'Peça'],
    servico: ['item-type-service', 'Serviço'],
    avulso: ['item-type-custom', 'Avulso']
  };
  const cfg = map[type] || ['item-type-custom', type || 'Item'];
  return `<span class="item-type-tag ${cfg[0]}">${escapeHtml(cfg[1])}</span>`;
}

function filterQuotes() {
  renderQuotes();
}

function renderQuotes() {
  const quotes = DB.get('quotes') || [];
  const q = (document.getElementById('quoteSearch')?.value || '').toLowerCase();
  const status = document.getElementById('quoteFilterStatus')?.value || '';

  // KPI Calculations
  const total = quotes.length;
  const pending = quotes.filter(x => x.status === 'aguardando_aprovacao').length;
  const approved = quotes.filter(x => x.status === 'aprovado' || x.approvedVersion != null).length;
  const converted = quotes.filter(x => x.status === 'convertido_os' || x.orderId != null).length;

  const setKpi = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setKpi('kpiQuotesTotal', total);
  setKpi('kpiQuotesPending', pending);
  setKpi('kpiQuotesApproved', approved);
  setKpi('kpiQuotesConverted', converted);

  const filtered = quotes.filter(item => {
    if (status && item.status !== status) return false;
    if (q) {
      const match = `${item.publicCode} ${item.title} ${item.device || ''} ${item.clientName || ''} ${item.clientPhone || ''} ${item.notes || ''}`.toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const tbody = document.querySelector('#quotesTable tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Nenhum orçamento encontrado com os filtros selecionados.</p></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    return `
      <tr>
        <td><code>${escapeHtml(item.publicCode)}</code></td>
        <td>
          <div style="font-weight:650;color:var(--text)">${escapeHtml(item.title)}</div>
          <div style="font-size:0.78rem;color:var(--muted)">${escapeHtml(item.device || 'Equipamento não especificado')}</div>
        </td>
        <td>
          <div>${escapeHtml(item.clientName || getClientName(item.clientId))}</div>
          <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(item.clientPhone || getClientPhone(item.clientId))}</div>
        </td>
        <td>
          <span style="font-size:0.84rem;color:var(--text)">${item.orderId ? `<a href="javascript:showPage('os');viewOS('${escapeHtml(item.orderId)}')" style="color:var(--info);text-decoration:underline">OS ${escapeHtml(item.orderId)}</a>` : '—'}</span>
        </td>
        <td style="font-weight:750;color:var(--accent);font-size:0.95rem">${formatCurrency(item.total)}</td>
        <td>${getQuoteStatusBadge(item.status, item.version)}</td>
        <td>${formatDate(item.validUntil)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="viewQuote('${escapeHtml(item.id)}')" title="Visualizar Proposta Completa">Ver</button>
          <button class="btn btn-whatsapp btn-sm" onclick="sendQuoteWhatsApp('${escapeHtml(item.id)}')" title="Enviar pelo WhatsApp">Zap</button>
          <button class="btn btn-secondary btn-sm" onclick="openQuoteModal('${escapeHtml(item.id)}')" title="Editar Proposta">Editar</button>
          <button class="btn btn-secondary btn-sm" onclick="duplicateQuote('${escapeHtml(item.id)}')" title="Duplicar para configuração alternativa">Duplicar</button>
          ${!item.orderId ? `<button class="btn btn-secondary btn-sm" onclick="convertQuoteToOS('${escapeHtml(item.id)}')" title="Converter em Ordem de Serviço">Converter OS</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteQuote('${escapeHtml(item.id)}')" title="Excluir Orçamento">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function populateQuoteModalSelectors() {
  const clients = DB.get('clients') || [];
  const clientSel = document.getElementById('quoteClientId');
  if (clientSel) {
    const cur = clientSel.value;
    clientSel.innerHTML = '<option value="">Selecione um cliente...</option>' +
      clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${escapeHtml(c.phone)}</option>`).join('');
    clientSel.value = cur;
  }

  const orders = DB.get('orders') || [];
  const orderSel = document.getElementById('quoteOrderId');
  if (orderSel) {
    const cur = orderSel.value;
    orderSel.innerHTML = '<option value="">Sem vínculo inicial (pode ser gerada depois)</option>' +
      orders.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.id)} (${escapeHtml(o.publicCode)}) — ${escapeHtml(o.device)}</option>`).join('');
    orderSel.value = cur;
  }

  const parts = (DB.get('parts') || []).filter(p => p.active === 1);
  const partSel = document.getElementById('quickPartSelect');
  if (partSel) {
    partSel.innerHTML = '<option value="">Adicionar peça do catálogo...</option>' +
      parts.map(p => `<option value="${escapeHtml(p.id)}">[${escapeHtml(p.category)}] ${escapeHtml(p.brand)} ${escapeHtml(p.model)} — ${formatCurrency(p.price)}</option>`).join('');
  }

  const services = DB.get('services') || [];
  const serviceSel = document.getElementById('quickServiceSelect');
  if (serviceSel) {
    serviceSel.innerHTML = '<option value="">Adicionar serviço cadastrado...</option>' +
      services.map(s => `<option value="${escapeHtml(s.id)}">[${escapeHtml(s.category)}] ${escapeHtml(s.name)} — ${formatCurrency(s.price)}</option>`).join('');
  }
}

/* ==========================================================================
   Gestão de Itens do Orçamento (Tabela Editável, Busca e Detalhes Internos)
   ========================================================================== */
let quoteCatalogSearchSequence = 0;
let quoteCatalogSearchTimer;
const quoteCatalogOffers = new Map();

function handleQuoteCatalogSearch(query) {
  const sequence = ++quoteCatalogSearchSequence;
  clearTimeout(quoteCatalogSearchTimer);
  const dropdown = document.getElementById('quoteCatalogDropdown');
  const clearBtn = document.getElementById('btnClearQuoteSearch');
  if (!dropdown) return;

  const q = (query || '').trim().toLowerCase();
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

  const parts = DB.get('parts') || [];
  const services = DB.get('services') || [];

  const matchedParts = parts.filter(p => !/^part_(kabum|pichau|terabyte)_/.test(p.id) && p.active !== 0 && (
    !q ||
    (p.brand && p.brand.toLowerCase().includes(q)) ||
    (p.model && p.model.toLowerCase().includes(q)) ||
    (p.category && p.category.toLowerCase().includes(q)) ||
    (p.sku && p.sku.toLowerCase().includes(q)) ||
    (p.specs && p.specs.toLowerCase().includes(q))
  )).slice(0, 15);

  const matchedServices = services.filter(s => (
    !q ||
    (s.name && s.name.toLowerCase().includes(q)) ||
    (s.category && s.category.toLowerCase().includes(q)) ||
    (s.desc && s.desc.toLowerCase().includes(q))
  )).slice(0, 10);

  if (!matchedParts.length && !matchedServices.length && !q) {
    dropdown.innerHTML = `
      <div style="padding:12px;text-align:center;color:var(--muted);font-size:0.82rem">
        Nenhuma peça ou serviço encontrado para "<strong>${escapeHtml(q)}</strong>".
      </div>
    `;
    dropdown.style.display = 'block';
    return;
  }

  let html = '';
  if (matchedParts.length) {
    html += `<div class="search-group-title">Peças do Catálogo (${matchedParts.length})</div>`;
    html += matchedParts.map(p => `
      <div class="search-item-row" onclick="addPartFromSearch('${p.id}')">
        <div style="display:flex;align-items:center;gap:10px">
          ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" style="width:34px;height:34px;object-fit:contain;background:#fff;border-radius:4px;padding:1px;flex-shrink:0" alt="Foto">` : ''}
          <div>
            <div class="search-item-name">[${escapeHtml(p.category)}] ${escapeHtml(p.brand)} ${escapeHtml(p.model)}</div>
            <div class="search-item-meta">${p.sku ? 'SKU: ' + escapeHtml(p.sku) + ' • ' : ''}Fornecedor: ${escapeHtml(p.supplier || 'Loja')} ${p.notes && p.notes.startsWith('http') ? `<a href="${escapeHtml(p.notes)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="color:var(--accent);margin-left:4px" title="Abrir link original">↗ Ver na loja</a>` : ''}</div>
          </div>
        </div>
        <div class="search-item-price">${formatCurrency(p.price)}</div>
      </div>
    `).join('');
  }

  if (matchedServices.length) {
    html += `<div class="search-group-title">Serviços e Mão de Obra (${matchedServices.length})</div>`;
    html += matchedServices.map(s => `
      <div class="search-item-row" onclick="addServiceFromSearch('${s.id}')">
        <div>
          <div class="search-item-name">[${escapeHtml(s.category)}] ${escapeHtml(s.name)}</div>
          <div class="search-item-meta">${escapeHtml(s.desc || 'Serviço técnico especializado')}</div>
        </div>
        <div class="search-item-price">${formatCurrency(s.price)}</div>
      </div>
    `).join('');
  }

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';
  if (!q) return;
  dropdown.insertAdjacentHTML('beforeend', '<div id="quoteSupplierResults" style="padding:12px;color:var(--muted);font-size:0.82rem" role="status">Buscando no catálogo de fornecedores...</div>');
  quoteCatalogSearchTimer = setTimeout(async () => {
    try {
      const response = await fetchAdmin(`/api/suppliers/catalog?q=${encodeURIComponent(q)}&limit=15`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar o catálogo.');
      if (sequence !== quoteCatalogSearchSequence) return;
      const target = document.getElementById('quoteSupplierResults');
      if (!target) return;
      quoteCatalogOffers.clear();
      for (const offer of data.results) quoteCatalogOffers.set(offer.id, offer);
      target.innerHTML = data.results.length ? `<div class="search-group-title">Fornecedores (${data.total} ofertas)</div>` + data.results.map(o => {
        const checked = o.lastChecked ? new Date(o.lastChecked).toLocaleString('pt-BR') : 'Não conferido';
        const available = o.availability === 'em_estoque' ? 'Disponível na loja' : o.availability === 'esgotado' ? 'Esgotado' : 'Disponibilidade a confirmar';
        const cost = o.pricePix ?? o.priceCard;
        const offerId = encodeURIComponent(o.id).replace(/'/g, '%27');
        return `<div class="search-item-row" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" onclick="addOfferToQuote(decodeURIComponent('${offerId}'))">
          ${o.imageUrl ? `<img src="${escapeHtml(o.imageUrl)}" width="34" height="34" style="object-fit:contain;background:#fff;flex-shrink:0" alt="">` : ''}
          <div><div class="search-item-name">${escapeHtml(o.title)}</div>
          <div class="search-item-meta">${escapeHtml(o.supplierName || o.supplier)} · ${escapeHtml(available)}${o.isStale ? ' · Atualização pendente' : ''}</div>
          <div class="search-item-meta">Conferido: ${escapeHtml(checked)}</div></div>
          <div class="search-item-price">${cost == null ? 'Preço a confirmar' : formatCurrency(cost)}<small style="display:block">Custo ${o.pricePix != null ? 'Pix' : 'cartão'}</small></div>
        </div>`;
      }).join('') : 'Nenhuma oferta encontrada no catálogo salvo. A coleta automática pode ainda estar pendente.';
    } catch (error) {
      if (sequence !== quoteCatalogSearchSequence) return;
      const target = document.getElementById('quoteSupplierResults');
      if (target) target.textContent = error.message;
    }
  }, 250);
}

function clearQuoteSearch() {
  ++quoteCatalogSearchSequence;
  clearTimeout(quoteCatalogSearchTimer);
  const inp = document.getElementById('quoteCatalogSearchInput');
  const dropdown = document.getElementById('quoteCatalogDropdown');
  const clearBtn = document.getElementById('btnClearQuoteSearch');
  if (inp) { inp.value = ''; inp.focus(); }
  if (dropdown) dropdown.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
}

// Fechar dropdown de busca ao clicar fora
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.quote-search-wrapper');
  const dropdown = document.getElementById('quoteCatalogDropdown');
  if (dropdown && wrap && !wrap.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

function addPartFromSearch(partId) {
  const part = (DB.get('parts') || []).find(p => p.id === partId);
  if (!part) return;

  currentQuoteItems.push({
    id: 'qi_' + Math.random().toString(36).slice(2, 10),
    type: 'peca',
    itemId: part.id,
    name: `${part.brand} ${part.model}`.trim(),
    details: part.specs || '',
    supplier: part.supplier || '',
    sku: part.sku || '',
    quantity: 1,
    unitCost: part.cost || 0,
    unitPrice: part.price || 0,
    subtotal: part.price || 0,
    costSubtotal: part.cost || 0,
    showDetails: false
  });

  const inp = document.getElementById('quoteCatalogSearchInput');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const dropdown = document.getElementById('quoteCatalogDropdown');
  if (dropdown) dropdown.style.display = 'none';

  renderQuoteItemRows();
  recalcQuoteFinancials();
  showToast(`Peça "${part.model}" adicionada à proposta!`, 'info');
}

function addServiceFromSearch(serviceId) {
  const srv = (DB.get('services') || []).find(s => s.id === serviceId);
  if (!srv) return;

  currentQuoteItems.push({
    id: 'qi_' + Math.random().toString(36).slice(2, 10),
    type: 'servico',
    itemId: srv.id,
    name: srv.name,
    details: srv.desc || '',
    supplier: '',
    sku: '',
    quantity: 1,
    unitCost: 0,
    unitPrice: srv.price || 0,
    subtotal: srv.price || 0,
    costSubtotal: 0,
    showDetails: false
  });

  const inp = document.getElementById('quoteCatalogSearchInput');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  const dropdown = document.getElementById('quoteCatalogDropdown');
  if (dropdown) dropdown.style.display = 'none';

  renderQuoteItemRows();
  recalcQuoteFinancials();
  showToast(`Serviço "${srv.name}" adicionado!`, 'info');
}

function addCustomItemRow() {
  currentQuoteItems.push({
    id: 'qi_' + Math.random().toString(36).slice(2, 10),
    type: 'avulso',
    itemId: null,
    name: '',
    details: '',
    supplier: '',
    sku: '',
    quantity: 1,
    unitCost: 0,
    unitPrice: 0,
    subtotal: 0,
    costSubtotal: 0,
    showDetails: false
  });
  renderQuoteItemRows();
  recalcQuoteFinancials();

  // Foco no campo de descrição do item recém-adicionado
  setTimeout(() => {
    const lastIdx = currentQuoteItems.length - 1;
    const inputEl = document.querySelector(`#quoteItemRow_${lastIdx} .title-input`);
    if (inputEl) inputEl.focus();
  }, 50);
}

function removeQuoteItemRow(idx) {
  currentQuoteItems.splice(idx, 1);
  renderQuoteItemRows();
  recalcQuoteFinancials();
}

function toggleQuoteItemDetails(idx) {
  const it = currentQuoteItems[idx];
  if (!it) return;
  it.showDetails = !it.showDetails;
  const detailsEl = document.getElementById(`quoteItemDetails_${idx}`);
  const btnEl = document.getElementById(`btnToggleDetails_${idx}`);
  if (detailsEl) {
    detailsEl.style.display = it.showDetails ? 'grid' : 'none';
  }
  if (btnEl) {
    btnEl.classList.toggle('open', !!it.showDetails);
  }
}

function updateQuoteItem(idx, field, val) {
  const it = currentQuoteItems[idx];
  if (!it) return;

  if (field === 'quantity') {
    it.quantity = Math.max(1, parseInt(val, 10) || 1);
  } else if (field === 'unitCost') {
    it.unitCost = Math.max(0, parseFloat(val) || 0);
  } else if (field === 'unitPrice') {
    it.unitPrice = Math.max(0, parseFloat(val) || 0);
  } else if (field === 'type') {
    it.type = val;
    const badgeEl = document.getElementById(`quoteItemTypeBadge_${idx}`);
    if (badgeEl) {
      badgeEl.className = `badge-type-pill ${it.type}`;
      badgeEl.textContent = it.type === 'peca' ? 'Peça' : (it.type === 'servico' ? 'Serviço' : 'Avulso');
    }
  } else {
    it[field] = val;
  }

  // Subtotal exato com precisão monetária de 2 casas
  it.subtotal = Math.round(it.quantity * it.unitPrice * 100) / 100;
  it.costSubtotal = Math.round(it.quantity * it.unitCost * 100) / 100;

  const subEl = document.getElementById(`quoteItemSubtotal_${idx}`);
  if (subEl) subEl.textContent = formatCurrency(it.subtotal);

  recalcQuoteFinancials();
}

function renderQuoteItemRows() {
  const tbody = document.getElementById('quoteItemsTableBody');
  const countNotice = document.getElementById('quoteItemCountNotice');
  if (countNotice) {
    countNotice.textContent = `${currentQuoteItems.length} ${currentQuoteItems.length === 1 ? 'item adicionado' : 'itens adicionados'}`;
  }

  if (!tbody) return;

  if (!currentQuoteItems.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding:2.2rem 1rem;text-align:center;color:var(--muted)">
          <div style="font-size:0.92rem;font-weight:600;margin-bottom:6px;color:var(--text)">Nenhum item adicionado à proposta ainda.</div>
          <div style="font-size:0.8rem;color:var(--muted)">Use a barra acima para <strong>buscar peças do catálogo</strong>, <strong>serviços cadastrados</strong> ou <strong>adicionar itens avulsos</strong>.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentQuoteItems.map((it, idx) => {
    const typeLabel = it.type === 'peca' ? 'Peça' : (it.type === 'servico' ? 'Serviço' : 'Avulso');
    const isLinked = !!it.itemId;

    return `
      <tr class="quote-item-tr" id="quoteItemRow_${idx}">
        <td class="col-desc">
          <div class="desc-main-box">
            <input type="text" class="quote-cell-input title-input" placeholder="Descrição do item ou serviço *" value="${escapeHtml(it.name)}" required oninput="updateQuoteItem(${idx}, 'name', this.value)">
            <textarea class="quote-cell-textarea" rows="2" placeholder="Descrição complementar opcional (especificações, modelo, garantia)..." oninput="updateQuoteItem(${idx}, 'details', this.value)">${escapeHtml(it.details || '')}</textarea>
            
            <div class="item-meta-bar">
              <button type="button" class="btn-item-details-toggle ${it.showDetails ? 'open' : ''}" id="btnToggleDetails_${idx}" onclick="toggleQuoteItemDetails(${idx})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                Detalhes internos
                <span class="badge-type-pill ${it.type}" id="quoteItemTypeBadge_${idx}">${typeLabel}</span>
                ${isLinked ? '<span class="badge-linked-pill" title="Vinculado ao cadastro do catálogo">✓ Catálogo</span>' : ''}
              </button>
            </div>

            <!-- Área expansível "Detalhes internos" por item -->
            <div class="item-internal-details" id="quoteItemDetails_${idx}" style="${it.showDetails ? 'display:grid' : 'display:none'}">
              <div class="detail-field">
                <label>Tipo:</label>
                <select onchange="updateQuoteItem(${idx}, 'type', this.value)">
                  <option value="peca" ${it.type === 'peca' ? 'selected' : ''}>Peça do catálogo</option>
                  <option value="servico" ${it.type === 'servico' ? 'selected' : ''}>Serviço / Mão de obra</option>
                  <option value="avulso" ${it.type === 'avulso' ? 'selected' : ''}>Item avulso</option>
                </select>
              </div>
              <div class="detail-field">
                <label>Fornecedor sugerido:</label>
                <input type="text" placeholder="Ex: KaBuM!, Pichau, Estoque..." value="${escapeHtml(it.supplier || '')}" oninput="updateQuoteItem(${idx}, 'supplier', this.value)">
              </div>
              <div class="detail-field">
                <label>[Admin] Custo Unitário (R$):</label>
                <input type="number" step="0.01" min="0" placeholder="0,00" value="${(it.unitCost || 0).toFixed(2)}" oninput="updateQuoteItem(${idx}, 'unitCost', this.value)">
              </div>
              <div class="detail-field">
                <label>Código / SKU:</label>
                <input type="text" placeholder="SKU ou código interno..." value="${escapeHtml(it.sku || '')}" oninput="updateQuoteItem(${idx}, 'sku', this.value)">
              </div>
            </div>
          </div>
        </td>
        <td class="col-qty">
          <input type="number" min="1" max="9999" step="1" class="quote-cell-input qty-input" value="${it.quantity || 1}" oninput="updateQuoteItem(${idx}, 'quantity', this.value)">
        </td>
        <td class="col-price">
          <div class="input-currency-wrapper">
            <span class="prefix">R$</span>
            <input type="number" min="0" step="0.01" class="quote-cell-input price-input" value="${(it.unitPrice || 0).toFixed(2)}" oninput="updateQuoteItem(${idx}, 'unitPrice', this.value)">
          </div>
        </td>
        <td class="col-subtotal">
          <span class="quote-subtotal-val" id="quoteItemSubtotal_${idx}">${formatCurrency(it.subtotal)}</span>
        </td>
        <td class="col-action">
          <button type="button" class="btn-remove-row" onclick="removeQuoteItemRow(${idx})" title="Remover item da proposta">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function recalcQuoteFinancials() {
  let partsTotal = 0;
  let servicesTotal = 0;
  let customTotal = 0;
  let totalCost = 0;

  for (const it of currentQuoteItems) {
    const qty = it.quantity || 1;
    const sub = Math.round(qty * (it.unitPrice || 0) * 100) / 100;
    const costSub = Math.round(qty * (it.unitCost || 0) * 100) / 100;
    totalCost += costSub;

    if (it.type === 'peca') partsTotal += sub;
    else if (it.type === 'servico') servicesTotal += sub;
    else customTotal += sub;
  }

  const shipping = parseFloat(document.getElementById('quoteShipping')?.value || 0) || 0;
  const discount = parseFloat(document.getElementById('quoteDiscount')?.value || 0) || 0;

  const rawGrandTotal = partsTotal + servicesTotal + customTotal + shipping - discount;
  const grandTotal = Math.max(0, Math.round(rawGrandTotal * 100) / 100);
  const profit = Math.round((grandTotal - totalCost - shipping) * 100) / 100;
  const margin = grandTotal > 0 ? ((profit / grandTotal) * 100).toFixed(1) : '0.0';

  const setT = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setT('summaryPartsTotal', formatCurrency(partsTotal));
  setT('summaryServicesTotal', formatCurrency(servicesTotal));
  setT('summaryCustomTotal', formatCurrency(customTotal));
  setT('summaryShippingTotal', formatCurrency(shipping));
  setT('summaryDiscountTotal', discount > 0 ? `- ${formatCurrency(discount)}` : 'R$ 0,00');
  setT('summaryGrandTotal', formatCurrency(grandTotal));

  // Área exclusiva do Admin
  setT('summaryTotalCost', formatCurrency(totalCost));
  setT('summaryProfit', formatCurrency(profit));
  setT('summaryMargin', `${margin}%`);
}

async function openQuoteModal(quoteId) {
  const form = document.getElementById('quoteForm');
  if (form) form.reset();
  currentQuoteItems = [];
  document.getElementById('quoteId').value = '';
  document.getElementById('quoteCurrentVersion').value = '1';
  document.getElementById('quoteApprovedVersion').value = '';
  document.getElementById('quoteVersionNotice').style.display = 'none';
  document.getElementById('quoteModalTitle').textContent = 'Novo Orçamento Detalhado';

  populateQuoteModalSelectors();

  const cfg = DB.get('settings') || {};
  const validDays = parseInt(cfg.default_validity_days, 10) || 7;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + validDays);
  document.getElementById('quoteValidUntil').value = targetDate.toISOString().split('T')[0];
  document.getElementById('quoteDeliveryTime').value = cfg.default_delivery_time || '2 a 5 dias úteis';
  document.getElementById('quotePaymentTerms').value = cfg.default_payment_terms || 'À vista via Pix ou Cartão de Crédito';
  document.getElementById('quoteShipping').value = '0.00';
  document.getElementById('quoteDiscount').value = '0.00';
  document.getElementById('quoteStatus').value = 'rascunho';

  const searchInp = document.getElementById('quoteCatalogSearchInput');
  if (searchInp) searchInp.value = '';
  const searchDrop = document.getElementById('quoteCatalogDropdown');
  if (searchDrop) searchDrop.style.display = 'none';
  const clearBtn = document.getElementById('btnClearQuoteSearch');
  if (clearBtn) clearBtn.style.display = 'none';

  if (quoteId) {
    try {
      const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(quoteId)}`);
      if (!res.ok) throw new Error('Não foi possível carregar os dados do orçamento.');
      const q = await res.json();

      document.getElementById('quoteModalTitle').textContent = `Editar Orçamento: ${q.publicCode} (v${q.version})`;
      document.getElementById('quoteId').value = q.id;
      document.getElementById('quoteCurrentVersion').value = q.version;
      document.getElementById('quoteApprovedVersion').value = q.approvedVersion != null ? q.approvedVersion : '';
      document.getElementById('quoteClientId').value = q.clientId || '';
      document.getElementById('quoteOrderId').value = q.orderId || '';
      document.getElementById('quoteTitle').value = q.title || '';
      document.getElementById('quoteDevice').value = q.device || '';
      document.getElementById('quoteStatus').value = q.status || 'rascunho';
      document.getElementById('quoteShipping').value = (q.shippingTotal || 0).toFixed(2);
      document.getElementById('quoteDiscount').value = (q.discountTotal || 0).toFixed(2);
      document.getElementById('quoteValidUntil').value = q.validUntil || '';
      document.getElementById('quoteDeliveryTime').value = q.deliveryTime || '';
      document.getElementById('quotePaymentTerms').value = q.paymentTerms || '';
      document.getElementById('quoteNotes').value = q.notes || '';
      document.getElementById('quoteInternalNotes').value = q.internalNotes || '';

      if (q.approvedVersion != null) {
        document.getElementById('quoteVersionNotice').style.display = 'block';
      }

      currentQuoteItems = (q.items || []).map(it => ({
        id: it.id,
        type: ({part:'peca',service:'servico',custom:'avulso'})[it.type] || it.type || 'avulso',
        itemId: it.itemId || null,
        name: it.name,
        details: it.details || '',
        supplier: it.supplier || '',
        sku: it.sku || '',
        quantity: it.quantity || 1,
        unitCost: it.unitCost || 0,
        unitPrice: it.unitPrice || 0,
        subtotal: it.subtotal || 0,
        costSubtotal: it.costSubtotal || 0,
        showDetails: false
      }));
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
  }

  renderQuoteItemRows();
  recalcQuoteFinancials();
  openModal('quoteModalOverlay');
}

async function saveQuote(e) {
  e.preventDefault();
  if (!currentQuoteItems.length) {
    return showToast('Adicione pelo menos um item (peça ou serviço) ao orçamento.', 'error');
  }

  for (let i = 0; i < currentQuoteItems.length; i++) {
    if (!currentQuoteItems[i].name || !currentQuoteItems[i].name.trim()) {
      return showToast(`Informe o nome/descrição do item #${i + 1}.`, 'error');
    }
  }

  const id = document.getElementById('quoteId').value;
  const payload = {
    clientId: document.getElementById('quoteClientId').value || null,
    orderId: document.getElementById('quoteOrderId').value || null,
    title: document.getElementById('quoteTitle').value.trim(),
    device: document.getElementById('quoteDevice').value.trim(),
    status: document.getElementById('quoteStatus').value,
    shippingTotal: parseFloat(document.getElementById('quoteShipping').value) || 0,
    discountTotal: parseFloat(document.getElementById('quoteDiscount').value) || 0,
    validUntil: document.getElementById('quoteValidUntil').value.trim(),
    deliveryTime: document.getElementById('quoteDeliveryTime').value.trim(),
    paymentTerms: document.getElementById('quotePaymentTerms').value.trim(),
    notes: document.getElementById('quoteNotes').value.trim(),
    internalNotes: document.getElementById('quoteInternalNotes').value.trim(),
    items: currentQuoteItems.map((it, idx) => ({
      type: ({part:'peca',service:'servico',custom:'avulso'})[it.type] || it.type || 'avulso',
      itemId: it.itemId || null,
      name: it.name.trim(),
      details: (it.details || '').trim(),
      quantity: it.quantity || 1,
      unitCost: it.unitCost || 0,
      unitPrice: it.unitPrice || 0,
      position: idx
    }))
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/quotes/${encodeURIComponent(id)}` : '/api/quotes';
    const res = await fetchAdmin(url, {
      method,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível salvar o orçamento.');

    closeModalDirect('quoteModalOverlay');

    if (data.requiresNewApproval) {
      showToast(`Orçamento atualizado para versão v${data.version}. Como havia aprovação prévia, nova aprovação do cliente é exigida.`);
    } else {
      showToast(id ? 'Orçamento atualizado com sucesso!' : 'Orçamento criado com sucesso!');
    }

    await DB.sync();
    renderQuotes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function viewQuote(id) {
  try {
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Orçamento não encontrado.');
    const q = await res.json();

    const client = DB.get('clients').find(c => c.id === q.clientId) || {};
    const trackingUrl = `${location.origin}/proposta#${q.trackingToken}`;

    document.getElementById('viewQuoteTitle').textContent = `Proposta ${q.publicCode} (v${q.version}) · ${q.title}`;

    let approvalsHtml = '';
    if (q.approvals && q.approvals.length > 0) {
      approvalsHtml = `
        <div style="background:var(--accent-tint);border:1px solid var(--accent-border);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px">
          <div style="font-weight:700;color:var(--accent);display:flex;align-items:center;gap:8px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Proposta Aprovada pelo Cliente
          </div>
          <div style="font-size:0.84rem;color:var(--text);margin-top:6px">
            Versão aprovada: <strong>v${q.approvedVersion}</strong> · Valor: <strong>${formatCurrency(q.total)}</strong>
          </div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">
            Registro em: ${formatDate(q.approvals[0].created)} · IP: <code>${escapeHtml(q.approvals[0].ip || 'Registrado')}</code>
          </div>
        </div>
      `;
    }

    const itemsRows = (q.items || []).map(it => `
      <tr>
        <td>${getItemTypeBadge(it.type)}</td>
        <td>
          <div style="font-weight:600;color:var(--text)">${escapeHtml(it.name)}</div>
          ${it.details ? `<div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(it.details)}</div>` : ''}
        </td>
        <td style="text-align:center">${it.quantity}</td>
        <td style="text-align:right">${formatCurrency(it.unitPrice)}</td>
        <td style="text-align:right;font-weight:700;color:var(--accent)">${formatCurrency(it.subtotal)}</td>
      </tr>
    `).join('');

    const bodyHtml = `
      ${approvalsHtml}

      <div class="os-view-grid" style="margin-bottom:var(--space-md)">
        <div class="os-view-cell">
          <div class="os-view-cell-label">Cliente Vinculado</div>
          <div class="os-view-cell-val">${escapeHtml(client.name || q.clientName || 'Cliente não selecionado')}</div>
          <div class="os-view-cell-sub">Tel: ${escapeHtml(client.phone || q.clientPhone || '—')}</div>
          <div class="os-view-cell-sub">${escapeHtml(client.city || q.clientCity || '')}</div>
        </div>
        <div class="os-view-cell">
          <div class="os-view-cell-label">Identificação & Prazos</div>
          <div class="os-view-cell-val">Código: <code>${escapeHtml(q.publicCode)}</code></div>
          <div class="os-view-cell-sub">Status: ${getQuoteStatusBadge(q.status, q.version)}</div>
          <div class="os-view-cell-sub">Validade: <strong>${formatDate(q.validUntil)}</strong></div>
        </div>
        <div class="os-view-cell">
          <div class="os-view-cell-label">Equipamento / Objetivo</div>
          <div class="os-view-cell-val">${escapeHtml(q.title)}</div>
          <div class="os-view-cell-sub">Dispositivo: ${escapeHtml(q.device || 'Geral')}</div>
          <div class="os-view-cell-sub">Prazo: ${escapeHtml(q.deliveryTime || 'A combinar')}</div>
        </div>
        <div class="os-view-cell">
          <div class="os-view-cell-label">Pagamento & Vínculo OS</div>
          <div class="os-view-cell-val">${escapeHtml(q.paymentTerms || 'À vista ou parcelado')}</div>
          <div class="os-view-cell-sub">OS Vinculada: ${q.orderId ? `<strong style="color:var(--accent)">${escapeHtml(q.orderId)}</strong>` : 'Nenhuma (orçamento prévio)'}</div>
        </div>
      </div>

      <!-- Tabela de Itens da Proposta -->
      <div style="background:var(--bg);border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:14px">
        <table class="table" style="margin:0">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Descrição / Especificação</th>
              <th style="text-align:center">Qtd</th>
              <th style="text-align:right">Valor Unit.</th>
              <th style="text-align:right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows || '<tr><td colspan="5" class="empty-state"><p>Nenhum item na proposta.</p></td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- Resumo de Totais do Cliente -->
      <div style="background:var(--panel-header);border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:0.86rem;margin-bottom:4px">
          <span>Subtotal de Peças e Componentes:</span>
          <strong>${formatCurrency(q.partsTotal)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.86rem;margin-bottom:4px">
          <span>Subtotal de Montagem / Mão de Obra:</span>
          <strong>${formatCurrency(q.servicesTotal + q.customTotal)}</strong>
        </div>
        ${q.shippingTotal > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:0.86rem;margin-bottom:4px">
            <span>Frete / Deslocamento:</span>
            <strong>${formatCurrency(q.shippingTotal)}</strong>
          </div>
        ` : ''}
        ${q.discountTotal > 0 ? `
          <div style="display:flex;justify-content:space-between;font-size:0.86rem;margin-bottom:4px;color:var(--danger)">
            <span>Desconto Concedido:</span>
            <strong>-${formatCurrency(q.discountTotal)}</strong>
          </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;font-size:1.15rem;font-weight:800;color:var(--accent);border-top:1px solid var(--line);padding-top:8px;margin-top:6px">
          <span>TOTAL DA PROPOSTA:</span>
          <span>${formatCurrency(q.total)}</span>
        </div>
      </div>

      <!-- Quadro Financeiro Exclusivo do Painel Administrativo -->
      <div style="background:#0c1514;border:1px dashed #3a4d47;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px">
        <div style="font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">
          🔒 Exclusivo do Painel Administrativo (Não visível ao cliente)
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:0.88rem">
          <div>Custo Total das Peças/Serviços: <strong style="color:var(--muted)">${formatCurrency(q.totalCost)}</strong></div>
          <div>Lucro Bruto Estimado: <strong style="color:var(--accent)">${formatCurrency(q.profit)}</strong></div>
          <div>Margem de Lucro: <strong style="color:var(--accent)">${(q.profitMargin || 0).toFixed(1)}%</strong></div>
        </div>
      </div>

      <!-- Link Exclusivo do Cliente -->
      <div class="tracking-tools" style="margin-top:12px;padding-top:10px">
        <h4>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Link Exclusivo de Consulta e Aprovação do Cliente
        </h4>
        <p class="security-note">O cliente visualiza o detalhamento completo, especificações das peças, valores e pode aprovar a proposta online diretamente por este link protegido.</p>
        <input id="quoteTrackingLinkInput" readonly value="${trackingUrl}">
        <div class="tool-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${trackingUrl}').then(()=>showToast('Link da proposta copiado!'))">
            Copiar Link
          </button>
          <a href="${trackingUrl}" target="_blank" class="btn btn-secondary btn-sm">
            Abrir Proposta ↗
          </a>
          <button type="button" class="btn btn-secondary btn-sm" onclick="rotateQuoteLink('${escapeHtml(q.id)}')">
            Regerar Link Seguro ↻
          </button>
        </div>
      </div>

      ${q.notes ? `
        <div class="os-view-block" style="margin-top:10px">
          <div class="os-view-cell-label">Observações da Proposta (Visíveis ao Cliente)</div>
          <div style="font-size:0.86rem;line-height:1.5">${escapeHtml(q.notes)}</div>
        </div>
      ` : ''}

      ${q.internalNotes ? `
        <div class="os-view-block" style="margin-top:10px;background:#151d1c;border-color:#2a3d38">
          <div class="os-view-cell-label" style="color:var(--warning)">Notas Internas da Assistência (Exclusivo Admin)</div>
          <div style="font-size:0.86rem;line-height:1.5;color:var(--text)">${escapeHtml(q.internalNotes)}</div>
        </div>
      ` : ''}
    `;

    document.getElementById('viewQuoteBody').innerHTML = bodyHtml;

    // Configurar botões de ação do rodapé
    const btnPrint = document.getElementById('btnViewQuotePrint');
    if (btnPrint) btnPrint.onclick = () => printQuoteDocument(q);

    const btnWhatsApp = document.getElementById('btnViewQuoteWhatsApp');
    if (btnWhatsApp) btnWhatsApp.onclick = () => sendQuoteWhatsApp(q);

    const btnDuplicate = document.getElementById('btnViewQuoteDuplicate');
    if (btnDuplicate) btnDuplicate.onclick = () => duplicateQuote(q.id);

    const btnConvert = document.getElementById('btnViewQuoteConvertOS');
    if (btnConvert) {
      if (q.orderId) {
        btnConvert.style.display = 'none';
      } else {
        btnConvert.style.display = 'inline-flex';
        btnConvert.onclick = () => convertQuoteToOS(q.id);
      }
    }

    const btnCheckSuppliers = document.getElementById('btnViewQuoteCheckSuppliers');
    if (btnCheckSuppliers) {
      btnCheckSuppliers.onclick = () => {
        closeModalDirect('viewQuoteModalOverlay');
        checkQuoteSupplierPrices(q.id);
      };
    }

    const btnEdit = document.getElementById('btnViewQuoteEdit');
    if (btnEdit) {
      btnEdit.onclick = () => {
        closeModalDirect('viewQuoteModalOverlay');
        openQuoteModal(q.id);
      };
    }

    openModal('viewQuoteModalOverlay');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function rotateQuoteLink(id) {
  if (!confirm('Deseja regerar o link da proposta? O link anterior deixará de funcionar imediatamente.')) {
    return;
  }
  try {
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(id)}/rotate-link`, {
      method: 'POST',
      body: '{}'
    });
    if (!res.ok) throw new Error('Não foi possível regerar o link.');
    showToast('Novo link exclusivo gerado!');
    await DB.sync();
    viewQuote(id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function duplicateQuote(id) {
  if (!confirm('Deseja duplicar este orçamento para criar uma opção de configuração alternativa?')) {
    return;
  }
  try {
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: '{}'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível duplicar a proposta.');

    showToast('Proposta duplicada com sucesso!');
    closeModalDirect('viewQuoteModalOverlay');
    await DB.sync();
    renderQuotes();
    openQuoteModal(data.id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function convertQuoteToOS(id) {
  if (!confirm('Deseja converter esta proposta aprovada em uma Ordem de Serviço (OS)?')) {
    return;
  }
  try {
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(id)}/convert-to-os`, {
      method: 'POST',
      body: '{}'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível converter em OS.');

    showToast(`Orçamento convertido com sucesso! Gerada OS ${data.orderId}.`);
    closeModalDirect('viewQuoteModalOverlay');
    await DB.sync();
    showPage('os');
    viewOS(data.orderId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteQuote(id) {
  const q = (DB.get('quotes') || []).find(x => x.id === id);
  if (!confirm(`Deseja excluir o orçamento ${q ? q.publicCode : id}?`)) {
    return;
  }
  try {
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: '{}'
    });
    if (!res.ok) throw new Error('Não foi possível excluir o orçamento.');
    showToast('Orçamento excluído com sucesso.');
    await DB.sync();
    renderQuotes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function sendQuoteWhatsApp(quoteOrId) {
  const q = typeof quoteOrId === 'object' ? quoteOrId : (DB.get('quotes') || []).find(x => x.id === quoteOrId);
  if (!q) return showToast('Orçamento não encontrado.', 'error');

  const client = DB.get('clients').find(c => c.id === q.clientId) || {};
  const phone = (client.phone || q.clientPhone || '').replace(/\D/g, '');
  if (!phone) {
    return showToast('O cliente não possui telefone/WhatsApp cadastrado.', 'error');
  }

  const num = phone.startsWith('55') ? phone : '55' + phone;
  const cfg = DB.get('settings') || {};
  const company = cfg.company_name || 'Bios Informática';
  const trackingUrl = `${location.origin}/proposta#${q.trackingToken}`;

  const msg = [
    `Olá, ${client.name || 'Cliente'}! Aqui é da *${company}*.`,
    '',
    `Segue a sua proposta comercial e técnica para *${q.title}*:`,
    `📋 *Código da Proposta:* ${q.publicCode} (Versão v${q.version})`,
    `💰 *Valor Total:* ${formatCurrency(q.total)}`,
    `💳 *Condições de Pagamento:* ${q.paymentTerms || 'Consulte condições'}`,
    q.validUntil ? `📅 *Validade:* até ${formatDate(q.validUntil)}` : '',
    q.deliveryTime ? `⏱ *Prazo de Execução:* ${q.deliveryTime}` : '',
    '',
    `Você pode conferir todas as peças, especificações e aprovar online pelo link exclusivo:`,
    `${trackingUrl}`,
    '',
    `Qualquer dúvida ou ajuste que preferir, estamos à disposição!`
  ].filter(Boolean).join('\n');

  window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}

function printQuoteDocument(quote) {
  const cfg = DB.get('settings') || {};
  const client = DB.get('clients').find(c => c.id === quote.clientId) || {};

  const itemsRows = (quote.items || []).map((it, idx) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #ddd;font-size:12px;text-align:center">${idx + 1}</td>
      <td style="padding:10px;border-bottom:1px solid #ddd;font-size:12px">
        <span style="font-size:10px;text-transform:uppercase;font-weight:bold;background:#eef6e8;color:#2c5e18;padding:2px 6px;border-radius:3px;margin-right:6px">
          ${it.type === 'peca' ? 'Peça' : (it.type === 'servico' ? 'Serviço' : 'Item')}
        </span>
        <strong>${escapeHtml(it.name)}</strong>
        ${it.details ? `<div style="font-size:11px;color:#555;margin-top:2px">${escapeHtml(it.details)}</div>` : ''}
      </td>
      <td style="padding:10px;border-bottom:1px solid #ddd;font-size:12px;text-align:center">${it.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #ddd;font-size:12px;text-align:right">${formatCurrency(it.unitPrice)}</td>
      <td style="padding:10px;border-bottom:1px solid #ddd;font-size:12px;text-align:right;font-weight:bold">${formatCurrency(it.subtotal)}</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank');
  if (!printWindow) return alert('Permita popups no navegador para gerar a impressão da proposta.');

  printWindow.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Proposta Comercial ${escapeHtml(quote.publicCode)} - ${escapeHtml(cfg.company_name || 'Bios Informática')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    body { background: #fff; color: #1a1a1a; padding: 36px 42px; line-height: 1.45; font-size: 13px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #101a19; padding-bottom: 18px; margin-bottom: 22px; }
    .brand-title { font-size: 22px; font-weight: 800; color: #101a19; letter-spacing: -0.03em; }
    .brand-sub { font-size: 12px; color: #555; margin-top: 2px; }
    .doc-meta { text-align: right; }
    .doc-code { font-size: 16px; font-weight: 800; color: #101a19; font-family: monospace; }
    .doc-badge { display: inline-block; background: #eef6e8; color: #2c5e18; font-size: 10px; font-weight: bold; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; margin-top: 4px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: #fbfcf9; border: 1px solid #e2e6df; border-radius: 6px; padding: 14px; margin-bottom: 20px; font-size: 12px; }
    .info-label { font-size: 10px; text-transform: uppercase; color: #777; font-weight: 700; margin-bottom: 2px; letter-spacing: 0.04em; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f0f3ed; color: #101a19; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 9px 10px; text-align: left; border-bottom: 2px solid #ccd4c7; }
    .totals-box { margin-left: auto; width: 340px; background: #fbfcf9; border: 1px solid #dcdfd8; border-radius: 6px; padding: 14px; margin-bottom: 24px; }
    .totals-line { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
    .totals-grand { font-size: 16px; font-weight: 800; color: #101a19; border-top: 2px solid #101a19; padding-top: 8px; margin-top: 8px; }
    .terms-box { background: #f9faf8; border-left: 3px solid #85b058; padding: 10px 14px; font-size: 11px; color: #444; line-height: 1.5; margin-bottom: 30px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
    .sig-line { border-top: 1px solid #333; padding-top: 6px; font-size: 11px; font-weight: 600; }
    .footer-note { text-align: center; font-size: 10px; color: #888; margin-top: 36px; border-top: 1px solid #eee; padding-top: 12px; }
    @media print {
      body { padding: 0; }
      @page { margin: 15mm 15mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <img src="${escapeHtml(safeLogoUrl(cfg.logo_url))}" alt="Bios Informática" width="72" height="78" style="object-fit:contain;float:left;margin-right:12px">
      <div class="brand-title">${escapeHtml(cfg.company_name || 'Bios Informática')}</div>
      <div class="brand-sub">${escapeHtml(cfg.trade_name || 'Manutenção e Montagem de Computadores')}</div>
      <div class="brand-sub">${escapeHtml(cfg.phone || '')} ${cfg.whatsapp ? '· WhatsApp: ' + escapeHtml(cfg.whatsapp) : ''} · ${escapeHtml(cfg.email || '')}</div>
      <div class="brand-sub">${escapeHtml(cfg.address || '')} · ${escapeHtml(cfg.city || '')}</div>
    </div>
    <div class="doc-meta">
      <div style="font-size:10px;color:#777;text-transform:uppercase;font-weight:bold">Proposta Comercial & Técnica</div>
      <div class="doc-code">${escapeHtml(quote.publicCode)}</div>
      <div style="font-size:11px;color:#555">Versão v${quote.version}</div>
      <div class="doc-badge">${escapeHtml(quote.status === 'aprovado' || quote.approvedVersion ? 'Proposta Aprovada' : 'Aguardando Aprovação')}</div>
    </div>
  </div>

  <div class="info-grid">
    <div>
      <div class="info-label">Dados do Cliente</div>
      <div style="font-weight:700;font-size:13px">${escapeHtml(client.name || quote.clientName || 'Cliente')}</div>
      <div>Telefone: ${escapeHtml(client.phone || quote.clientPhone || '—')}</div>
      <div>Email: ${escapeHtml(client.email || quote.clientEmail || '—')}</div>
      <div>${escapeHtml(client.address || '')} ${client.city ? '· ' + escapeHtml(client.city) : ''}</div>
    </div>
    <div>
      <div class="info-label">Parâmetros da Proposta</div>
      <div>Objetivo / Equipamento: <strong>${escapeHtml(quote.title)}</strong></div>
      <div>Modelo: ${escapeHtml(quote.device || 'Não especificado')}</div>
      <div>Data de Emissão: ${formatDate(quote.created)}</div>
      <div>Validade da Proposta: <strong>${formatDate(quote.validUntil)}</strong></div>
      <div>Prazo Previsto de Execução: <strong>${escapeHtml(quote.deliveryTime || '2 a 5 dias úteis')}</strong></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center">#</th>
        <th>Descrição do Item / Componente / Serviço</th>
        <th style="width:50px;text-align:center">Qtd</th>
        <th style="width:105px;text-align:right">Valor Unit.</th>
        <th style="width:115px;text-align:right">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <div class="totals-box">
    <div class="totals-line">
      <span>Subtotal Peças e Hardware:</span>
      <span>${formatCurrency(quote.partsTotal)}</span>
    </div>
    <div class="totals-line">
      <span>Subtotal Mão de Obra e Serviços:</span>
      <span>${formatCurrency(quote.servicesTotal + quote.customTotal)}</span>
    </div>
    ${quote.shippingTotal > 0 ? `
      <div class="totals-line">
        <span>Frete / Deslocamento:</span>
        <span>${formatCurrency(quote.shippingTotal)}</span>
      </div>
    ` : ''}
    ${quote.discountTotal > 0 ? `
      <div class="totals-line" style="color:#b32400">
        <span>Desconto Concedido:</span>
        <span>-${formatCurrency(quote.discountTotal)}</span>
      </div>
    ` : ''}
    <div class="totals-line totals-grand">
      <span>VALOR TOTAL:</span>
      <span>${formatCurrency(quote.total)}</span>
    </div>
  </div>

  <div class="terms-box">
    <div style="font-weight:bold;margin-bottom:4px;color:#101a19">Condições Comerciais e Garantia Técnica</div>
    <div><strong>Pagamento:</strong> ${escapeHtml(quote.paymentTerms || cfg.default_payment_terms || 'À vista ou parcelado em até 12x.')}</div>
    <div style="margin-top:4px"><strong>Termos:</strong> ${escapeHtml(cfg.warranty_terms || 'Garantia legal de 90 dias conforme CDC art. 26 para serviços prestados. Componentes novos acompanham garantia do fabricante.')}</div>
    ${quote.notes ? `<div style="margin-top:4px"><strong>Observações Técnicas:</strong> ${escapeHtml(quote.notes)}</div>` : ''}
  </div>

  <div class="signatures">
    <div>
      <div class="sig-line">${escapeHtml(cfg.company_name || 'Bios Informática')} — Responsável Técnico</div>
    </div>
    <div>
      <div class="sig-line">${escapeHtml(client.name || 'Cliente')} — Aceite da Proposta</div>
    </div>
  </div>

  <div class="footer-note">
    Documento emitido para fins de proposta técnica e orçamento prévio. Não constitui nota fiscal de venda.
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`);
  printWindow.document.close();
}

function exportData() {
  const dump = {
    exportado: new Date().toISOString(),
    clientes: DB.get('clients'),
    servicos: DB.get('services'),
    ordens: DB.get('orders'),
    pecas: DB.get('parts'),
    orcamentos: DB.get('quotes'),
    configuracoes: DB.get('settings')
  };
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bios_cadastros_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Cadastros exportados em JSON. O backup integral SQLite é mantido no servidor.', 'success');
}

function renderAll() {
  renderDashboard();
  renderOS();
  renderQuotes();
  renderParts();
  renderClients();
  renderServices();
  renderFinance();
  renderReports();
  renderSuppliers();
}

/* ==========================================================================
   Módulo Privado de Fornecedores & Monitoramento de Preços
   ========================================================================== */

let currentCompareQuoteId = null;
let currentPreviewOfferData = null;

function renderSuppliers() {
  const suppliers = DB.get('suppliers') || [];
  const offers = DB.get('supplierOffers') || [];
  const settings = DB.get('supplierSettings') || {};

  const kabum = suppliers.find(s => s.id === 'kabum');
  const pichau = suppliers.find(s => s.id === 'pichau');
  const terabyte = suppliers.find(s => s.id === 'terabyte');

  const updateCardBadge = (badgeId, sup) => {
    const el = document.getElementById(badgeId);
    if (!el) return;
    if (!sup) {
      el.className = 'badge badge-muted';
      el.textContent = 'Não configurado';
      return;
    }
    if (sup.status === 'ativo') {
      el.className = 'badge badge-success';
      el.textContent = 'Ativo';
    } else if (sup.status === 'inativo') {
      el.className = 'badge badge-danger';
      el.textContent = 'Inativo';
    } else {
      el.className = 'badge badge-warning';
      el.textContent = 'Integração Pendente';
    }
  };

  updateCardBadge('badgeKabumStatus', kabum);
  updateCardBadge('badgePichauStatus', pichau);
  updateCardBadge('badgeTerabyteStatus', terabyte);

  const schedTimeEl = document.getElementById('schedSyncTime');
  if (schedTimeEl && settings.daily_sync_time) {
    schedTimeEl.value = settings.daily_sync_time;
  }

  filterOffers();
  loadSupplierSyncLogs();
}

async function refreshSupplierOffers() {
  await DB.sync();
  renderSuppliers();
  showToast('Dados de fornecedores atualizados com sucesso!');
}

function filterOffers() {
  const offers = DB.get('supplierOffers') || [];
  const q = (document.getElementById('offerSearch')?.value || '').toLowerCase().trim();
  const supFilter = document.getElementById('offerFilterSupplier')?.value || '';
  const availFilter = document.getElementById('offerFilterAvailability')?.value || '';

  const filtered = offers.filter(o => {
    if (supFilter && o.supplierId !== supFilter) return false;
    if (availFilter && o.availability !== availFilter) return false;
    if (q) {
      const haystack = `${o.title} ${o.storeSku || ''} ${o.ean || ''} ${o.manufacturerCode || ''} ${o.seller || ''} ${o.partModel || ''} ${o.partBrand || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const countDisplay = document.getElementById('offersCountDisplay');
  if (countDisplay) {
    countDisplay.textContent = `${filtered.length} de ${offers.length} ofertas`;
  }

  const tbody = document.getElementById('offersTableBody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><p>Nenhuma oferta encontrada com os filtros selecionados.</p></td></tr>';
    return;
  }

  const supplierBadges = {
    kabum: '<span class="badge" style="background:rgba(255,101,0,0.15);color:#ff6500;border:1px solid rgba(255,101,0,0.4)">KaBuM!</span>',
    pichau: '<span class="badge" style="background:rgba(204,0,0,0.15);color:#ff4d4d;border:1px solid rgba(204,0,0,0.4)">Pichau</span>',
    terabyte: '<span class="badge" style="background:rgba(255,152,0,0.15);color:#ff9800;border:1px solid rgba(255,152,0,0.4)">Terabyte</span>'
  };

  tbody.innerHTML = filtered.map(o => {
    const isStale = o.isStale === 1;
    const availBadge = o.availability === 'em_estoque'
      ? '<span class="badge badge-success">Em Estoque</span>'
      : (o.availability === 'esgotado'
        ? '<span class="badge badge-danger">Esgotado</span>'
        : '<span class="badge badge-warning">Sob Consulta</span>');

    const shippingText = o.shippingConsulted && o.shippingFee !== null && o.shippingFee !== undefined
      ? formatCurrency(o.shippingFee)
      : '<span style="color:var(--muted)">Não consultado</span>';

    const linkedPartText = o.partId
      ? `<div style="font-weight:600;color:var(--text)">${escapeHtml(o.partBrand || '')} ${escapeHtml(o.partModel || '')}</div>
         <div style="font-size:0.75rem;color:var(--muted)">Venda Bios: ${formatCurrency(o.partSellPrice)}</div>`
      : '<span class="badge badge-muted">Avulsa (não vinculada)</span>';

    const lastCheckedDate = o.lastChecked ? formatDate(o.lastChecked) + ' ' + (o.lastChecked.slice(11, 16) || '') : 'Nunca';

    return `
      <tr style="${isStale ? 'background:rgba(247,208,112,0.04)' : ''}">
        <td>
          ${supplierBadges[o.supplierId] || `<span class="badge">${escapeHtml(o.supplierId)}</span>`}
          <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">${escapeHtml(o.seller || o.supplierId)}</div>
        </td>
        <td>
          <div style="font-weight:600;color:var(--text);max-width:280px;line-height:1.3">${escapeHtml(o.title)}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">
            ${o.storeSku ? `SKU: <code>${escapeHtml(o.storeSku)}</code> ` : ''}
            ${o.ean ? `EAN: <code>${escapeHtml(o.ean)}</code>` : ''}
          </div>
        </td>
        <td>${linkedPartText}</td>
        <td>
          <div style="font-weight:800;color:var(--accent);font-size:0.95rem">${o.pricePix !== null ? formatCurrency(o.pricePix) : '—'}</div>
        </td>
        <td>
          <div style="font-weight:600;color:var(--text)">${o.priceCard !== null ? formatCurrency(o.priceCard) : '—'}</div>
          ${o.cardInstallments ? `<div style="font-size:0.72rem;color:var(--muted)">${escapeHtml(o.cardInstallments)}</div>` : ''}
        </td>
        <td>${shippingText}</td>
        <td>${availBadge}</td>
        <td>
          <div style="font-size:0.8rem">${lastCheckedDate}</div>
          ${isStale ? '<span class="badge badge-warning" style="font-size:0.7rem;margin-top:2px" title="Falha na última consulta. O preço anterior foi preservado.">Preço Antigo</span>' : ''}
        </td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="addOfferToQuote('${escapeHtml(o.id)}')" title="Incluir como peça no orçamento">
            + Orçamento
          </button>
          <button class="btn btn-secondary btn-sm" onclick="syncSingleOffer('${escapeHtml(o.id)}')" title="Consultar preço ao vivo agora">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openSupplierOfferModal('${escapeHtml(o.id)}')" title="Editar Oferta">
            Editar
          </button>
          <a class="btn btn-ghost btn-sm" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer" title="Abrir página na loja">
            ↗
          </a>
          <button class="btn btn-danger btn-sm" onclick="deleteOffer('${escapeHtml(o.id)}')" title="Excluir Oferta">
            ✕
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function addOfferToQuote(offerId) {
  const offers = DB.get('supplierOffers') || [];
  const o = quoteCatalogOffers.get(offerId) || offers.find(x => x.id === offerId) || currentSearchResults.find(x => x.id === offerId);
  if (!o) return showToast('Oferta não encontrada.', 'error');
  if (o.availability === 'esgotado') return showToast('Esta oferta está esgotada na loja.', 'error');

  const cost = o.pricePix || o.priceCard || 0;
  if (!cost) return showToast('Confirme o preço desta oferta antes de adicioná-la.', 'error');
  const suggestedPrice = o.partSellPrice > 0 ? o.partSellPrice : Math.round(cost * 1.25 * 100) / 100;

  // Se o modal de orçamento não estiver aberto, abre um novo orçamento
  const quoteModal = document.getElementById('quoteModalOverlay');
  if (!quoteModal || !quoteModal.classList.contains('active')) {
    await openQuoteModal();
  }

  // Adicionar item na tabela de itens do orçamento
  currentQuoteItems.push({
    id: 'qi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: 'peca',
    name: o.title,
    details: `Fornecedor: ${o.supplierName || o.supplierId} | SKU: ${o.storeSku || '—'} | ${o.url}`,
    quantity: 1,
    unitPrice: suggestedPrice,
    subtotal: suggestedPrice,
    unitCost: cost,
    costSubtotal: cost,
    showDetails: false,
    supplier: o.supplierName || o.supplierId,
    sku: o.storeSku || '',
    itemId: o.partId || null
  });

  clearQuoteSearch();
  renderQuoteItemRows();
  recalcQuoteFinancials();
  showToast(o.isStale ? 'Oferta adicionada. Confira o preço na loja antes de finalizar.' : `Item "${o.title.slice(0, 30)}..." adicionado ao orçamento!`, o.isStale ? 'info' : 'success');
}

let currentSearchResults = [];
let storeSearchSequence = 0;

async function searchStores(page = 1) {
  const sequence = ++storeSearchSequence;
  const queryInput = document.getElementById('storeSearchQuery');
  const q = (queryInput?.value || '').trim();
  if (!q) {
    return showToast('Informe o termo para busca nas lojas.', 'error');
  }

  const supplier = document.getElementById('storeSearchSupplier')?.value || 'all';
  const container = document.getElementById('storeSearchResultsContainer');
  const loading = document.getElementById('storeSearchLoading');
  const tbody = document.getElementById('storeSearchResultsTbody');
  const titleEl = document.getElementById('storeSearchSummaryTitle');
  const btnImport = document.getElementById('btnImportBatch');

  container.style.display = 'block';
  loading.style.display = 'block';
  tbody.innerHTML = '';
  btnImport.style.display = 'none';
  titleEl.textContent = `Buscando por "${q}" no catálogo salvo...`;

  try {
    const res = await fetchAdmin(`/api/suppliers/catalog?q=${encodeURIComponent(q)}&supplier=${encodeURIComponent(supplier)}&limit=30&page=${page}`);
    const data = await res.json();
    if (sequence !== storeSearchSequence) return;
    if (!res.ok) throw new Error(data.error || 'Falha ao buscar nas lojas parceiras.');

    loading.style.display = 'none';
    currentSearchResults = data.results || [];

    titleEl.textContent = `${data.total} ofertas para "${q}" · página ${data.page} de ${Math.max(data.pages, 1)}`;
    let pagination = document.getElementById('storeSearchPagination');
    if (!pagination) {
      pagination = document.createElement('div');
      pagination.id = 'storeSearchPagination';
      pagination.style.cssText = 'display:flex;gap:8px;margin-top:12px';
      container.appendChild(pagination);
    }
    pagination.innerHTML = `<button class="btn btn-ghost btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="searchStores(${page - 1})">Anterior</button><button class="btn btn-ghost btn-sm" ${page >= data.pages ? 'disabled' : ''} onclick="searchStores(${page + 1})">Próxima</button>`;

    if (!currentSearchResults.length) {
      const emptyMsg = 'Nenhum produto encontrado no catálogo salvo. A coleta automática pode ainda estar pendente.';
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state" style="padding:20px"><p>${emptyMsg}</p></td></tr>`;
      return;
    }

    const supplierBadges = {
      kabum: '<span class="badge" style="background:rgba(255,101,0,0.15);color:#ff6500;border:1px solid rgba(255,101,0,0.4)">KaBuM!</span>',
      pichau: '<span class="badge" style="background:rgba(204,0,0,0.15);color:#ff4d4d;border:1px solid rgba(204,0,0,0.4)">Pichau</span>',
      terabyte: '<span class="badge" style="background:rgba(255,152,0,0.15);color:#ff9800;border:1px solid rgba(255,152,0,0.4)">Terabyte</span>'
    };

    tbody.innerHTML = currentSearchResults.map((it, idx) => {
      const timeStr = it.lastChecked ? new Date(it.lastChecked).toLocaleString('pt-BR') : '—';
      const availBadge = it.availability === 'em_estoque'
        ? '<span class="badge badge-success">Disponível na loja</span>'
        : it.availability === 'esgotado' ? '<span class="badge badge-danger">Esgotado</span>' : '<span class="badge">A confirmar</span>';

      return `
        <tr>
          <td style="text-align:center">
            <input type="checkbox" class="chk-search-result" data-idx="${idx}" onchange="updateSelectedSearchCount()">
          </td>
          <td>${supplierBadges[it.supplier] || `<span class="badge">${escapeHtml(it.supplier)}</span>`}</td>
          <td><span style="font-size:0.8rem;color:var(--muted)">${escapeHtml(it.seller || it.supplierName)}</span></td>
          <td>
            <div style="font-weight:600;color:var(--text);max-width:320px;line-height:1.3">${escapeHtml(it.title)}</div>
            <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">
              ${it.storeSku ? `SKU: <code>${escapeHtml(it.storeSku)}</code> ` : ''}
              ${it.ean ? `EAN: <code>${escapeHtml(it.ean)}</code>` : ''}
            </div>
          </td>
          <td>
            <div style="font-weight:800;color:var(--accent)">${it.pricePix !== null ? formatCurrency(it.pricePix) : '—'}</div>
          </td>
          <td>
            <div style="font-weight:600;color:var(--text)">${it.priceCard !== null ? formatCurrency(it.priceCard) : '—'}</div>
            ${it.cardInstallments ? `<div style="font-size:0.7rem;color:var(--muted)">${escapeHtml(it.cardInstallments)}</div>` : ''}
          </td>
          <td><span style="color:var(--muted);font-size:0.8rem">Não consultado</span></td>
          <td>${availBadge}</td>
          <td><span style="font-size:0.8rem;color:var(--muted)">${timeStr}${it.isStale ? '<br>Atualização pendente' : ''}</span></td>
          <td style="text-align:right">
            <a class="btn btn-ghost btn-sm" href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer" title="Abrir link na loja">↗</a>
          </td>
        </tr>
      `;
    }).join('');

    const chkAll = document.getElementById('chkSelectAllSearchResults');
    if (chkAll) chkAll.checked = false;
    updateSelectedSearchCount();

  } catch (err) {
    if (sequence !== storeSearchSequence) return;
    loading.style.display = 'none';
    showToast(err.message, 'error');
  }
}

function toggleSelectAllSearchResults(checked) {
  const checkboxes = document.querySelectorAll('.chk-search-result');
  checkboxes.forEach(chk => chk.checked = checked);
  updateSelectedSearchCount();
}

function updateSelectedSearchCount() {
  const checked = document.querySelectorAll('.chk-search-result:checked');
  const count = checked.length;
  const countDisplay = document.getElementById('selectedCountDisplay');
  const btnImport = document.getElementById('btnImportBatch');
  if (countDisplay) countDisplay.textContent = count;
  if (btnImport) {
    btnImport.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

async function importSelectedSearchResults() {
  const checked = document.querySelectorAll('.chk-search-result:checked');
  if (!checked.length) return showToast('Selecione ao menos um produto para importar.', 'error');

  const selectedItems = [];
  checked.forEach(chk => {
    const idx = parseInt(chk.dataset.idx, 10);
    if (currentSearchResults[idx]) {
      selectedItems.push(currentSearchResults[idx]);
    }
  });

  for (const offer of selectedItems) await addOfferToQuote(offer.id);
}

function clearSearchResults() {
  ++storeSearchSequence;
  const container = document.getElementById('storeSearchResultsContainer');
  if (container) container.style.display = 'none';
  const tbody = document.getElementById('storeSearchResultsTbody');
  if (tbody) tbody.innerHTML = '';
  const q = document.getElementById('storeSearchQuery');
  if (q) q.value = '';
  currentSearchResults = [];
  updateSelectedSearchCount();
}

async function toggleSupplierStatus(supplierId) {
  const suppliers = DB.get('suppliers') || [];
  const sup = suppliers.find(s => s.id === supplierId);
  if (!sup) return;

  const nextStatus = sup.status === 'ativo' ? 'inativo' : 'ativo';
  try {
    const res = await fetchAdmin(`/api/suppliers/${encodeURIComponent(supplierId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    if (!res.ok) throw new Error('Não foi possível alterar status do conector.');
    showToast(`Conector ${sup.name} agora está ${nextStatus}.`);
    await DB.sync();
    renderSuppliers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadSupplierSyncLogs() {
  const tbody = document.getElementById('syncLogsTableBody');
  if (!tbody) return;
  try {
    const res = await fetchAdmin('/api/supplier-sync-logs?limit=15');
    if (!res.ok) return;
    const logs = await res.json();
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding:16px"><p>Nenhuma sincronização em lote registrada até o momento.</p></td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${formatDate(l.created)} ${l.created.slice(11, 19)}</td>
        <td>${escapeHtml(l.supplierName || l.supplierId || 'Todos')}</td>
        <td>
          <span class="badge ${l.status === 'sucesso' ? 'badge-success' : (l.status === 'parcial' ? 'badge-warning' : 'badge-danger')}">
            ${escapeHtml(l.status)}
          </span>
        </td>
        <td>${l.successCount}/${l.offerCount} ok</td>
        <td>${l.durationMs ? `${l.durationMs}ms` : '—'}</td>
        <td style="font-size:0.75rem;color:var(--muted);max-width:250px;overflow:hidden;text-overflow:ellipsis">
          ${escapeHtml(l.error || 'Concluído')}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Falha ao carregar logs:', err);
  }
}

function openSupplierPreviewModal() {
  document.getElementById('importUrlInput').value = '';
  document.getElementById('importLoadingSpinner').style.display = 'none';
  document.getElementById('importPreviewCard').style.display = 'none';
  document.getElementById('btnSaveImportedOffer').style.display = 'none';
  currentPreviewOfferData = null;
  openModal('supplierPreviewModalOverlay');
}

async function consultSupplierUrl() {
  const urlInput = document.getElementById('importUrlInput');
  const url = (urlInput?.value || '').trim();
  if (!url) {
    return showToast('Insira a URL do produto na KaBuM!, Pichau ou Terabyte.', 'error');
  }

  const spinner = document.getElementById('importLoadingSpinner');
  const card = document.getElementById('importPreviewCard');
  const btnSave = document.getElementById('btnSaveImportedOffer');

  spinner.style.display = 'block';
  card.style.display = 'none';
  btnSave.style.display = 'none';

  try {
    const res = await fetchAdmin('/api/suppliers/preview-url', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao consultar fornecedor.');

    const prev = data.preview;
    currentPreviewOfferData = prev;

    document.getElementById('prevSupplierBadge').textContent = prev.supplierName || prev.supplier;
    document.getElementById('prevSellerBadge').textContent = `Vendido por: ${prev.seller || prev.supplierName}`;
    document.getElementById('prevTitle').textContent = prev.title || 'Produto sem título';
    document.getElementById('prevPricePix').textContent = prev.pricePix !== null ? formatCurrency(prev.pricePix) : 'Não discriminado';
    document.getElementById('prevPriceCard').textContent = prev.priceCard !== null ? formatCurrency(prev.priceCard) : '—';
    document.getElementById('prevInstallments').textContent = prev.cardInstallments || 'À vista ou consulte opções';
    document.getElementById('prevShipping').textContent = prev.shippingConsulted && prev.shippingFee !== null ? formatCurrency(prev.shippingFee) : 'Não consultado';
    document.getElementById('prevCodes').textContent = `SKU: ${prev.storeSku || '—'} · EAN: ${prev.ean || '—'} · MPN: ${prev.manufacturerCode || '—'}`;

    const stockBadge = document.getElementById('prevStockBadge');
    if (stockBadge) {
      stockBadge.textContent = prev.availability === 'em_estoque' ? 'Em Estoque' : (prev.availability === 'esgotado' ? 'Esgotado' : 'Sob Consulta');
      stockBadge.className = prev.availability === 'em_estoque' ? 'badge badge-success' : 'badge badge-danger';
    }

    const select = document.getElementById('prevLinkPartSelect');
    if (select) {
      const parts = (DB.get('parts') || []).filter(p => p.active === 1);
      select.innerHTML = '<option value="">Não vincular agora (apenas registrar oferta)</option>' +
        parts.map(p => `
          <option value="${p.id}" ${data.matchedPart && data.matchedPart.id === p.id ? 'selected' : ''}>
            ${escapeHtml(p.brand)} ${escapeHtml(p.model)} [SKU: ${escapeHtml(p.sku || '—')}] - Venda: ${formatCurrency(p.price)}
          </option>
        `).join('');
    }

    const matchLabel = document.getElementById('matchStatusLabel');
    if (matchLabel) {
      if (data.matchedPart) {
        matchLabel.innerHTML = `<span style="color:var(--accent)">✓ Correspondência exata sugerida por SKU/EAN:</span> <strong>${escapeHtml(data.matchedPart.brand)} ${escapeHtml(data.matchedPart.model)}</strong>`;
      } else {
        matchLabel.textContent = 'Vínculo com o Catálogo de Peças da Bios';
      }
    }

    spinner.style.display = 'none';
    card.style.display = 'block';
    btnSave.style.display = 'inline-flex';
  } catch (err) {
    spinner.style.display = 'none';
    showToast(err.message, 'error');
  }
}

async function saveImportedOffer() {
  if (!currentPreviewOfferData) return;
  const prev = currentPreviewOfferData;
  const linkPartId = document.getElementById('prevLinkPartSelect')?.value || null;
  const createPart = document.getElementById('chkCreatePartFromOffer')?.checked || false;

  try {
    let finalPartId = linkPartId;

    if (createPart && !finalPartId) {
      const cost = prev.pricePix || 100;
      const price = Math.round(cost * 1.25 * 100) / 100;
      const partPayload = {
        category: 'Hardware',
        brand: prev.manufacturerCode ? 'Componente' : (prev.seller || 'Hardware'),
        model: prev.title.slice(0, 150),
        sku: prev.ean || prev.storeSku || '',
        specs: `Importado de ${prev.supplierName}. SKU Loja: ${prev.storeSku || '—'}`,
        supplier: prev.supplierName,
        cost,
        price,
        status: prev.availability === 'em_estoque' ? 'em_estoque' : 'sob_encomenda',
        active: 1
      };
      const resPart = await fetchAdmin('/api/parts', {
        method: 'POST',
        body: JSON.stringify(partPayload)
      });
      const dataPart = await resPart.json();
      if (resPart.ok && dataPart.id) {
        finalPartId = dataPart.id;
      }
    }

    const offerPayload = {
      partId: finalPartId,
      supplierId: prev.supplier,
      storeSku: prev.storeSku,
      ean: prev.ean,
      manufacturerCode: prev.manufacturerCode,
      title: prev.title,
      url: prev.url,
      seller: prev.seller,
      fulfillmentBy: prev.fulfillmentBy,
      condition: prev.condition || 'novo',
      pricePix: prev.pricePix,
      priceCard: prev.priceCard,
      cardInstallments: prev.cardInstallments,
      availability: prev.availability || 'em_estoque',
      shippingConsulted: prev.shippingConsulted || 0,
      shippingFee: prev.shippingFee,
      autoSync: 1
    };

    const res = await fetchAdmin('/api/supplier-offers', {
      method: 'POST',
      body: JSON.stringify(offerPayload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível salvar a oferta.');

    closeModalDirect('supplierPreviewModalOverlay');
    showToast('Oferta cadastrada e acompanhada com sucesso!');
    await DB.sync();
    renderSuppliers();
    if (createPart) renderParts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function syncSingleOffer(id) {
  try {
    showToast('Consultando oferta no fornecedor...', 'info');
    const res = await fetchAdmin(`/api/supplier-offers/${encodeURIComponent(id)}/sync`, {
      method: 'POST',
      body: '{}'
    });
    const data = await res.json();
    if (!res.ok) {
      await DB.sync();
      renderSuppliers();
      throw new Error(data.error || 'Falha ao atualizar oferta.');
    }
    showToast('Oferta sincronizada com sucesso!');
    await DB.sync();
    renderSuppliers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openSupplierOfferModal(offerId = null) {
  const parts = DB.get('parts') || [];
  const partSelect = document.getElementById('offerEditPart');
  if (partSelect) {
    partSelect.innerHTML = '<option value="">Nenhuma (oferta avulsa)</option>' +
      parts.map(p => `<option value="${p.id}">${escapeHtml(p.brand)} ${escapeHtml(p.model)} (Venda: ${formatCurrency(p.price)})</option>`).join('');
  }

  const form = document.getElementById('offerEditForm');
  if (form) form.reset();
  document.getElementById('offerEditId').value = offerId || '';

  if (offerId) {
    const offers = DB.get('supplierOffers') || [];
    const o = offers.find(x => x.id === offerId);
    if (o) {
      document.getElementById('offerEditModalTitle').textContent = 'Editar Oferta de Fornecedor';
      document.getElementById('offerEditSupplier').value = o.supplierId;
      document.getElementById('offerEditPart').value = o.partId || '';
      document.getElementById('offerEditTitle').value = o.title || '';
      document.getElementById('offerEditUrl').value = o.url || '';
      document.getElementById('offerEditPricePix').value = o.pricePix !== null ? o.pricePix : '';
      document.getElementById('offerEditPriceCard').value = o.priceCard !== null ? o.priceCard : '';
      document.getElementById('offerEditInstallments').value = o.cardInstallments || '';
      document.getElementById('offerEditAvailability').value = o.availability || 'em_estoque';
      document.getElementById('offerEditSeller').value = o.seller || '';
      document.getElementById('offerEditCondition').value = o.condition || 'novo';
      document.getElementById('offerEditStoreSku').value = o.storeSku || '';
      document.getElementById('offerEditEan').value = o.ean || '';
      document.getElementById('offerEditManufacturerCode').value = o.manufacturerCode || '';
      document.getElementById('offerEditAutoSync').value = o.autoSync !== 0 ? '1' : '0';
    }
  } else {
    document.getElementById('offerEditModalTitle').textContent = 'Cadastrar Oferta de Fornecedor';
  }

  openModal('supplierOfferEditModalOverlay');
}

async function saveOfferManual(e) {
  e.preventDefault();
  const id = document.getElementById('offerEditId').value;
  const payload = {
    supplierId: document.getElementById('offerEditSupplier').value,
    partId: document.getElementById('offerEditPart').value || null,
    title: document.getElementById('offerEditTitle').value.trim(),
    url: document.getElementById('offerEditUrl').value.trim(),
    pricePix: parseFloat(document.getElementById('offerEditPricePix').value) || null,
    priceCard: parseFloat(document.getElementById('offerEditPriceCard').value) || null,
    cardInstallments: document.getElementById('offerEditInstallments').value.trim(),
    availability: document.getElementById('offerEditAvailability').value,
    seller: document.getElementById('offerEditSeller').value.trim(),
    condition: document.getElementById('offerEditCondition').value,
    storeSku: document.getElementById('offerEditStoreSku').value.trim(),
    ean: document.getElementById('offerEditEan').value.trim(),
    manufacturerCode: document.getElementById('offerEditManufacturerCode').value.trim(),
    autoSync: document.getElementById('offerEditAutoSync').value === '1' ? 1 : 0
  };

  try {
    const url = id ? `/api/supplier-offers/${encodeURIComponent(id)}` : '/api/supplier-offers';
    const method = id ? 'PUT' : 'POST';
    const res = await fetchAdmin(url, { method, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível salvar a oferta.');

    closeModalDirect('supplierOfferEditModalOverlay');
    showToast(id ? 'Oferta atualizada com sucesso!' : 'Oferta cadastrada com sucesso!');
    await DB.sync();
    renderSuppliers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteOffer(id) {
  if (!confirm('Deseja excluir esta oferta monitorada? O histórico desta consulta será removido.')) return;
  try {
    const res = await fetchAdmin(`/api/supplier-offers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Não foi possível excluir oferta.');
    showToast('Oferta excluída.');
    await DB.sync();
    renderSuppliers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveSupplierSettings() {
  const time = document.getElementById('schedSyncTime')?.value || '06:00';
  try {
    const res = await fetchAdmin('/api/supplier-settings', {
      method: 'PUT',
      body: JSON.stringify({
        daily_sync_time: time,
        daily_sync_enabled: '0',
        timezone: 'America/Sao_Paulo'
      })
    });
    if (!res.ok) throw new Error('Erro ao salvar preferências de sincronização.');
    showToast('Preferências salvas (agendamento em produção mantido desativado).');
    await DB.sync();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function checkQuoteSupplierPrices(quoteId) {
  currentCompareQuoteId = quoteId;
  try {
    showToast('Consultando cotações das peças do orçamento...', 'info');
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(quoteId)}/check-supplier-prices`, {
      method: 'POST',
      body: '{}'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Não foi possível comparar preços.');

    const tbody = document.getElementById('quoteCompareTableBody');
    if (!tbody) return;

    if (!data.comparisons || !data.comparisons.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Nenhum item com peça vinculada a fornecedores neste orçamento.</p></td></tr>';
      openModal('quoteSupplierCompareModalOverlay');
      return;
    }

    tbody.innerHTML = data.comparisons.map(c => {
      const hasOffer = !!c.supplierOffer;
      const diff = hasOffer ? (c.supplierOffer.suggestedCost - c.currentUnitCost) : 0;
      const diffText = hasOffer
        ? `<span style="font-weight:700;color:${diff < 0 ? 'var(--accent)' : (diff > 0 ? 'var(--danger)' : 'var(--muted)')}">
             ${diff > 0 ? '+' : ''}${formatCurrency(diff)}
           </span>`
        : '—';

      const offerInfo = hasOffer
        ? `<div><strong>${escapeHtml(c.supplierOffer.supplierName)}</strong>: ${formatCurrency(c.supplierOffer.pricePix)}</div>
           <div style="font-size:0.75rem;color:var(--muted)">Consulta: ${formatDate(c.supplierOffer.lastChecked)}</div>
           ${c.supplierOffer.isStale ? '<span class="badge badge-warning" style="font-size:0.68rem">Preço Antigo</span>' : ''}`
        : '<span style="color:var(--muted)">Sem oferta vinculada</span>';

      return `
        <tr>
          <td style="text-align:center">
            <input type="checkbox" class="quote-compare-check" data-item-id="${escapeHtml(c.quoteItemId)}" data-new-cost="${hasOffer ? c.supplierOffer.suggestedCost : ''}" ${hasOffer && c.hasDiff ? 'checked' : ''} ${!hasOffer ? 'disabled' : ''}>
          </td>
          <td>
            <div style="font-weight:600;color:var(--text)">${escapeHtml(c.itemName)}</div>
            <div style="font-size:0.75rem;color:var(--muted)">Qtd: ${c.quantity} · Subtotal atual: ${formatCurrency(c.subtotal)}</div>
          </td>
          <td style="text-align:right">${formatCurrency(c.currentUnitCost)}</td>
          <td style="text-align:right;font-weight:600">${formatCurrency(c.currentUnitPrice)}</td>
          <td>${offerInfo}</td>
          <td style="text-align:right;font-weight:700;color:var(--accent)">
            ${hasOffer ? formatCurrency(c.supplierOffer.suggestedCost) : '—'}
          </td>
          <td style="text-align:right">${diffText}</td>
        </tr>
      `;
    }).join('');

    openModal('quoteSupplierCompareModalOverlay');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmApplySupplierPrices() {
  if (!currentCompareQuoteId) return;
  const checkboxes = document.querySelectorAll('.quote-compare-check:checked');
  if (!checkboxes.length) {
    return showToast('Selecione pelo menos um item para atualizar os preços.', 'error');
  }

  const updates = [];
  checkboxes.forEach(cb => {
    const quoteItemId = cb.getAttribute('data-item-id');
    const newCost = parseFloat(cb.getAttribute('data-new-cost'));
    if (quoteItemId && !isNaN(newCost)) {
      updates.push({
        quoteItemId,
        newUnitCost: newCost
      });
    }
  });

  try {
    const res = await fetchAdmin(`/api/quotes/${encodeURIComponent(currentCompareQuoteId)}/apply-supplier-prices`, {
      method: 'POST',
      body: JSON.stringify({ updates })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao aplicar preços atualizados.');

    closeModalDirect('quoteSupplierCompareModalOverlay');

    if (data.requiresNewApproval) {
      showToast(`Preços atualizados! Nova versão v${data.version} gerada. Como a proposta já estava em circulação, nova aprovação do cliente é exigida.`);
    } else {
      showToast('Preços atualizados com sucesso no orçamento!');
    }

    await DB.sync();
    renderQuotes();
    viewQuote(currentCompareQuoteId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   Sessão Administrativa
   ========================================================================== */
function resetSession() {
  DB.cache = { clients: [], services: [], orders: [], parts: [], quotes: [], settings: {} };
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  const pass = document.getElementById('loginPass');
  if (pass) pass.value = '';
}

function showCredentials() {
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  document.getElementById('page-configuracoes').classList.add('active');
  document.getElementById('pageTitle').textContent = 'Troca de Senha Padrão Obrigatória';
  document.getElementById('sidebar').classList.remove('open');
  showToast('Por segurança, a senha padrão deve ser substituída antes de acessar os dados.', 'error');
}

async function openSession(user) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  const avatar = document.getElementById('sidebarAvatar');
  const userEl = document.getElementById('sidebarUsername');
  const topbarUserEl = document.getElementById('topbarUsername');
  if (avatar) avatar.textContent = (user.username || 'Admin').slice(0, 2).toUpperCase();
  if (userEl) userEl.textContent = user.username || 'Administrador';
  if (topbarUserEl) topbarUserEl.textContent = user.username || 'Admin';

  if (user.mustChange) {
    showCredentials();
    document.getElementById('credCurrentUsername').value = user.username;
    document.getElementById('credNewUsername').value = user.username;
    return;
  }

  if (await DB.sync()) {
    showPage('dashboard');
    renderAll();
  } else {
    showToast('Não foi possível carregar os cadastros. Verifique a conexão com o servidor.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  sessionStorage.removeItem('bios_session_token');
  fetchAdmin('/api/me')
    .then(r => r.ok ? r.json() : null)
    .then(user => user && openSession(user))
    .catch(() => {});
});
