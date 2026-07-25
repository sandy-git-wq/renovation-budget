/* ═══════════════════════════════════════════════════
   app.js — 时序空间项目利润核算
   Supabase 云端存储 + Auth 登录保护
   ═══════════════════════════════════════════════════ */

/* ── Supabase 配置 ── */
var SUPABASE_URL = 'https://ixzrrrztjtcwouqwngre.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4enJycnp0anRjd291cXduZ3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NDc3ODIsImV4cCI6MjEwMDQyMzc4Mn0.4iWZhmqsRoPQtryYtPcJY7I-wrLv52TaMVmW5KXeTtA';
var AUTH_URL = SUPABASE_URL + '/auth/v1';

/* ── Auth State ── */
var authSession = null;   // { access_token, refresh_token, expires_at, user }
var currentUserRole = 'viewer';   // 'admin' | 'viewer'

/* ── Session Management ── */
function loadSession() {
  try {
    var raw = localStorage.getItem('reno_auth');
    if (!raw) return null;
    var s = JSON.parse(raw);
    if (s.expires_at && Date.now() / 1000 > s.expires_at - 60) return null; // expired (60s buffer)
    return s;
  } catch(e) { return null; }
}
function saveSession(s) { authSession = s; localStorage.setItem('reno_auth', JSON.stringify(s)); }
function clearSession() { authSession = null; localStorage.removeItem('reno_auth'); }
function getAccessToken() { return authSession ? authSession.access_token : null; }

/* ── Auth API ── */
async function signIn(email, password) {
  var res = await fetch(AUTH_URL + '/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify({ email: email, password: password })
  });
  if (!res.ok) { var err = await res.json(); throw new Error(err.error_description || err.msg || '登录失败'); }
  var data = await res.json();
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user
  });
  return data;
}

async function refreshSession() {
  if (!authSession || !authSession.refresh_token) return false;
  try {
    var res = await fetch(AUTH_URL + '/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: authSession.refresh_token })
    });
    if (!res.ok) throw new Error('refresh failed');
    var data = await res.json();
    saveSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: data.user
    });
    return true;
  } catch(e) { clearSession(); return false; }
}

function signOut() { clearSession(); location.reload(); }

async function fetchUserRole() {
  try {
    var res = await supaFetch('user_roles?select=role&user_id=eq.' + authSession.user.id);
    return (res && res.length > 0) ? res[0].role : 'viewer';
  } catch(e) { return 'viewer'; }
}

function isAdmin() { return currentUserRole === 'admin'; }

function updateAdminUI() {
  /* Toggle admin-only elements */
  var els = document.querySelectorAll('[data-admin]');
  for (var i = 0; i < els.length; i++) {
    els[i].style.display = isAdmin() ? '' : 'none';
  }
}

/* ── Supabase REST API (with auth) ── */
function supaFetch(path, options) {
  var opts = Object.assign({}, options || {});
  var token = getAccessToken();
  opts.headers = Object.assign({
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + (token || SUPABASE_KEY),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }, opts.headers || {});
  return fetch(SUPABASE_URL + '/rest/v1/' + path, opts).then(async function(res) {
    if (res.status === 401 && authSession) { await refreshSession(); opts.headers.Authorization = 'Bearer ' + getAccessToken(); return fetch(SUPABASE_URL + '/rest/v1/' + path, opts).then(function(r2) { if (!r2.ok) return r2.text().then(function(t) { throw new Error('API error: ' + r2.status); }); return r2.text(); }).then(function(t) { return t ? JSON.parse(t) : null; }); }
    if (!res.ok) return res.text().then(function(t) { throw new Error('API error: ' + res.status + ' ' + t); });
    return res.text();
  }).then(function(t) { return t ? JSON.parse(t) : null; });
}

/* ── State ── */
var projects = [], revenueItems = [], costItems = [];
var currentProjectId = '', editingProjectId = null, editingItemId = null, currentItemType = 'revenue';
var dataLoaded = false;

/* ── Data Layer ── */
async function loadAll() {
  try {
    var p = await supaFetch('projects?select=*&order=created_at.desc');
    projects = (p || []).map(mapProject);
    var r = await supaFetch('revenue_items?select=*');
    revenueItems = (r || []).map(mapRevenue);
    var c = await supaFetch('cost_items?select=*');
    costItems = (c || []).map(mapCost);
    dataLoaded = true;
  } catch(e) {
    console.error('Load error:', e);
    // If auth error, force re-login
    if (e.message.indexOf('401') >= 0 || e.message.indexOf('403') >= 0) { clearSession(); location.reload(); }
    projects = []; revenueItems = []; costItems = []; dataLoaded = true;
  }
}

function mapProject(r) { return { id: r.id, name: r.name, clientName: r.client_name, clientPhone: r.client_phone, address: r.address, contractAmount: parseFloat(r.contract_amount) || 0, status: r.status, startDate: r.start_date, expectedEndDate: r.expected_end_date, actualEndDate: r.actual_end_date, warrantyExpiry: r.warranty_expiry, notes: r.notes, createdAt: r.created_at }; }
function mapRevenue(r) { return { id: r.id, projectId: r.project_id, category: r.category, description: r.description, amount: parseFloat(r.amount) || 0, receivedOrPaid: parseFloat(r.received_amount) || 0, date: r.date, notes: r.notes }; }
function mapCost(r) { return { id: r.id, projectId: r.project_id, category: r.category, description: r.description, amount: parseFloat(r.amount) || 0, receivedOrPaid: parseFloat(r.paid_amount) || 0, supplier: r.supplier, date: r.date, notes: r.notes }; }
function unmapProject(d) { return { name: d.name, client_name: d.clientName, client_phone: d.clientPhone, address: d.address, contract_amount: d.contractAmount, status: d.status, start_date: d.startDate, expected_end_date: d.expectedEndDate, actual_end_date: d.actualEndDate, warranty_expiry: d.warrantyExpiry, notes: d.notes }; }
function unmapRevenue(d) { return { project_id: d.projectId, category: d.category, description: d.description, amount: d.amount, received_amount: d.receivedOrPaid, date: d.date, notes: d.notes }; }
function unmapCost(d) { return { project_id: d.projectId, category: d.category, description: d.description, amount: d.amount, paid_amount: d.receivedOrPaid, supplier: d.supplier, date: d.date, notes: d.notes }; }

/* ── Constants ── */
var REVENUE_CATEGORIES = ['合同款', '增项', '设计费', '管理费', '其他收入'];
var COST_CATEGORIES = ['材料费', '人工费', '分包费', '设计费', '管理费', '工具设备', '运输费', '其他支出'];
var CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
var REVENUE_COLORS = { '合同款': CHART_COLORS[0], '增项': CHART_COLORS[1], '设计费': CHART_COLORS[2], '管理费': CHART_COLORS[3], '其他收入': CHART_COLORS[4] };
var COST_COLORS = { '材料费': CHART_COLORS[0], '人工费': CHART_COLORS[1], '分包费': CHART_COLORS[2], '设计费': CHART_COLORS[3], '管理费': CHART_COLORS[4], '工具设备': CHART_COLORS[5], '运输费': CHART_COLORS[6], '其他支出': CHART_COLORS[7] };

/* ── Helpers ── */
function fmtM(n) { if (n == null || isNaN(n)) return '¥0'; return '¥' + Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtMS(n) { if (n == null || isNaN(n)) return '¥0'; var a = Math.abs(Number(n)); if (a >= 10000) { var w = a / 10000; return '¥' + parseFloat(w.toFixed(2)) + '万'; } return '¥' + a.toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }
function fmtD(d) { return d || '-'; }
function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function ico(name, size) { return '<svg class="ico' + (size ? ' ico-' + size : '') + '"><use href="#ico-' + name + '"/></svg>'; }

/* ── Login ── */
async function handleLogin(e) {
  e.preventDefault();
  var btn = document.getElementById('authBtn');
  var errEl = document.getElementById('authError');
  var email = document.getElementById('authForm').email.value;
  var password = document.getElementById('authForm').password.value;
  btn.disabled = true; btn.textContent = '登录中……'; errEl.textContent = '';
  try {
    await signIn(email, password);
    currentUserRole = await fetchUserRole();
    document.getElementById('authOverlay').classList.remove('active');
    renderUserBadge();
    updateAdminUI();
    await loadAll();
    buildProjectSelector();
    renderAll();
    updateStorageBanner('ready');
  } catch(err) {
    errEl.textContent = err.message || '登录失败，请检查邮箱和密码';
  }
  btn.disabled = false; btn.textContent = '登录';
}

function renderUserBadge() {
  var badge = document.getElementById('userBadge');
  if (authSession && authSession.user) {
    badge.innerHTML = '<span>' + esc(authSession.user.email) + '</span><button onclick="signOut()" title="退出登录">⏻</button>';
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

/* ── Project Selector ── */
function buildProjectSelector() {
  var sel = document.getElementById('projectSelect');
  sel.innerHTML = '<option value="">' + ico('overview', 'sm') + ' 全部项目概览</option>' +
    projects.map(function(p) { return '<option value="' + p.id + '"' + (p.id === currentProjectId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
}
function selectProject(id) { currentProjectId = id; buildProjectSelector(); renderAll(); }

/* ── Project CRUD ── */
function openProjectModal(id) {
  editingProjectId = id || null;
  var f = document.getElementById('projectForm'); f.reset();
  document.getElementById('projectModalTitle').textContent = id ? '编辑项目' : '新建项目';
  if (id) { var p = projects.find(function(x) { return x.id === id; }); if (p) Object.keys(p).forEach(function(k) { var el = f.elements[k]; if (el) el.value = p[k] != null ? p[k] : ''; }); }
  document.getElementById('projectModalOverlay').classList.add('active');
}
function closeProjectModal() { document.getElementById('projectModalOverlay').classList.remove('active'); editingProjectId = null; }

async function saveProject(e) {
  e.preventDefault();
  var f = document.getElementById('projectForm'), fd = new FormData(f), d = {}; fd.forEach(function(v, k) { d[k] = v; });
  d.contractAmount = parseFloat(d.contractAmount) || 0;
  if (editingProjectId) {
    await supaFetch('projects?id=eq.' + editingProjectId, { method: 'PATCH', body: JSON.stringify(unmapProject(d)) });
  } else {
    var ud = unmapProject(d);
    var result = await supaFetch('projects', { method: 'POST', body: JSON.stringify(ud) });
    d.id = result[0].id;
    if (d.contractAmount > 0) {
      var rd = { projectId: d.id, category: '合同款', description: '合同金额', amount: d.contractAmount, receivedOrPaid: 0, date: d.startDate || '', notes: '自动从合同金额创建' };
      await supaFetch('revenue_items', { method: 'POST', body: JSON.stringify(unmapRevenue(rd)) });
    }
  }
  closeProjectModal(); if (!currentProjectId && !editingProjectId) currentProjectId = d.id;
  await loadAll(); buildProjectSelector(); document.getElementById('projectSelect').value = currentProjectId; renderAll();
  showToast(editingProjectId ? '项目已更新' : '项目已创建'); editingProjectId = null;
}

async function deleteProject(id) {
  if (!confirm('确定删除此项目及其所有收支记录？此操作不可恢复。')) return;
  await supaFetch('projects?id=eq.' + id, { method: 'DELETE' });
  if (currentProjectId === id) currentProjectId = '';
  await loadAll(); buildProjectSelector(); document.getElementById('projectSelect').value = currentProjectId; renderAll(); showToast('项目已删除');
}

/* ── Item CRUD ── */
function openItemModal(type) {
  if (!currentProjectId) { showToast('请先选择一个项目'); return; }
  currentItemType = type; editingItemId = null;
  var f = document.getElementById('itemForm'); f.reset(); f.elements.itemType.value = type;
  document.getElementById('itemModalTitle').textContent = type === 'revenue' ? '添加收入' : '添加支出';
  var cats = type === 'revenue' ? REVENUE_CATEGORIES : COST_CATEGORIES;
  document.getElementById('itemCategory').innerHTML = cats.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  document.getElementById('itemRecLabel').textContent = type === 'revenue' ? '已收款 (元)' : '已付款 (元)';
  document.getElementById('itemPendLabel').textContent = type === 'revenue' ? '未收 (元)' : '未付 (元)';
  document.getElementById('itemSupplierRow').style.display = type === 'cost' ? '' : 'none';
  document.getElementById('itemModalOverlay').classList.add('active');
}
function openEditItemModal(type, id) {
  var arr = type === 'revenue' ? revenueItems : costItems;
  var item = arr.find(function(x) { return x.id === id; }); if (!item) return;
  currentItemType = type; editingItemId = id;
  var f = document.getElementById('itemForm'); f.reset();
  document.getElementById('itemCategory').innerHTML = (type === 'revenue' ? REVENUE_CATEGORIES : COST_CATEGORIES).map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  document.getElementById('itemModalTitle').textContent = type === 'revenue' ? '编辑收入' : '编辑支出';
  document.getElementById('itemRecLabel').textContent = type === 'revenue' ? '已收款 (元)' : '已付款 (元)';
  document.getElementById('itemPendLabel').textContent = type === 'revenue' ? '未收 (元)' : '未付 (元)';
  document.getElementById('itemSupplierRow').style.display = type === 'cost' ? '' : 'none';
  f.elements.itemType.value = type; f.elements.id.value = item.id; f.elements.category.value = item.category || ''; f.elements.amount.value = item.amount || '';
  f.elements.receivedOrPaid.value = item.receivedOrPaid || ''; f.elements.description.value = item.description || '';
  f.elements.supplier.value = item.supplier || ''; f.elements.date.value = item.date || ''; f.elements.notes.value = item.notes || '';
  calcItemPending(); document.getElementById('itemModalOverlay').classList.add('active');
}
function closeItemModal() { document.getElementById('itemModalOverlay').classList.remove('active'); editingItemId = null; }
function calcItemPending() { var f = document.getElementById('itemForm'), a = parseFloat(f.elements.amount.value) || 0, r = parseFloat(f.elements.receivedOrPaid.value) || 0; f.elements.pendingDisplay.value = a ? fmtM(Math.max(0, a - r)) : ''; }

async function saveItem(e) {
  e.preventDefault();
  var f = document.getElementById('itemForm'), fd = new FormData(f), d = {}; fd.forEach(function(v, k) { if (k !== 'pendingDisplay') d[k] = v; });
  d.amount = parseFloat(d.amount) || 0; d.receivedOrPaid = parseFloat(d.receivedOrPaid) || 0; d.projectId = currentProjectId;
  var type = d.itemType, table = type === 'revenue' ? 'revenue_items' : 'cost_items', unmap = type === 'revenue' ? unmapRevenue : unmapCost; delete d.itemType;
  if (editingItemId) { await supaFetch(table + '?id=eq.' + editingItemId, { method: 'PATCH', body: JSON.stringify(unmap(d)) }); }
  else { await supaFetch(table, { method: 'POST', body: JSON.stringify(unmap(d)) }); }
  closeItemModal(); await loadAll(); renderAll();
  showToast(editingItemId ? (type === 'revenue' ? '收入已更新' : '支出已更新') : (type === 'revenue' ? '收入已添加' : '支出已添加'));
  editingItemId = null;
}
async function deleteItem(type, id) {
  if (!confirm('确定删除此记录？')) return;
  await supaFetch((type === 'revenue' ? 'revenue_items' : 'cost_items') + '?id=eq.' + id, { method: 'DELETE' });
  await loadAll(); renderAll(); showToast('记录已删除');
}

/* ── Filters ── */
function getRevenues() { return currentProjectId ? revenueItems.filter(function(x) { return x.projectId === currentProjectId; }) : revenueItems; }
function getCosts() { return currentProjectId ? costItems.filter(function(x) { return x.projectId === currentProjectId; }) : costItems; }

/* ── Render ── */
function renderStats() {
  if (currentProjectId) { document.getElementById('statsRow').innerHTML = ''; return; }
  var revs = getRevenues(), costs = getCosts();
  var tr = revs.reduce(function(s, x) { return s + (x.amount || 0); }, 0), tc = costs.reduce(function(s, x) { return s + (x.amount || 0); }, 0);
  var trec = revs.reduce(function(s, x) { return s + (x.receivedOrPaid || 0); }, 0), tpaid = costs.reduce(function(s, x) { return s + (x.receivedOrPaid || 0); }, 0);
  var unrec = revs.reduce(function(s, x) { return s + Math.max(0, (x.amount || 0) - (x.receivedOrPaid || 0)); }, 0), unpaid = costs.reduce(function(s, x) { return s + Math.max(0, (x.amount || 0) - (x.receivedOrPaid || 0)); }, 0);
  var profit = tr - tc, margin = tr > 0 ? (profit / tr * 100) : 0;
  document.getElementById('statsRow').innerHTML =
    '<div class="stat-card"><div class="stat-head"><div class="stat-icon">' + ico('revenue') + '</div><div class="stat-label">' + (currentProjectId ? '项目营收' : '总营收') + '</div></div><div class="stat-value">' + fmtM(tr) + '</div><div class="stat-sub">已收款 ' + fmtM(trec) + ' · 未收 ' + fmtM(unrec) + '</div></div>' +
    '<div class="stat-card"><div class="stat-head"><div class="stat-icon">' + ico('cost') + '</div><div class="stat-label">' + (currentProjectId ? '项目成本' : '总成本') + '</div></div><div class="stat-value">' + fmtM(tc) + '</div><div class="stat-sub">已付款 ' + fmtM(tpaid) + ' · 未付 ' + fmtM(unpaid) + '</div></div>' +
    '<div class="stat-card"><div class="stat-head"><div class="stat-icon">' + ico('profit') + '</div><div class="stat-label">利润</div></div><div class="stat-value">' + (profit >= 0 ? '' : '-') + fmtM(Math.abs(profit)) + '</div><div class="stat-sub">利润率 ' + (margin >= 0 ? '' : '-') + Math.abs(margin).toFixed(1) + '%</div></div>' +
    '<div class="stat-card"><div class="stat-head"><div class="stat-icon">' + ico('projects') + '</div><div class="stat-label">项目数</div></div><div class="stat-value">' + projects.length + '</div><div class="stat-sub">' + projects.filter(function(p) { return p.status === '施工中'; }).length + ' 个在建</div></div>' +
    '<div class="stat-card"><div class="stat-head"><div class="stat-icon">' + ico('gap') + '</div><div class="stat-label">资金缺口</div></div><div class="stat-value">' + fmtM(unrec - unpaid) + '</div><div class="stat-sub">应收 − 应付</div></div>';
}

function renderProjectBar() {
  var bar = document.getElementById('projectBar');
  if (!currentProjectId) { bar.style.display = 'none'; return; }
  var p = projects.find(function(x) { return x.id === currentProjectId; }); if (!p) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  var sm = { '报价中': 'status-quote', '施工中': 'status-building', '已完工': 'status-done', '已结算': 'status-settled' };
  bar.innerHTML =
    '<div class="pb-item"><span class="pb-label">客户</span><span class="pb-value" style="cursor:pointer;text-decoration:underline dotted" onclick="openProjectDetail(\'' + p.id + '\')" title="点击查看详情">' + esc(p.clientName) + '</span></div>' +
    '<div class="pb-item"><span class="pb-label">电话</span><span class="pb-value">' + esc(p.clientPhone || '-') + '</span></div>' +
    '<div class="pb-item"><span class="pb-label">地址</span><span class="pb-value">' + esc(p.address || '-') + '</span></div>' +
    '<div class="pb-item"><span class="pb-label">合同额</span><span class="pb-value">' + fmtM(p.contractAmount) + '</span></div>' +
    '<div class="pb-item"><span class="pb-label">状态</span><span class="status-tag ' + (sm[p.status] || '') + '">' + esc(p.status) + '</span></div>' +
    (isAdmin() ? '<div style="margin-left:auto;display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="openProjectModal(\'' + p.id + '\')">编辑</button><button class="btn btn-danger btn-sm" onclick="deleteProject(\'' + p.id + '\')">删除</button></div>' : '');
}

function openProjectDetail(id) {
  var p = projects.find(function(x) { return x.id === id; }); if (!p) return;
  document.getElementById('detailClient').textContent = p.clientName || '-';
  document.getElementById('detailPhone').textContent = p.clientPhone || '-';
  document.getElementById('detailAddress').textContent = p.address || '-';
  document.getElementById('detailContract').textContent = fmtM(p.contractAmount);
  document.getElementById('detailStatus').textContent = p.status || '-';
  document.getElementById('detailStart').textContent = fmtD(p.startDate);
  document.getElementById('detailEnd').textContent = fmtD(p.expectedEndDate);
  document.getElementById('detailActualEnd').textContent = fmtD(p.actualEndDate);
  document.getElementById('detailWarranty').textContent = fmtD(p.warrantyExpiry);
  document.getElementById('detailNotes').textContent = p.notes || '无';
  document.getElementById('projectDetailOverlay').classList.add('active');
}
function closeProjectDetail() { document.getElementById('projectDetailOverlay').classList.remove('active'); }

function renderTables() {
  var show = !!currentProjectId;
  document.getElementById('twoCol').style.display = show ? '' : 'none';
  document.getElementById('profitSection').style.display = show ? '' : 'none';
  document.getElementById('btnAddRevenue').style.display = (show && isAdmin()) ? '' : 'none';
  document.getElementById('btnAddCost').style.display = (show && isAdmin()) ? '' : 'none';
  if (!show) {
    document.getElementById('revenueBody').innerHTML = ''; document.getElementById('costBody').innerHTML = '';
    document.getElementById('revenueEmpty').style.display = ''; document.getElementById('costEmpty').style.display = '';
    document.getElementById('profitInner').innerHTML = '<div class="profit-block"><div class="profit-block-label">提示</div><div class="profit-block-value" style="font-size:var(--fs-md);color:var(--ink3)">请选择一个项目查看收支明细</div></div>';
    return;
  }
  var revs = getRevenues(), costs = getCosts();
  var rBody = document.getElementById('revenueBody'), rEmpty = document.getElementById('revenueEmpty');
  if (!revs.length) { rBody.innerHTML = ''; rEmpty.style.display = ''; }
  else { rEmpty.style.display = 'none';
    var tr = revs.reduce(function(s, x) { return s + (x.amount || 0); }, 0), trec = revs.reduce(function(s, x) { return s + (x.receivedOrPaid || 0); }, 0), tunrec = revs.reduce(function(s, x) { return s + Math.max(0, (x.amount || 0) - (x.receivedOrPaid || 0)); }, 0);
    rBody.innerHTML = revs.map(function(r) { var u = Math.max(0, (r.amount || 0) - (r.receivedOrPaid || 0)); var color = REVENUE_COLORS[r.category] || '#999'; return '<tr><td><span class="tag" style="background:' + color + '18;color:' + color + '">' + esc(r.category || '-') + '</span></td><td>' + esc(r.description || '-') + '</td><td class="money green">' + fmtM(r.amount) + '</td><td class="money green">' + fmtM(r.receivedOrPaid) + '</td><td class="money' + (u > 0 ? ' orange' : '') + '">' + fmtM(u) + '</td><td>' + fmtD(r.date) + '</td><td style="max-width:80px;overflow:hidden;text-overflow:ellipsis" title="' + esc(r.notes || '') + '">' + esc(r.notes || '-') + '</td><td>' + (isAdmin() ? '<button class="btn btn-ghost btn-xs" onclick="openEditItemModal(\'revenue\',\'' + r.id + '\')">编辑</button><button class="btn btn-danger btn-xs" onclick="deleteItem(\'revenue\',\'' + r.id + '\')">删除</button>' : '') + '</td></tr>'; }).join('') +
    '<tr class="summary-row"><td><strong>合计</strong></td><td></td><td class="money green">' + fmtM(tr) + '</td><td class="money green">' + fmtM(trec) + '</td><td class="money orange">' + fmtM(tunrec) + '</td><td colspan="3"></td></tr>'; }
  var cBody = document.getElementById('costBody'), cEmpty = document.getElementById('costEmpty');
  if (!costs.length) { cBody.innerHTML = ''; cEmpty.style.display = ''; }
  else { cEmpty.style.display = 'none';
    var tc = costs.reduce(function(s, x) { return s + (x.amount || 0); }, 0), tpd = costs.reduce(function(s, x) { return s + (x.receivedOrPaid || 0); }, 0), tunpd = costs.reduce(function(s, x) { return s + Math.max(0, (x.amount || 0) - (x.receivedOrPaid || 0)); }, 0);
    cBody.innerHTML = costs.map(function(c) { var u = Math.max(0, (c.amount || 0) - (c.receivedOrPaid || 0)); var color = COST_COLORS[c.category] || '#999'; return '<tr><td><span class="tag" style="background:' + color + '18;color:' + color + '">' + esc(c.category || '-') + '</span></td><td>' + esc(c.description || '-') + '</td><td class="money red">' + fmtM(c.amount) + '</td><td class="money">' + fmtM(c.receivedOrPaid) + '</td><td class="money' + (u > 0 ? ' orange' : '') + '">' + fmtM(u) + '</td><td>' + esc(c.supplier || '-') + '</td><td>' + fmtD(c.date) + '</td><td style="max-width:80px;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.notes || '') + '">' + esc(c.notes || '-') + '</td><td>' + (isAdmin() ? '<button class="btn btn-ghost btn-xs" onclick="openEditItemModal(\'cost\',\'' + c.id + '\')">编辑</button><button class="btn btn-danger btn-xs" onclick="deleteItem(\'cost\',\'' + c.id + '\')">删除</button>' : '') + '</td></tr>'; }).join('') +
    '<tr class="summary-row"><td><strong>合计</strong></td><td></td><td class="money red">' + fmtM(tc) + '</td><td class="money">' + fmtM(tpd) + '</td><td class="money orange">' + fmtM(tunpd) + '</td><td colspan="4"></td></tr>'; }
  var revT = revs.reduce(function(s, x) { return s + (x.amount || 0); }, 0), costT = costs.reduce(function(s, x) { return s + (x.amount || 0); }, 0);
  var profit = revT - costT, margin = revT > 0 ? (profit / revT * 100) : 0, pc = profit >= 0 ? 'var(--stat-rev)' : 'var(--danger)';
  document.getElementById('profitInner').innerHTML =
    '<div class="profit-block"><div class="profit-block-label">总营收</div><div class="profit-block-value" style="color:var(--stat-rev)">' + fmtM(revT) + '</div></div>' +
    '<div class="profit-sep">−</div>' +
    '<div class="profit-block"><div class="profit-block-label">总成本</div><div class="profit-block-value" style="color:var(--danger)">' + fmtM(costT) + '</div></div>' +
    '<div class="profit-sep">=</div>' +
    '<div class="profit-block"><div class="profit-block-label">利润</div><div class="profit-block-value" style="font-size:var(--fs-2xl);color:' + pc + '">' + (profit >= 0 ? '' : '-') + fmtM(Math.abs(profit)) + '</div><div class="profit-block-sub" style="color:' + pc + '">利润率 ' + (margin >= 0 ? '' : '-') + Math.abs(margin).toFixed(1) + '%</div></div>';
}

/* ── Charts ── */
function renderCharts() {
  var revs = currentProjectId ? revenueItems.filter(function(x) { return x.projectId === currentProjectId; }) : revenueItems;
  var costs = currentProjectId ? costItems.filter(function(x) { return x.projectId === currentProjectId; }) : costItems;
  var cm = {}; costs.forEach(function(c) { var cat = c.category || '其他'; cm[cat] = (cm[cat] || 0) + (c.amount || 0); });
  var rm = {}; revs.forEach(function(r) { var cat = r.category || '其他'; rm[cat] = (rm[cat] || 0) + (r.amount || 0); });
  drawPie('costPieChart', cm, COST_COLORS); drawPie('revenuePieChart', rm, REVENUE_COLORS);
  var ce = Object.entries(cm).sort(function(a, b) { return b[1] - a[1]; });
  document.getElementById('costPieLegend').innerHTML = ce.length ? ce.map(function(e) { return '<div class="chart-legend-item"><div class="chart-legend-dot" style="background:' + (COST_COLORS[e[0]] || '#ccc') + '"></div>' + esc(e[0]) + '：' + fmtMS(e[1]) + '</div>'; }).join('') : '<span style="color:var(--ink3);font-size:var(--fs-xs)">暂无数据</span>';
  var re = Object.entries(rm).sort(function(a, b) { return b[1] - a[1]; });
  document.getElementById('revenuePieLegend').innerHTML = re.length ? re.map(function(e) { return '<div class="chart-legend-item"><div class="chart-legend-dot" style="background:' + (REVENUE_COLORS[e[0]] || '#ccc') + '"></div>' + esc(e[0]) + '：' + fmtMS(e[1]) + '</div>'; }).join('') : '<span style="color:var(--ink3);font-size:var(--fs-xs)">暂无数据</span>';
}

function drawPie(canvasId, dataMap, colorMap) {
  var canvas = document.getElementById(canvasId), ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = 220 * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var W = rect.width, H = 220; ctx.clearRect(0, 0, W, H);
  var entries = Object.entries(dataMap).filter(function(e) { return e[1] > 0; }), total = entries.reduce(function(s, e) { return s + e[1]; }, 0);
  if (!entries.length) { ctx.fillStyle = '#e5e0d8'; ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) / 2 - 10, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#968c7e'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('暂无数据', W / 2, H / 2); return; }
  /* Calculate fair percentages (largest-remainder, always sums to 100) */
  var pcts = entries.map(function(e) { return (e[1] / total) * 100; });
  var floors = pcts.map(function(v) { return Math.floor(v); });
  var sum = floors.reduce(function(s, v) { return s + v; }, 0);
  var remainders = pcts.map(function(v, i) { return { idx: i, rem: v - Math.floor(v) }; });
  remainders.sort(function(a, b) { return b.rem - a.rem; });
  for (var ri = 0; ri < 100 - sum; ri++) { floors[remainders[ri].idx]++; }

  var GAP = 2, cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 24, angle = -Math.PI / 2;
  entries.forEach(function(e, idx) {
    var val = e[1], slice = (val / total) * Math.PI * 2, color = colorMap[e[0]] || CHART_COLORS[idx % CHART_COLORS.length];
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, angle, angle + slice); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    if (idx > 0) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, angle, angle + GAP / r); ctx.closePath(); ctx.fillStyle = '#faf8f5'; ctx.fill(); }
    var pct = floors[idx];
    if (pct > 5) { var mid = angle + slice / 2, lx = cx + Math.cos(mid) * (r * 0.65), ly = cy + Math.sin(mid) * (r * 0.65); ctx.fillStyle = (idx === 3 || idx === 2) ? '#1a1a1a' : '#ffffff'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pct + '%', lx, ly); }
    angle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = '#faf8f5'; ctx.lineWidth = GAP; ctx.stroke();
}

/* ── Export / Import ── */
async function exportData() {
  var blob = new Blob([JSON.stringify({ projects: projects, revenueItems: revenueItems, costItems: costItems }, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '时序空间_' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); showToast('数据已导出');
}
async function importData(e) {
  var file = (e && e.target) ? e.target.files[0] : null; if (!file) { document.getElementById('importFile').click(); return; }
  var reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      var data = JSON.parse(ev.target.result);
      if (!data.projects || !data.revenueItems || !data.costItems) throw new Error('格式错误');
      if (!confirm('即将导入 ' + data.projects.length + ' 个项目。此操作将覆盖当前数据，确定继续？')) return;
      for (var i = 0; i < data.projects.length; i++) { var p = data.projects[i]; var up = unmapProject(p); delete up.id; var pr = await supaFetch('projects', { method: 'POST', body: JSON.stringify(up) }); var newPid = pr[0].id; for (var j = 0; j < data.revenueItems.length; j++) { var r = data.revenueItems[j]; if (r.projectId === p.id) { var ur = unmapRevenue(r); ur.project_id = newPid; await supaFetch('revenue_items', { method: 'POST', body: JSON.stringify(ur) }); } } for (var k = 0; k < data.costItems.length; k++) { var c = data.costItems[k]; if (c.projectId === p.id) { var uc = unmapCost(c); uc.project_id = newPid; await supaFetch('cost_items', { method: 'POST', body: JSON.stringify(uc) }); } } }
      currentProjectId = ''; await loadAll(); buildProjectSelector(); document.getElementById('projectSelect').value = ''; renderAll(); showToast('导入完成');
    } catch(err) { alert('导入失败：' + err.message); }
  };
  reader.readAsText(file); if (e && e.target) e.target.value = '';
}

/* ── Toast ── */
function showToast(msg, duration) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(function() { t.classList.remove('show'); }, duration || 2000); }
function renderAll() { if (!dataLoaded) return; renderStats(); renderProjectBar(); renderTables(); renderCharts(); }

/* ── Storage Banner ── */
function updateStorageBanner(state) {
  var banner = document.getElementById('storageBanner');
  if (state === 'ready') { banner.className = 'storage-banner ready'; banner.innerHTML = '<span class="banner-text">' + ico('folder', 'sm') + ' <strong>云端连接成功</strong> — Supabase 数据共享中</span>'; }
  else { banner.className = 'storage-banner setup'; banner.innerHTML = '<span class="banner-text">' + ico('folder', 'sm') + ' <strong>正在加载数据……</strong></span>'; }
}

/* ── Init ── */
async function init() {
  /* Try to restore session */
  authSession = loadSession();
  if (authSession) {
    /* Try refresh first */
    var ok = await refreshSession();
    if (ok) {
      /* Logged in — show app */
      currentUserRole = await fetchUserRole();
      document.getElementById('authOverlay').classList.remove('active');
      renderUserBadge();
      updateAdminUI();
      updateStorageBanner('loading');
      await loadAll();
      buildProjectSelector();
      renderAll();
      updateStorageBanner('ready');
      return;
    }
  }
  /* Not logged in — show login */
  document.getElementById('authOverlay').classList.add('active');
  document.getElementById('authForm').email.focus();
}

init();

document.getElementById('projectModalOverlay').addEventListener('click', function(e) { if (e.target === this) closeProjectModal(); });
document.getElementById('itemModalOverlay').addEventListener('click', function(e) { if (e.target === this) closeItemModal(); });
document.getElementById('projectDetailOverlay').addEventListener('click', function(e) { if (e.target === this) closeProjectDetail(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeProjectModal(); closeItemModal(); closeProjectDetail(); } });
var _rt; window.addEventListener('resize', function() { clearTimeout(_rt); _rt = setTimeout(renderCharts, 200); });
