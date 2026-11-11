const state = { csrfToken: '', user: null, dashboard: null, currentTableId: null, currentResult: null, recaptchaSiteKey: '' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.csrfToken && !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers['x-csrf-token'] = state.csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
    return data;
  }
  if (!response.ok) throw new Error(await response.text() || 'Permintaan gagal.');
  return response;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('toast-error', error);
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 3600);
}

function showNotice(message, type = 'success') {
  const node = $('#notice');
  if (!node) return;
  node.textContent = message;
  node.className = `notice ${type}`;
}

function safeText(value) {
  return String(value ?? '');
}

function setView(name) {
  $$('.app-view').forEach((view) => view.classList.add('hidden'));
  $(`#${name}-view`)?.classList.remove('hidden');
  $$('.side-link[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  $('#dashboard-title').textContent = ({ overview: 'Ringkasan', tables: 'Tabel saya', referral: 'Referral' })[name] || 'Ringkasan';
  if (name === 'tables') loadTables();
}

async function loadTables() {
  const data = await api('/api/tables');
  renderTableList($('#all-tables'), data.tables);
}

function renderTableList(target, tables) {
  if (!tables.length) {
    target.innerHTML = '<div class="empty-state"><span>▤</span><h3>Belum ada tabel</h3><p>Unggah dokumen pertama Anda untuk mulai mengekstrak data.</p></div>';
    return;
  }
  target.innerHTML = '';
  tables.forEach((table) => {
    const item = document.createElement('article');
    item.className = 'saved-table';
    const title = document.createElement('div');
    title.className = 'saved-title';
    title.innerHTML = '<span class="file-type">PDF</span>';
    const detail = document.createElement('div');
    detail.className = 'saved-detail';
    const name = document.createElement('b');
    name.textContent = table.title;
    const meta = document.createElement('small');
    meta.textContent = `${table.originalFilename} · ${table.totalPages} halaman · ${new Date(table.createdAt).toLocaleDateString('id-ID')}`;
    detail.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    const open = document.createElement('button');
    open.className = 'button button-outline button-small';
    open.textContent = 'Buka tabel';
    open.addEventListener('click', () => openTable(table.id));
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Hapus tabel');
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Hapus tabel "${table.title}"?`)) return;
      try {
        await api(`/api/tables/${table.id}`, { method: 'DELETE' });
        await refreshDashboard();
        toast('Tabel berhasil dihapus.');
      } catch (error) { toast(error.message, true); }
    });
    actions.append(open, remove);
    item.append(title, detail, actions);
    target.append(item);
  });
}

async function refreshDashboard() {
  const data = await api('/api/dashboard');
  state.dashboard = data;
  const user = data.user;
  $('#welcome-name').textContent = (user.name || user.email.split('@')[0]).split(' ')[0];
  $('#user-name').textContent = user.name || user.email;
  $('#avatar-fallback').textContent = (user.name || user.email).slice(0, 1).toUpperCase();
  if (user.avatar) {
    $('#user-avatar').src = user.avatar;
    $('#user-avatar').classList.add('visible');
    $('#avatar-fallback').classList.add('hidden');
  }
  const totalQuota = Number(user.monthlyQuota) + Number(user.addonQuota);
  $('#quota-value').textContent = totalQuota.toLocaleString('id-ID');
  $('#quota-note').textContent = `${Number(user.monthlyQuota).toLocaleString('id-ID')} bulanan · ${Number(user.addonQuota).toLocaleString('id-ID')} bonus`;
  const limit = data.plans[user.planTier]?.tables ?? 1;
  const unlimitedTables = limit === 'unlimited';
  $('#table-count').textContent = `${data.tableCount} / ${unlimitedTables ? '∞' : limit}`;
  $('#table-note').textContent = 'tabel tersimpan di workspace';
  $('#plan-value').textContent = user.planTier[0].toUpperCase() + user.planTier.slice(1);
  $('#topup-panel').classList.toggle('hidden', !['starter', 'pro', 'scale'].includes(user.planTier));
  $('#quota-bar-fill').style.width = `${Math.min(100, totalQuota / (data.plans[user.planTier]?.pages || 5) * 100)}%`;
  $('#table-bar-fill').style.width = `${unlimitedTables ? 14 : Math.min(100, data.tableCount / limit * 100)}%`;
  $('#affiliate-balance').textContent = `$${Number(user.affiliateBalance).toFixed(2)}`;
  $$('input[name="reward"]').forEach((radio) => { radio.checked = radio.value === user.referralRewardChoice; });
  const referralUrl = `${location.origin}/?ref=${encodeURIComponent(user.referralCode)}`;
  $('#referral-link').textContent = referralUrl;
  const tables = await api('/api/tables');
  renderTableList($('#recent-tables'), tables.tables.slice(0, 5));
  renderTableList($('#all-tables'), tables.tables);
  if (data.payouts.length) {
    const latest = data.payouts[0];
    if (latest.status === 'requested') showNotice('Permintaan payout Anda sedang diproses.', 'info');
  }
}

async function openTable(id) {
  try {
    const { table } = await api(`/api/tables/${id}`);
    state.currentTableId = id;
    state.currentResult = table.result;
    $('#editor-title').textContent = table.title;
    $('#editor-meta').textContent = `${table.originalFilename} · ${table.totalPages} halaman`;
    renderEditableTable(table.result);
    $('#editor-modal').classList.remove('hidden');
  } catch (error) { toast(error.message, true); }
}

function renderEditableTable(result) {
  const wrapper = $('#editable-table');
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  result.headers.forEach((header) => {
    const th = document.createElement('th');
    th.contentEditable = 'true';
    th.textContent = safeText(header);
    headRow.append(th);
  });
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  result.rows.forEach((row) => {
    const tr = document.createElement('tr');
    result.headers.forEach((_, index) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = safeText(row[index]);
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrapper.replaceChildren(table);
}

function readEditableTable() {
  const rows = $$('#editable-table tr');
  return {
    headers: rows[0] ? $$('th', rows[0]).map((cell) => cell.textContent.trim()) : [],
    rows: rows.slice(1).map((row) => $$('td', row).map((cell) => cell.textContent.trim()))
  };
}

async function handleUpload(file) {
  if (!file) return;
  const body = new FormData();
  body.append('document', file);
  showNotice(`Mengunggah ${file.name} ke antrean…`, 'info');
  try {
    const headers = {};
    if (state.recaptchaSiteKey) headers['x-recaptcha-token'] = await getRecaptchaToken('extract');
    const queued = await api('/api/extract', { method: 'POST', body, headers });
    showNotice('Dokumen masuk antrean. Halaman akan diperbarui saat selesai diproses.', 'info');
    let completedJob;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const { job } = await api(`/api/extractions/${queued.id}`);
      if (job.status === 'failed') throw new Error(job.errorMessage || 'Ekstraksi gagal.');
      if (job.status === 'completed') {
        completedJob = job;
        break;
      }
      showNotice(job.status === 'processing' ? 'AI sedang mengekstrak data…' : 'Dokumen menunggu giliran di antrean…', 'info');
    }
    if (!completedJob) throw new Error('Pemrosesan belum selesai. Job tetap tersimpan; buka kembali workspace beberapa saat lagi.');
    showNotice('Ekstraksi selesai. Periksa dan edit hasilnya di bawah.', 'success');
    await refreshDashboard();
    await openTable(completedJob.tableId);
  } catch (error) {
    showNotice(error.message, 'error');
    toast(error.message, true);
  } finally {
    $('#document-file').value = '';
  }
}

async function getRecaptchaToken(action) {
  if (!window.grecaptcha) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(state.recaptchaSiteKey)}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error('reCAPTCHA gagal dimuat.'));
      document.head.append(script);
    });
  }
  return new Promise((resolve, reject) => {
    window.grecaptcha.ready(() => window.grecaptcha.execute(state.recaptchaSiteKey, { action }).then(resolve).catch(reject));
  });
}

async function downloadExport(format) {
  try {
    const response = await api(`/api/tables/${state.currentTableId}/export?format=${format}`);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `flexiparse.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) { toast(error.message, true); }
}

async function initApp() {
  const me = await api('/api/me');
  state.csrfToken = me.csrfToken || '';
  state.recaptchaSiteKey = me.recaptchaSiteKey || '';
  const referralCode = new URLSearchParams(location.search).get('ref');
  if (referralCode && /^[A-Z0-9]{6,20}$/i.test(referralCode)) {
    $$('a[href="/auth/google"]').forEach((link) => { link.href = `/auth/google?ref=${encodeURIComponent(referralCode)}`; });
  }
  if (!me.authenticated) {
    $('#account-actions').innerHTML = '<a class="button button-quiet" href="/auth/google">Masuk <span>↗</span></a>';
    if (new URLSearchParams(location.search).has('login')) toast('Login tidak berhasil. Silakan coba lagi.', true);
    return;
  }
  state.user = me.user;
  $('#account-actions').innerHTML = '<button class="button button-quiet" id="open-workspace">Buka workspace <span>→</span></button>';
  $('#open-workspace').addEventListener('click', () => { location.href = '/dashboard'; });
  if (location.pathname === '/dashboard') {
    $('.hero').classList.add('hidden');
    $$('.trust-strip, .how-section, .workspace-preview, .pricing, .bottom-cta, footer').forEach((node) => node.classList.add('hidden'));
    $('#app-shell').classList.remove('hidden');
    await refreshDashboard();
    const params = new URLSearchParams(location.search);
    if (params.get('payment') === 'success') showNotice('Pembayaran diterima. Paket diperbarui setelah Lemon Squeezy mengonfirmasi transaksi.', 'info');
    if (params.get('payment') === 'cancelled') showNotice('Pembayaran dibatalkan.', 'info');
  }
}

$('#choose-file-button')?.addEventListener('click', () => $('#document-file').click());
$('#choose-file-button-secondary')?.addEventListener('click', () => $('#document-file').click());
$('#choose-file-button-tables')?.addEventListener('click', () => $('#document-file').click());
$('#document-file')?.addEventListener('change', (event) => handleUpload(event.target.files[0]));
$$('.side-link[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-view="tables"]').forEach((button) => button.addEventListener('click', () => setView('tables')));
$$('[data-scroll-plans]').forEach((button) => button.addEventListener('click', () => { location.href = '/#plans'; }));
$('#logout-button')?.addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); location.href = '/'; } catch (error) { toast(error.message, true); }
});
$$('.paid-plan').forEach((button) => button.addEventListener('click', async () => {
  if (!state.user) {
    location.href = '/auth/google';
    return;
  }
  try {
    const result = await api('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'subscription', plan: button.dataset.plan }) });
    location.href = result.url;
  } catch (error) { toast(error.message, true); }
}));
$$('.topup-button').forEach((button) => button.addEventListener('click', async () => {
  try {
    const result = await api('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'topup', pages: Number(button.dataset.pages) })
    });
    location.href = result.url;
  } catch (error) { toast(error.message, true); }
}));
$$('[data-close-editor]').forEach((button) => button.addEventListener('click', () => $('#editor-modal').classList.add('hidden')));
$('#editor-modal')?.addEventListener('click', (event) => { if (event.target.id === 'editor-modal') event.currentTarget.classList.add('hidden'); });
$('#save-table')?.addEventListener('click', async () => {
  try {
    await api(`/api/tables/${state.currentTableId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: $('#editor-title').textContent, result: readEditableTable() })
    });
    toast('Perubahan tabel tersimpan.');
  } catch (error) { toast(error.message, true); }
});
$('#export-csv')?.addEventListener('click', () => downloadExport('csv'));
$('#export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));
$('#copy-referral')?.addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#referral-link').textContent);
  toast('Link referral disalin.');
});
$$('input[name="reward"]').forEach((radio) => radio.addEventListener('change', async () => {
  try {
    await api('/api/referral-reward', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choice: radio.value }) });
    toast('Pilihan reward diperbarui.');
  } catch (error) { toast(error.message, true); }
}));
$('#payout-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/payouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: form.get('method'), account: form.get('account') }) });
    toast('Permintaan payout berhasil dikirim.');
    await refreshDashboard();
  } catch (error) { toast(error.message, true); }
});

initApp().catch((error) => {
  console.error(error);
  if (location.pathname === '/dashboard') showNotice(`Workspace gagal dimuat: ${error.message}`, 'error');
});
