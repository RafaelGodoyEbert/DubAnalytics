/* core.js - Standalone Management System Controller */

window.State = {
  activeView: 'general',
  clients: [],
  videos: [],
  monthlyConfigs: [],
  selectedClient: null,
  selectedMonth: null,
  clientSubView: 'overview',
  filters: { timeframe: 'month', year: 'all', showInactive: true },
  targetHourlyRate: 60,
  privacyMode: false,
  user: null
};

const State = window.State;

/* ========== BOOT ========== */
let _booted = false;
window.boot = async function() {
  if (_booted) { console.log('BOOT: Já inicializado, ignorando chamada duplicada.'); return; }
  _booted = true;
  
  await DB.initDB();
  
  // Real-time event listener (only once)
  window.addEventListener('db-updated', (e) => {
    // Use loadStateFromDB only for massive syncs if detailed in e.detail.bulk
    if (e.detail && e.detail.bulk) {
        console.log('CORE: Sincronização massiva detectada. Recarregando banco...');
        loadStateFromDB();
    } else {
        window.refreshUI();
    }
  });

  await loadStateFromDB();
  
  if (State.clients.length === 0) {
    showView('import');
  } else {
    showView('general');
  }
  
  renderYearSelector();
  setupEventListeners();
  
  // Privacy Mode Init
  State.privacyMode = localStorage.getItem('dub_privacy_mode') === '1';
  applyPrivacyMode();

  updateUserInfo();
};

window.clearState = function() {
  State.clients = [];
  State.videos = [];
  State.monthlyConfigs = [];
  State.selectedClient = null;
  State.selectedMonth = null;
  State.activeView = 'general';
  
  updateSidebar();
  updateUserInfo();
  showView('general');
  renderGeneralAnalytics();
};

window.updateUserInfo = function() {
  const userBox = document.getElementById('user-info-box');
  if (!userBox) return;

  const user = AuthUI.user || (window.auth && window.auth.currentUser);
  if (user) {
    userBox.innerHTML = `
      <div style="font-size:10px; color:var(--text-dim); margin-bottom:5px; text-transform:uppercase; letter-spacing:0.05em">Sessão Ativa:</div>
      <div style="font-weight:700; font-size:12px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:10px" title="${user.email}">${user.email}</div>
      <button onclick="window.handleLogout()" class="btn-ghost" style="color:var(--danger); padding:8px 12px; font-size:11px; width:100%; text-align:center; border-color:rgba(239, 68, 68, 0.3); background:rgba(239, 68, 68, 0.05)">Sair da Conta</button>
    `;
  } else {
    userBox.innerHTML = `
      <div style="padding:10px; background:rgba(99, 102, 241, 0.1); border:1px solid rgba(99, 102, 241, 0.2); border-radius:8px; text-align:center">
        <div style="font-size:9px; font-weight:800; color:#a5b4fc; margin-bottom:4px">MODO LOCAL (OFFLINE)</div>
        <div style="font-size:9px; color:var(--text-dim); margin-bottom:10px; line-height:1.2">Dados não sincronizados.</div>
        <button onclick="AuthUI.showLoginScreen()" class="btn-accent" style="width:100%; padding:8px; font-size:10px; border-radius:6px">Fazer Login</button>
      </div>
    `;
  }
};

window.loadStateFromDB = async function() {
  console.log('CORE: Carregando estado do IndexedDB...');
  State.clients = await DB.getAll('clients');
  State.videos = await DB.getAll('videos');
  State.monthlyConfigs = await DB.getAll('monthlyConfig');
  
  // Cleanup orphans from previous bugs (ghost clients)
  var validClientIds = new Set(State.clients.map(c => c.id));
  State.videos = State.videos.filter(v => validClientIds.has(v.clientId));
  State.monthlyConfigs = State.monthlyConfigs.filter(m => validClientIds.has(m.clientId));

  // Ensure every client has an 'active' property
  State.clients.forEach(c => {
    if (c.active === undefined) c.active = true;
  });
  
  window.refreshUI();
}

/**
 * Rápida atualização da interface usando dados já em memória
 */
window.refreshUI = function() {
  updateSidebar();
  
  if (State.activeView === 'general') {
    renderGeneralAnalytics();
  } else if (State.activeView === 'client' && State.selectedClient) {
    // Verifica se o cliente selecionado ainda existe (caso tenha sido deletado via sync)
    const exists = State.clients.find(c => c.id === State.selectedClient.id);
    if (!exists) {
      showView('general');
    } else {
      renderClientWorkspace();
    }
  }
}

/* ========== VIEW CONTROLLER ========== */
window.showView = function showView(viewId) {
  State.activeView = viewId;
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  var el = document.getElementById(viewId + '-view');
  if (el) el.classList.add('active');
  
  document.querySelectorAll('#sidebar .nav-item').forEach(function(li) { li.classList.remove('active'); });
  var activeNav = document.querySelector('[data-view="' + viewId + '"]');
  if (activeNav) activeNav.classList.add('active');

  // Update Mobile Title
  var mobileTitle = document.getElementById('mobile-view-title');
  if (mobileTitle) {
    if (viewId === 'general') mobileTitle.innerText = 'Visão Global';
    else if (viewId === 'import') mobileTitle.innerText = 'Importar';
    else if (viewId === 'client' && State.selectedClient) mobileTitle.innerText = State.selectedClient.name;
  }

  closeMobileMenu();

  if (viewId === 'general') renderGeneralAnalytics();
  if (viewId === 'client') renderClientWorkspace();
};

/* ========== MOBILE MENU CONTROLLER ========== */
window.toggleMobileMenu = function() {
  document.body.classList.toggle('sidebar-open');
};

window.closeMobileMenu = function() {
  document.body.classList.remove('sidebar-open');
};

/* ========== GENERAL OVERVIEW ========== */
function renderGeneralAnalytics() {
  var timeframe = State.filters.timeframe;
  var activeClientIds = State.clients.filter(c => c.active).map(c => c.id);
  
  var filteredVideos = State.videos;
  
  // Filter by active clients unless specifically requested
  if (!State.filters.showInactive) {
    filteredVideos = filteredVideos.filter(v => activeClientIds.includes(v.clientId));
  }

  if (State.filters.year !== 'all') {
    filteredVideos = filteredVideos.filter(function(v) { return String(v.year) === String(State.filters.year); });
  }

  var filteredConfigs = State.monthlyConfigs;
  if (!State.filters.showInactive) {
    filteredConfigs = filteredConfigs.filter(c => activeClientIds.includes(c.clientId));
  }

  var aggregated = Analytics.groupData(filteredVideos, filteredConfigs, timeframe);
  var advanced = Analytics.getAdvancedMetrics(filteredVideos);
  
  var totalEarnings = aggregated.reduce(function(s, d) { return s + d.earnings; }, 0);
  var totalVideos = aggregated.reduce(function(s, d) { return s + d.count; }, 0);
  var totalTime = aggregated.reduce(function(s, d) { return s + d.time; }, 0);
  var avgPerVideo = totalVideos > 0 ? totalTime / totalVideos : 0;
  var perHour = totalTime > 0 ? totalEarnings / (totalTime / 3600) : 0;

  // Monthly Average Calculation
  var monthlyAgg = (timeframe === 'month') ? aggregated : Analytics.groupData(filteredVideos, filteredConfigs, 'month');
  var numMonths = monthlyAgg.length;
  var avgMonth = numMonths > 0 ? totalEarnings / numMonths : 0;

  var activeClientsInPeriod = State.clients.filter(c => c.active).length;

  document.getElementById('gen-total-earnings').innerText = 'R$ ' + totalEarnings.toLocaleString('pt-BR', {minimumFractionDigits: 2});
  document.getElementById('gen-avg-earnings-month').innerText = 'R$ ' + avgMonth.toLocaleString('pt-BR', {minimumFractionDigits: 2});
  document.getElementById('gen-total-videos').innerText = totalVideos.toLocaleString('pt-BR');
  document.getElementById('gen-avg-ratio').innerText = (advanced ? advanced.globalRatio.toFixed(2) : '0.0') + 'x';
  document.getElementById('gen-active-clients').innerText = activeClientsInPeriod;
  document.getElementById('gen-per-hour').innerText = 'R$ ' + perHour.toLocaleString('pt-BR', {minimumFractionDigits: 2});
  
  var genDays = (totalTime / 86400).toFixed(1);
  document.getElementById('gen-total-hours').innerHTML = ExcelParser.secondsToHMS(totalTime) + '<span style="font-size:14px; font-weight:normal; color:var(--text-dim); margin-left:8px">(~' + genDays + ' dias)</span>';
  document.getElementById('gen-chars-per-hour').innerText = (advanced ? (advanced.charsPerHour / 1000).toFixed(1) : '0') + ' k/h';
  document.getElementById('gen-avg-per-video').innerText = ExcelParser.secondsToHMS(avgPerVideo);
  
  Analytics.renderCharts('main-chart-canvas', aggregated);
  if (advanced) {
    Analytics.renderAdvancedCharts('gen-advanced-section', advanced);
  }
  renderYearSelector();
}

window.toggleShowInactive = function(val) {
  State.filters.showInactive = val;
  renderGeneralAnalytics();
};

function renderYearSelector() {
  var years = [];
  State.videos.forEach(function(v) {
    if (v.year && years.indexOf(v.year) === -1) years.push(v.year);
  });
  years.sort(function(a,b) { return b - a; });
  var sel = document.getElementById('gen-year');
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="all">Todos os Anos</option>' + years.map(function(y) {
    return '<option value="' + y + '"' + (String(current) === String(y) ? ' selected' : '') + '>' + y + '</option>';
  }).join('');
}

/* ========== SIDEBAR ========== */
function updateSidebar() {
  var list = document.getElementById('sidebar-client-list');
  if (!list) return;
  if (State.clients.length === 0) {
    list.innerHTML = '<div style="padding:15px 20px; font-size:11px; color:var(--text-dim)">Nenhum cliente</div>';
    return;
  }

  var activeClients = State.clients.filter(c => c.active).sort((a,b) => a.name.localeCompare(b.name));
  var inactiveClients = State.clients.filter(c => !c.active).sort((a,b) => a.name.localeCompare(b.name));

  var html = activeClients.map(function(c) {
    var isActive = State.selectedClient && State.selectedClient.id === c.id;
    return '<div class="nav-item' + (isActive ? ' active' : '') + '" onclick="selectClient(\'' + c.id + '\')">' +
       '<span title="Cliente Ativo">🟢</span> <span style="flex:1">' + c.name + '</span>' +
       '<div class="sidebar-actions">' +
         '<button onclick="toggleClientStatus(event, \'' + c.id + '\')" class="btn-sidebar" title="Desativar">💤</button>' +
         '<button onclick="deleteClient(event, \'' + c.id + '\')" class="btn-sidebar text-danger" title="Excluir">✕</button>' +
       '</div>' +
    '</div>';
  }).join('');

  if (inactiveClients.length > 0) {
    html += '<div style="padding:15px 20px 5px; font-size:9px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.1em">Arquivados / Inativos</div>';
    html += inactiveClients.map(function(c) {
      var isActive = State.selectedClient && State.selectedClient.id === c.id;
      return '<div class="nav-item' + (isActive ? ' active' : '') + '" style="opacity:0.5" onclick="selectClient(\'' + c.id + '\')">' +
         '<span title="Cliente Inativo">⚪</span> <span style="flex:1">' + c.name + '</span>' +
         '<div class="sidebar-actions">' +
           '<button onclick="toggleClientStatus(event, \'' + c.id + '\')" class="btn-sidebar" title="Reativar">⚡</button>' +
           '<button onclick="deleteClient(event, \'' + c.id + '\')" class="btn-sidebar text-danger" title="Excluir">✕</button>' +
         '</div>' +
      '</div>';
    }).join('');
  }

  list.innerHTML = html;
}

window.toggleClientStatus = function(e, id) {
  if (arguments.length === 1 && typeof e === 'string') { id = e; e = null; }
  if (e && e.stopPropagation) e.stopPropagation();
  else if (window.event && window.event.stopPropagation) window.event.stopPropagation();
  
  (async function() {
    var c = State.clients.find(x => x.id === id);
    if (!c) return;
    c.active = !c.active;
    await DB.put('clients', c);
    updateSidebar();
    if (State.activeView === 'general') renderGeneralAnalytics();
  })();
};

/* ========== CLIENT WORKSPACE ========== */
window.selectClient = function(id) {
  State.selectedClient = State.clients.find(function(c) { return c.id === id; });
  State.clientSubView = 'overview';
  State.selectedMonth = null;
  updateSidebar();
  showView('client');
};

function getClientMonthsSorted(clientId) {
  var MONTHS = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  return State.monthlyConfigs
    .filter(function(m) { 
      var parts = (m.label || '').split(' ');
      var isValid = m.clientId === clientId && parts.length >= 2 && MONTHS.indexOf(parts[0]) >= 0 && !isNaN(parseInt(parts[1]));
      return isValid;
    })
    .sort(function(a, b) { return ExcelParser.sortMonthLabelDesc(a.label, b.label); });
}

function renderClientWorkspace() {
  if (!State.selectedClient) return;
  document.getElementById('client-title').innerText = State.selectedClient.name;
  
  var clientMonths = getClientMonthsSorted(State.selectedClient.id);
  var monthList = document.getElementById('month-list');
  var html = '<div class="month-item' + (State.clientSubView === 'overview' ? ' active' : '') + '" onclick="showClientOverview()" style="font-weight:700; color:var(--accent)">📊 Visão Geral</div>';
  html += '<div class="month-item' + (State.clientSubView === 'benchmarks' ? ' active' : '') + '" onclick="showBenchmarks()" style="font-weight:700; color:#6366f1">🎯 Benchmarks</div>';
  html += clientMonths.map(function(m) {
    var isActive = State.selectedMonth && State.selectedMonth.id === m.id;
    return '<div class="month-item' + (isActive ? ' active' : '') + '" onclick="selectMonth(\'' + m.id + '\')">' + m.label + '</div>';
  }).join('');
  monthList.innerHTML = html;

  var overviewEl = document.getElementById('client-overview-section');
  var monthEl = document.getElementById('month-details-section');
  var benchEl = document.getElementById('benchmarks-section');

  overviewEl.style.display = 'none';
  monthEl.style.display = 'none';
  benchEl.style.display = 'none';

  if (State.clientSubView === 'overview') {
    overviewEl.style.display = 'flex';
    setTimeout(function() { renderClientOverview(); }, 50);
  } else if (State.clientSubView === 'benchmarks') {
    benchEl.style.display = 'flex';
    setTimeout(function() { renderBenchmarks(); }, 50);
  } else {
    monthEl.style.display = 'flex';
    if (State.selectedMonth) {
      setTimeout(function() { renderMonthDetails(); }, 50);
    }
  }
}

window.showBenchmarks = function() {
  State.clientSubView = 'benchmarks';
  State.selectedMonth = null;
  renderClientWorkspace();
  closeMobileMenu();
};

window.showClientOverview = function() {
  State.clientSubView = 'overview';
  State.selectedMonth = null;
  renderClientWorkspace();
  closeMobileMenu();
};

window.selectMonth = function(id) {
  State.selectedMonth = State.monthlyConfigs.find(function(m) { return m.id === id; });
  State.clientSubView = 'month';
  // On mobile, if we are in the months list, we might want to scroll to content or close some drawer
  // For now, renderClientWorkspace handles display
  renderClientWorkspace();
  
  // Scroll to top of content on mobile
  if (window.innerWidth <= 768) {
    var monthEl = document.getElementById('month-details-section');
    if (monthEl) monthEl.scrollIntoView({ behavior: 'smooth' });
  }
  closeMobileMenu();
};

/* ========== CLIENT OVERVIEW ========== */
function renderClientOverview() {
  if (!State.selectedClient) return;
  var cid = State.selectedClient.id;
  var cVideos = State.videos.filter(function(v) { return v.clientId === cid; });
  var cConfigs = State.monthlyConfigs.filter(function(m) { return m.clientId === cid; });
  
  var aggregated = Analytics.groupData(cVideos, cConfigs, 'month');
  var advanced = Analytics.getAdvancedMetrics(cVideos);

  var totalEarnings = aggregated.reduce(function(s, d) { return s + d.earnings; }, 0);
  var totalDone = aggregated.reduce(function(s, d) { return s + d.count; }, 0);
  var totalTime = aggregated.reduce(function(s, d) { return s + d.time; }, 0);
  var avgPerVideo = totalDone > 0 ? totalTime / totalDone : 0;
  var perHour = totalTime > 0 ? totalEarnings / (totalTime / 3600) : 0;
  
  var numMonths = aggregated.length;
  var avgMonth = numMonths > 0 ? totalEarnings / numMonths : 0;

  document.getElementById('co-earnings').innerText = 'R$ ' + totalEarnings.toLocaleString('pt-BR', {minimumFractionDigits: 2});
  document.getElementById('co-avg-earnings-month').innerText = 'R$ ' + avgMonth.toLocaleString('pt-BR', {minimumFractionDigits: 2});
  document.getElementById('co-videos').innerText = totalDone + '/' + cVideos.length;
  var coDays = (totalTime / 86400).toFixed(1);
  document.getElementById('co-hours').innerHTML = ExcelParser.secondsToHMS(totalTime) + '<span style="font-size:14px; font-weight:normal; color:var(--text-dim); margin-left:8px">(~' + coDays + ' dias)</span>';
  document.getElementById('co-avg-per-video').innerText = ExcelParser.secondsToHMS(avgPerVideo);
  document.getElementById('co-per-hour').innerText = 'R$ ' + perHour.toLocaleString('pt-BR', {minimumFractionDigits: 2});

  if (advanced) {
    document.getElementById('co-ratio').innerText = (advanced.globalRatio || 0).toFixed(2) + 'x';
    document.getElementById('co-chars-per-hour').innerText = ((advanced.charsPerHour || 0) / 1000).toFixed(1) + ' k/h';
    
    // Effort per Char
    var sPerChar = 0;
    var doneVids = cVideos.filter(v => v.feito && (parseFloat(v.tempo_fazer) || 0) > 0);
    var totalCharsRaw = doneVids.reduce((s, v) => s + (parseInt(v.chars) || 0), 0);
    if (totalCharsRaw > 0) sPerChar = totalTime / totalCharsRaw;
    document.getElementById('co-ratio-char').innerText = sPerChar.toFixed(2) + 's';

    Analytics.renderAdvancedCharts('co-advanced-section', advanced);
  } else {
    document.getElementById('co-ratio').innerText = '0.00x';
    document.getElementById('co-chars-per-hour').innerText = '0 k/h';
    document.getElementById('co-ratio-char').innerText = '0.00s';
  }

  Analytics.renderCharts('client-overview-chart', aggregated);
}

/* ========== BENCHMARKS & PRICING ========== */
function renderBenchmarks() {
  if (!State.selectedClient) return;
  var cid = State.selectedClient.id;
  var cVideos = State.videos.filter(v => v.clientId === cid);
  var benchmarks = Analytics.getBenchmarks(cVideos);
  var list = document.getElementById('benchmark-list');
  document.getElementById('target-rate-input').value = State.targetHourlyRate || 60;

  if (benchmarks.length === 0) {
    list.innerHTML = '<div class="empty-state"><h3>Nenhum benchmark encontrado</h3><p>Marque vídeos como "Vídeo de Teste" no formulário de edição para vê-los aqui.</p></div>';
    return;
  }

  // Calculate Average Effort for Packages
  var totalEffort = benchmarks.reduce((s, v) => s + (parseFloat(v.tempo_fazer) || 0), 0);
  var avgEffort = totalEffort / benchmarks.length;
  var price10 = Analytics.calculatePackagePrice(avgEffort, 10, State.targetHourlyRate);
  var price15 = Analytics.calculatePackagePrice(avgEffort, 15, State.targetHourlyRate);

  var html = `
    <div class="card package-suggestion-card" onclick="openPackageDetailsModal()" style="margin-bottom:20px; grid-column: 1 / -1; cursor:pointer">
       <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:20px">
          <div>
             <small style="color:#a5b4fc; margin-bottom:5px">ESTIMATIVA DE PACOTES (Clique para detalhes)</small>
             <h2 style="margin:0; font-size:18px; color:#fff">Sugestão Comercial</h2>
             <p style="font-size:11px; color:var(--text-dim); margin:5px 0 0">Baseado em <b>${ExcelParser.secondsToHMS(avgEffort)}</b> de esforço médio/vídeo</p>
          </div>
          <div style="display:flex; gap:25px">
             <div style="text-align:right">
                <div style="font-size:9px; color:var(--text-dim); margin-bottom:2px; text-transform:uppercase; letter-spacing:0.05em">Pack 10 Vídeos</div>
                <div style="font-size:22px; font-weight:800; color:#fff">R$ ${price10.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
             </div>
             <div style="text-align:right">
                <div style="font-size:9px; color:var(--text-dim); margin-bottom:2px; text-transform:uppercase; letter-spacing:0.05em">Pack 15 Vídeos</div>
                <div style="font-size:22px; font-weight:800; color:var(--accent)">R$ ${price15.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
             </div>
          </div>
       </div>
    </div>
  `;

  html += benchmarks.map(v => {
    var suggested = Analytics.calculateSuggestedPrice(v.tempo_fazer, State.targetHourlyRate);
    var ratio = v.tempo > 0 ? (v.tempo_fazer / v.tempo).toFixed(1) : '–';
    
    return `
      <div class="card benchmark-card">
         <div style="display:flex; justify-content:space-between; align-items:flex-start">
            <div>
               <div style="font-size:10px; color:var(--text-dim); margin-bottom:4px">${v.label}</div>
               <h3 style="margin:0; font-size:16px">${v.titulo}</h3>
               <div style="display:flex; gap:15px; margin-top:10px">
                  <div style="font-size:11px"><b>Esforço:</b> ${ExcelParser.secondsToHMS(v.tempo_fazer)}</div>
                  <div style="font-size:11px"><b>Ratio:</b> ${ratio}x</div>
                  <div style="font-size:11px"><b>Tempo Vídeo:</b> ${ExcelParser.secondsToHMS(v.tempo)}</div>
               </div>
            </div>
            <div style="text-align:right">
               <div class="pricing-badge">Preço Sugerido</div>
               <div class="pricing-highlight">R$ ${suggested.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
               <small style="font-size:9px; color:var(--text-dim)">Baseado em R$ ${State.targetHourlyRate}/h</small>
            </div>
         </div>
      </div>
    `;
  }).join('');

  list.innerHTML = html;
}

window.updateTargetRate = function(val) {
  State.targetHourlyRate = parseFloat(val) || 60;
  renderBenchmarks();
};

window.openPackageDetailsModal = function() {
  if (!State.selectedClient) return;
  var cid = State.selectedClient.id;
  var cVideos = State.videos.filter(v => v.clientId === cid);
  var benchmarks = Analytics.getBenchmarks(cVideos);
  if (benchmarks.length === 0) return;

  var totalEffort = benchmarks.reduce((s, v) => s + (parseFloat(v.tempo_fazer) || 0), 0);
  var avgEffort = totalEffort / benchmarks.length;
  var totalVideoLen = benchmarks.reduce((s, v) => s + (parseFloat(v.tempo) || 0), 0);
  var avgVideoLen = totalVideoLen / benchmarks.length;
  
  // Heuristic for scaling based on actual average languages in benchmarks
  var avgLangs = benchmarks.reduce((s, v) => s + (parseInt(v.idiomas) || 7), 0) / benchmarks.length;
  var avgActualRatio = totalEffort / totalVideoLen;

  // Base Ratio = Ratio / (1 + (L-1)*0.3) approx
  // Let's use a function based on the reference point
  var getEffortForLangs = function(L) {
    var refBase = 4;
    var refScale = 1.3;
    var scaleFactor = (refBase + (L-1) * refScale) / (refBase + (avgLangs-1) * refScale);
    return avgEffort * scaleFactor;
  };

  var langOptions = [2, 5, 7, 10];
  var rowsHTML = langOptions.map(L => {
    var effort = getEffortForLangs(L);
    var pUnit = (effort / 3600) * State.targetHourlyRate;
    var p10 = pUnit * 10;
    var p15 = pUnit * 15;
    var isRef = Math.abs(L - avgLangs) < 1;

    return `
      <tr class="${isRef ? 'highlight-col' : ''}">
        <td><b>${L} Idiomas</b></td>
        <td>${ExcelParser.secondsToHMS(effort)}</td>
        <td>R$ ${pUnit.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
        <td>R$ ${p10.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
        <td style="color:var(--accent)">R$ ${p15.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
      </tr>
    `;
  }).join('');

  showModal(`
    <div style="margin-bottom:20px">
      <h2 style="margin:0; font-size:22px">Detalhamento Comercial</h2>
      <p style="font-size:12px; color:var(--text-dim); margin-top:5px">Cliente: ${State.selectedClient.name} | Referência: ${benchmarks.length} Vídeos de Teste</p>
    </div>
    
    <div class="card" style="padding:15px; background:rgba(255,255,255,0.02); margin-bottom:20px">
       <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px">
          <div>
            <small style="font-size:9px; color:var(--text-dim)">VÍDEO MÉDIO</small>
            <div style="font-size:16px; font-weight:700">${ExcelParser.secondsToHMS(avgVideoLen)}</div>
          </div>
          <div style="text-align:right">
            <small style="font-size:9px; color:var(--text-dim)">META R$ / HORA</small>
            <div style="font-size:16px; font-weight:700; color:var(--success)">R$ ${State.targetHourlyRate.toLocaleString('pt-BR')}</div>
          </div>
       </div>
    </div>

    <table class="pricing-table">
      <thead>
        <tr>
          <th>Escopo</th>
          <th>Esforço/V</th>
          <th>Preço/V</th>
          <th>Pack 10</th>
          <th>Pack 15</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>

    <p style="font-size:11px; color:var(--text-dim); margin-top:15px; line-height:1.4">
      * O esforço médio do benchmark é usado como base. Os valores para outros idiomas são calculados proporcionalmente (heurística de escala de dublagem). Os preços unitários são baseados na sua meta de lucratividade horária.
    </p>

    <div style="display:flex; justify-content:flex-end; margin-top:20px">
      <button class="btn-ghost" onclick="closeModal()">Fechar</button>
    </div>
  `);
};

/* ========== MONTH DETAILS ========== */
function renderMonthDetails() {
  var m = State.selectedMonth;
  if (!m) return;
  document.getElementById('month-label').innerText = m.label;
  document.getElementById('month-period').innerText = m.periodo || '';
  
  var ppvVal = parseFloat(m.price_per_video);
  document.getElementById('cfg-ppv').value = isNaN(ppvVal) ? 40 : ppvVal;
  
  var baseVal = parseFloat(m.base_payment);
  document.getElementById('cfg-base').value = isNaN(baseVal) ? 500 : baseVal;
  
  var bvidVal = parseFloat(m.base_videos);
  document.getElementById('cfg-bvid').value = isNaN(bvidVal) ? 15 : bvidVal;
  
  var bonusVal = parseFloat(m.bonus);
  document.getElementById('cfg-bonus').value = isNaN(bonusVal) ? 0 : bonusVal;
  
  document.getElementById('cfg-comp').checked = m.compensate || false;

  var mVideos = State.videos.filter(function(v) { return v.monthId === m.id; });
  mVideos.sort(function(a, b) { return (a.rowIndex || 0) - (b.rowIndex || 0); });
  var done = mVideos.filter(function(v) { return v.feito; }).length;
  
  var totalWorkSeconds = 0;
  var totalVideoSeconds = 0;
  mVideos.forEach(v => { 
    if (v.feito) { 
      var tFazer = parseFloat(v.tempo_fazer) || 0;
      if (tFazer > 0) {
        totalWorkSeconds += tFazer; 
        totalVideoSeconds += (parseFloat(v.tempo) || 0);
      }
    }
  });

  // Compensation Logic (Cumulative Balance)
  var isCompensated = m.compensate === true;
  var clientMonths = getClientMonthsSorted(State.selectedClient.id).reverse(); // Oldest first
  var cumDone = 0;
  var cumBase = 0;
  var prevExtraPaid = 0;
  var currentMonthExtra = 0;
  var currentBalance = 0;

  for (var i = 0; i < clientMonths.length; i++) {
    var cm = clientMonths[i];
    var cmVideos = State.videos.filter(function(v) { return v.monthId === cm.id && v.feito; });
    var cmDone = cmVideos.length;
    var cmBase = parseFloat(cm.base_videos) || 0;

    // We only accumulate if the month ITSELF is marked as compensated
    // OR if we want to track the running balance strictly. 
    // The user said "not all clients have it", so usually it's a per-client/per-contract thing.
    if (cm.compensate) {
      cumDone += cmDone;
      cumBase += cmBase;
      
      var cumOverage = Math.max(0, cumDone - cumBase);
      var extraThisMonth = Math.max(0, cumOverage - prevExtraPaid);

      if (cm.id === m.id) {
         currentMonthExtra = extraThisMonth;
         currentBalance = cumDone - cumBase;
         break;
      }
      prevExtraPaid += extraThisMonth;
    } else {
      // Simple logic for this month
      if (cm.id === m.id) {
        currentMonthExtra = Math.max(0, cmDone - cmBase);
        currentBalance = cmDone - cmBase; 
        break;
      }
      // If previous months were not compensated, they don't affect future balances
    }
  }

  var balCard = document.getElementById('m-stat-balance').closest('.card');
  balCard.style.display = isCompensated ? 'block' : 'none';

  var ppv = parseFloat(m.price_per_video); if (isNaN(ppv)) ppv = 40;
  var basePay = parseFloat(m.base_payment); if (isNaN(basePay)) basePay = 500;
  var bonus = parseFloat(m.bonus); if (isNaN(bonus)) bonus = 0;
  var earnings = basePay + (currentMonthExtra * ppv) + bonus;

  document.getElementById('m-stat-done').innerText = done + '/' + mVideos.length;
  
  var balEl = document.getElementById('m-stat-balance');
  balEl.innerText = (currentBalance > 0 ? '+' : '') + currentBalance;
  balEl.className = 'stat-value ' + (currentBalance < 0 ? 'text-danger' : currentBalance > 0 ? 'text-success' : '');

  document.getElementById('m-stat-pay').innerText = 'R$ ' + earnings.toLocaleString('pt-BR', {minimumFractionDigits: 2});
  var monthDays = (totalWorkSeconds / 86400).toFixed(1);
  document.getElementById('m-stat-hours').innerHTML = ExcelParser.secondsToHMS(totalWorkSeconds) + '<span style="font-size:12px; font-weight:normal; color:var(--text-dim); margin-left:8px">(~' + monthDays + ' dias)</span>';
  document.getElementById('m-stat-ratio').innerText = (totalVideoSeconds > 0 ? (totalWorkSeconds / totalVideoSeconds).toFixed(2) : '0.0') + 'x';
  
  var perHour = totalWorkSeconds > 0 ? earnings / (totalWorkSeconds / 3600) : 0;
  document.getElementById('m-stat-per-hour').innerText = 'R$ ' + perHour.toLocaleString('pt-BR', {minimumFractionDigits: 2});

  var tbody = document.getElementById('video-tbody');
  tbody.innerHTML = mVideos.map(function(v) {
    try {
      var ratio = (v.tempo > 0 && parseFloat(v.tempo_fazer) > 0) ? (parseFloat(v.tempo_fazer) / v.tempo).toFixed(1) : '–';
      var isBenchmark = v.isTest || false;
      var rowClass = isBenchmark ? 'style="background:rgba(99,102,241,0.05)"' : '';
      
      return '<tr ' + rowClass + '>' +
        '<td><button class="badge ' + (v.feito ? 'bg-done' : 'bg-todo') + '" onclick="toggleVideoField(\'' + v.id + '\', \'feito\')">' + (v.feito ? '✓ Feito' : '✗ Pend.') + '</button></td>' +
        '<td><button class="badge ' + (v.transcrito ? 'bg-info' : '') + '" onclick="toggleVideoField(\'' + v.id + '\', \'transcrito\')">' + (v.transcrito ? '✎ Sim' : '— Não') + '</button></td>' +
        '<td>' + 
          '<div style="font-weight:600">' + 
             (v.link ? '<a href="' + v.link + '" target="_blank" style="color:var(--accent); text-decoration:none" title="Abrir link">' + (v.titulo || '–') + ' 🔗</a>' : (v.titulo || '–')) + 
             (isBenchmark ? ' <span class="badge bg-todo" style="font-size:9px">TESTE</span>' : '') + 
          '</div>' +
          '<div style="display:flex; gap:8px">' +
             '<small style="color:var(--text-dim); font-size:10px">' + (Analytics.detectTopic ? Analytics.detectTopic(v.titulo) : 'OUTROS') + '</small>' +
             (v.palavras ? '<small style="color:var(--text-dim); font-size:10px">| ' + v.palavras + ' words</small>' : '') +
             (v.comentario ? ' <span title="' + v.comentario + '" style="cursor:help; margin-left:5px">💬</span>' : '') +
          '</div>' +
        '</td>' +
        '<td class="text-accent">' + v.idiomas + '</td>' +
        '<td>' + (parseInt(v.chars) || 0).toLocaleString('pt-BR') + '</td>' +
        '<td style="font-weight:600; color:' + (ratio > 8 ? 'var(--danger)' : ratio > 6 ? 'var(--accent)' : '#10b981') + '">' + (ratio !== '–' ? ratio + 'x' : '–') + '</td>' +
        '<td>' + ExcelParser.secondsToHMS(v.tempo) + '</td>' +
        '<td>' +
          (v.link ? '<a href="' + v.link + '" target="_blank" class="btn-ghost" style="color:var(--accent); text-decoration:none; padding:5px; margin-right:5px" title="Abrir Vídeo">🔗</a>' : '') +
          '<button onclick="openVideoModal(\'' + v.id + '\')" class="btn-ghost" title="Editar">✎</button> ' +
          '<button onclick="deleteVideo(\'' + v.id + '\')" class="btn-ghost" style="color:var(--danger)">✕</button>' +
        '</td>' +
      '</tr>';
    } catch (e) {
      console.error("Erro ao renderizar linha de video:", e, v);
      return '<tr><td colspan="8" style="color:var(--danger)">Erro ao carregar vídeo: ' + v.titulo + '</td></tr>';
    }
  }).join('');
}

/* ========== DATA MUTATIONS (V3.0 Extended) ========== */
window.toggleVideoField = async function(videoId, field) {
  var v = State.videos.find(function(x) { return x.id === videoId; });
  if (!v) return;
  v[field] = !v[field];
  await DB.put('videos', v);
  renderMonthDetails();
};

window.updateMonthConfig = async function(field, value) {
  if (!State.selectedMonth) return;
  State.selectedMonth[field] = (typeof value === 'boolean') ? value : parseFloat(value);
  await DB.put('monthlyConfig', State.selectedMonth);
  renderMonthDetails();
};

window.deleteClient = function(e, id) {
  if (arguments.length === 1 && typeof e === 'string') { id = e; e = null; }
  if (e && e.stopPropagation) e.stopPropagation();
  else if (window.event && window.event.stopPropagation) window.event.stopPropagation();
  
  if (!confirm('Excluir este cliente permanentemente?')) return;
  console.log('DEBUG: Iniciando limpeza do cliente:', id);
  
  (async function() {
    await DB.deleteRecord('clients', id);
    await DB.deleteByClientId('videos', id);
    await DB.deleteByClientId('monthlyConfig', id);
    State.clients = State.clients.filter(function(c) { return c.id !== id; });
    State.videos = State.videos.filter(function(v) { return v.clientId !== id; });
    State.monthlyConfigs = State.monthlyConfigs.filter(function(c) { return c.clientId !== id; });
    State.selectedClient = null;
    updateSidebar();
    showView('general');
    console.log('DEBUG: Limpeza concluída para o cliente:', id);
  })();
};

window.deleteVideo = async function(id) {
  if (!confirm('Excluir este vídeo?')) return;
  await DB.deleteRecord('videos', id);
  State.videos = State.videos.filter(function(v) { return v.id !== id; });
  renderMonthDetails();
};

/* ========== MODALS ========== */
window.openClientModal = function(existingId) {
  var c = existingId ? State.clients.find(function(x) { return x.id === existingId; }) : null;
  showModal(
    '<h2>👤 ' + (c ? 'Editar' : 'Novo') + ' Cliente</h2>' +
    '<div class="form-group"><label>Nome do Cliente</label><input type="text" id="new-client-name" value="' + (c ? c.name : '') + '" placeholder="Ex: SanInPlay"></div>' +
    '<div class="modal-footer">' +
       '<button class="btn-ghost" onclick="closeModal()">Cancelar</button>' +
       '<button class="btn-accent" onclick="saveClient(\'' + (existingId || '') + '\')">Salvar Cliente</button>' +
    '</div>'
  );
};

window.saveClient = async function(existingId) {
  var name = document.getElementById('new-client-name').value.trim();
  if (!name) return;
  if (existingId) {
    var client = State.clients.find(function(c) { return c.id === existingId; });
    if (client) { client.name = name; await DB.put('clients', client); updateSidebar(); if (State.selectedClient && State.selectedClient.id === existingId) { State.selectedClient = client; renderClientWorkspace(); } }
  } else {
    var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
    var newClient = { id: id, name: name, active: true };
    await DB.put('clients', newClient);
    State.clients.push(newClient); updateSidebar(); selectClient(id);
  }
  closeModal();
};

window.openMonthModal = function(monthId) {
  var m = monthId ? State.monthlyConfigs.find(function(x) { return x.id === monthId; }) : null;
  var now = new Date();
  var MONTHS = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');
  var optionsHTML = MONTHS.map(function(mn) { return '<option' + (m && m.label.startsWith(mn) ? ' selected' : '') + '>' + mn + '</option>'; }).join('');
  showModal(
    '<h2>📅 ' + (m ? 'Editar' : 'Novo') + ' Mês</h2>' +
    '<div class="form-group"><label>Mês / Ano</label>' +
      '<div style="display:flex; gap:10px"><select id="m-name" style="flex:1">' + optionsHTML + '</select>' +
      '<input type="number" id="m-year" value="' + (m ? m.label.split(' ')[1] : now.getFullYear()) + '" placeholder="Ano" style="width:120px"></div>' +
    '</div>' +
    '<div class="form-group"><label>Período (Opcional)</label><input type="text" id="m-periodo" value="' + (m && m.periodo ? m.periodo : '') + '" placeholder="Ex: 20/01 -> 20/02"></div>' +
    '<div class="modal-footer">' +
       '<button class="btn-ghost" onclick="closeModal()">Cancelar</button>' +
       '<button class="btn-accent" onclick="saveMonthModal(\'' + (monthId || '') + '\')">Salvar Mês</button>' +
    '</div>'
  );
};

window.saveMonthModal = async function(existingId) {
  if (!State.selectedClient) { closeModal(); alert("Erro: Nenhum cliente selecionado."); return; }
  var nameEl = document.getElementById('m-name');
  var yearEl = document.getElementById('m-year');
  if (!nameEl || !yearEl) return;
  
  var label = nameEl.value + ' ' + yearEl.value;
  var mId = existingId || (State.selectedClient.id + '_' + label.replace(/\s+/g, '_'));
  var config = existingId ? State.monthlyConfigs.find(function(x) { return x.id === existingId; }) : { id: mId, clientId: State.selectedClient.id, price_per_video: 40, base_payment: 500, base_videos: 15, bonus: 0, compensate: false };
  if (!config) return;

  config.label = label; config.periodo = document.getElementById('m-periodo').value;
  await DB.put('monthlyConfig', config);
  if (!existingId) State.monthlyConfigs.push(config);
  closeModal(); State.selectedMonth = config; State.clientSubView = 'month'; renderClientWorkspace();
};

window.openVideoModal = function(videoId) {
  var v = videoId ? State.videos.find(function(x) { return x.id === videoId; }) : null;
  showModal(
    '<h2>🚀 ' + (v ? 'Editar' : 'Novo') + ' Vídeo</h2>' +
    '<div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px">' +
      '<div class="form-group" style="grid-column: span 2"><label>Título da Obra</label><input type="text" id="v-title" value="' + (v ? v.titulo : '') + '" placeholder="Ex: Fuga no GTA 5..."></div>' +
      '<div class="form-group" style="grid-column: span 2"><label>Link do Vídeo (🔗)</label><input type="text" id="v-link" value="' + (v && v.link ? v.link : '') + '" placeholder="https://youtube.com/..."></div>' +
      
      '<div class="form-group"><label>Idiomas</label><input type="number" id="v-lang" value="' + (v ? v.idiomas : 7) + '"></div>' +
      '<div class="form-group"><label>Quantidade de Palavras</label><input type="number" id="v-palavras" value="' + (v && v.palavras ? v.palavras : 0) + '"></div>' +
      
      '<div class="form-group"><label>Total de Chars</label><input type="number" id="v-chars" value="' + (v ? v.chars : 0) + '"></div>' +
      '<div class="form-group"><label>Duração do Vídeo</label><input type="text" id="v-time" value="' + ExcelParser.secondsToHMS(v ? v.tempo : 0) + '" placeholder="00:00:00"></div>' +
      
      '<div class="form-group" style="grid-column: span 2"><label>Tempo de Trabalho (Esforço)</label><input type="text" id="v-work" value="' + ExcelParser.secondsToHMS(v ? v.tempo_fazer : 0) + '" placeholder="00:00:00"></div>' +
      
      '<div style="grid-column: span 2; background: rgba(245, 158, 11, 0.05); border: 1px dashed var(--accent); padding: 12px; border-radius: 10px; display: flex; align-items: center; gap: 10px">' +
        '<input type="checkbox" id="v-is-test" ' + (v && v.isTest ? 'checked' : '') + ' style="width:16px; height:16px; cursor:pointer">' + 
        '<label for="v-is-test" style="font-size: 11px; font-weight: 700; color: var(--accent); cursor: pointer; text-transform: uppercase; margin:0">Marcar como Vídeo de Teste (Benchmark)</label>' +
      '</div>' +
      '<div class="form-group" style="grid-column: span 2"><label>Comentários / Notas</label><textarea id="v-comentario" style="height: 80px; resize: none" placeholder="Observações sobre este vídeo...">' + (v && v.comentario ? v.comentario : '') + '</textarea></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn-ghost" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn-accent" style="padding: 12px 30px; font-size: 12px" onclick="saveVideoModal(\'' + (videoId || '') + '\')">Salvar Alterações</button>' +
    '</div>'
  );
};

window.saveVideoModal = async function(existingId) {
  var data = {
    titulo: document.getElementById('v-title').value.trim(),
    link: document.getElementById('v-link').value.trim(),
    idiomas: parseInt(document.getElementById('v-lang').value) || 7,
    palavras: parseInt(document.getElementById('v-palavras').value) || 0,
    chars: parseInt(document.getElementById('v-chars').value) || 0,
    tempo: ExcelParser.durationToSeconds(document.getElementById('v-time').value),
    tempo_fazer: ExcelParser.durationToSeconds(document.getElementById('v-work').value),
    isTest: document.getElementById('v-is-test').checked,
    comentario: document.getElementById('v-comentario').value.trim()
  };
  if (existingId) {
    var v = State.videos.find(function(x) { return x.id === existingId; });
    Object.assign(v, data); await DB.put('videos', v);
  } else {
    var nv = { id: 'v_' + Date.now(), clientId: State.selectedClient.id, monthId: State.selectedMonth.id, label: State.selectedMonth.label, feito: false, transcrito: false, year: parseInt(State.selectedMonth.label.split(' ')[1]) || 2026 };
    Object.assign(nv, data); State.videos.push(nv); await DB.put('videos', nv);
  }
  closeModal(); renderMonthDetails();
};

/* ========== PDF EXPORT ========== */
window.exportCurrentViewPDF = function() {
  var title = State.activeView === 'general' ? 'Consolidado Global' : 'Cliente: ' + State.selectedClient.name;
  var vids = State.activeView === 'general' ? State.videos : State.videos.filter(v => v.clientId === State.selectedClient.id);
  var agg = Analytics.groupData(vids, State.monthlyConfigs, State.filters.timeframe);
  var earnStr = State.activeView === 'general' ? document.getElementById('gen-total-earnings').innerText : document.getElementById('co-earnings').innerText;
  var countStr = State.activeView === 'general' ? document.getElementById('gen-total-videos').innerText : document.getElementById('co-videos').innerText;
  var hourStr = State.activeView === 'general' ? document.getElementById('gen-total-hours').innerText : document.getElementById('co-hours').innerText;
  Analytics.exportUnifiedPDF(title, agg, { earnings: earnStr, count: countStr, hours: hourStr });
};

window.exportMonthPDF = function() {
  var m = State.selectedMonth;
  if (!m || !State.selectedClient) return;
  
  var mVideos = State.videos.filter(v => v.monthId === m.id);
  mVideos.sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0));
  
  var earnStr = document.getElementById('m-stat-pay').innerText;
  var countStr = document.getElementById('m-stat-done').innerText;
  var hourStr = document.getElementById('m-stat-hours').innerText;
  
  Analytics.exportMonthlyReportPDF(
    State.selectedClient.name,
    m.label,
    m.periodo,
    mVideos,
    { earnings: earnStr, count: countStr, hours: hourStr }
  );
};

window.handleImport = async function(files) {
  var statusEl = document.getElementById('import-status');
  if (statusEl) statusEl.innerText = "Processando arquivos...";

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (file.name.toLowerCase().endsWith('.json')) {
      await importJSONBackup(file);
    } else if (file.name.toLowerCase().endsWith('.xlsx')) {
      var data = await ExcelParser.parseExcelFile(file, file.name.replace(/\.xlsx$/i, ''));
      await DB.putBulk('clients', [data.client]);
      await DB.putBulk('videos', data.videos);
      await DB.putBulk('monthlyConfig', data.configs);
    }
  }
  
  if (statusEl) statusEl.innerText = "Importação concluída com sucesso!";
  await window.loadStateFromDB(); 
  setTimeout(() => {
    showView('general');
    if (statusEl) statusEl.innerText = "";
  }, 1500);
}

function importJSONBackup(file) {
  return new Promise((resolve, reject) => {
    var reader = new FileReader();
    reader.onload = async function(e) {
      try {
        var data = JSON.parse(e.target.result);
        if (data.clients) await DB.putBulk('clients', data.clients);
        if (data.videos) await DB.putBulk('videos', data.videos);
        if (data.configs) await DB.putBulk('monthlyConfig', data.configs);
        // Also support older backups or different structures if they exist
        if (data.monthlyConfigs) await DB.putBulk('monthlyConfig', data.monthlyConfigs);
        
        resolve();
      } catch (err) {
        console.error("Erro ao importar JSON:", err);
        alert("Erro ao processar o arquivo JSON de backup.");
        reject(err);
      }
    };
    reader.readAsText(file);
  });
}

window.exportBackup = function() {
  var backupData = { 
    clients: State.clients, 
    videos: State.videos, 
    configs: State.monthlyConfigs,
    exportDate: new Date().toISOString(),
    version: "3.0"
  };
  var blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); 
  a.href = URL.createObjectURL(blob); 
  a.download = 'dub_backup_' + new Date().toISOString().split('T')[0] + '.json'; 
  a.click();
};

function showModal(html) { 
  document.getElementById('modal-box').innerHTML = html; 
  document.getElementById('modal-overlay').classList.add('show'); 
  document.body.classList.add('modal-open');
}
window.closeModal = function() { 
  document.getElementById('modal-overlay').classList.remove('show'); 
  document.body.classList.remove('modal-open');
};


/* ========== PRIVACY MODE ========== */
window.togglePrivacyMode = function() {
  State.privacyMode = !State.privacyMode;
  localStorage.setItem('dub_privacy_mode', State.privacyMode ? '1' : '0');
  applyPrivacyMode();
};

function applyPrivacyMode() {
  var btn = document.getElementById('privacy-toggle');
  if (!btn) return;
  if (State.privacyMode) {
    document.body.classList.add('privacy-mode');
    btn.innerText = '🙈';
    btn.title = "Mostrar Valores";
  } else {
    document.body.classList.remove('privacy-mode');
    btn.innerText = '👁️';
    btn.title = "Ocultar Valores (Privacidade)";
  }
}

function setupSyncStatusListener() {
  window.addEventListener('sync-status', (e) => {
    const { pending, total, completed, progress } = e.detail;
    const box = document.getElementById('sync-progress-box');
    const bar = document.getElementById('sync-progress-bar');
    const text = document.getElementById('sync-status-text');
    const percent = document.getElementById('sync-status-percent');
    
    if (!box || !bar) return;
    
    if (pending > 0) {
      box.style.display = 'block';
      bar.style.width = progress + '%';
      text.innerText = 'Sincronizando...';
      text.style.color = 'var(--accent)';
      percent.innerText = progress + '%';
    } else {
      // Sync complete
      text.innerText = 'Sincronizado ✅';
      text.style.color = '#10b981';
      bar.style.width = '100%';
      percent.innerText = '100%';
      // Fade out after 3 seconds
      setTimeout(() => {
        if (!DB.SyncManager.isSyncing()) {
          box.style.display = 'none';
        }
      }, 3000);
    }
  });
}

function setupEventListeners() {
  var importInput = document.getElementById('import-input');
  if (importInput) {
    importInput.addEventListener('change', function(e) { handleImport(e.target.files); });
  } else {
    console.warn('BOOT: import-input não encontrado, tentando novamente...');
    setTimeout(function() {
      var el = document.getElementById('import-input');
      if (el) el.addEventListener('change', function(e) { handleImport(e.target.files); });
    }, 500);
  }
  setupSyncStatusListener();
}
// boot() is called from AuthUI.init() - no duplicate DOMContentLoaded needed
