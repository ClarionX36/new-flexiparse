const state = { csrfToken: '', user: null, dashboard: null, currentTableId: null, currentResult: null, recaptchaSiteKey: '', historyLoading: false, historyTimer: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let initialTheme = 'dark';
try {
  initialTheme = localStorage.getItem('flexiparse-theme') || 'dark';
} catch (error) {
  console.warn('Could not read the saved theme preference.', error);
}
setTheme(initialTheme === 'light' ? 'light' : 'dark');

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.csrfToken && !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) headers['x-csrf-token'] = state.csrfToken;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  if (!response.ok) throw new Error(await response.text() || 'Request failed.');
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
  $('#dashboard-title').textContent = ({ overview: 'Overview', tables: 'My tables', referral: 'Referrals' })[name] || 'Overview';
  if (name === 'tables') loadTables();
}

async function loadTables() {
  const data = await api('/api/tables');
  renderTableList($('#all-tables'), data.tables);
}

function renderTableList(target, tables) {
  if (!tables.length) {
    target.innerHTML = '<div class="empty-state"><span>▤</span><h3>No tables yet</h3><p>Upload your first document to start extracting data.</p></div>';
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
    meta.textContent = `${table.originalFilename} · ${table.totalPages} pages · ${new Date(table.createdAt).toLocaleDateString('en-US')}`;
    detail.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    const open = document.createElement('button');
    open.className = 'button button-outline button-small';
    open.textContent = 'Open table';
    open.addEventListener('click', () => openTable(table.id));
    const remove = document.createElement('button');
    remove.className = 'icon-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Delete table');
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete table "${table.title}"?`)) return;
      try {
        await api(`/api/tables/${table.id}`, { method: 'DELETE' });
        await refreshDashboard();
        toast('Table deleted.');
      } catch (error) { toast(error.message, true); }
    });
    actions.append(open, remove);
    item.append(title, detail, actions);
    target.append(item);
  });
}

async function loadExtractionHistory() {
  if (state.historyLoading) return;
  state.historyLoading = true;
  try {
    const { jobs } = await api('/api/extractions');
    renderExtractionHistory($('#extraction-history'), jobs);
  } finally {
    state.historyLoading = false;
  }
}

function renderExtractionHistory(target, jobs) {
  if (!jobs.length) {
    target.innerHTML = '<div class="empty-state"><span>▤</span><h3>No documents yet</h3><p>Uploaded documents and their processing status will appear here.</p></div>';
    return;
  }

  const statusLabels = {
    pending: 'Queued',
    processing: 'Processing',
    completed: 'Completed',
    failed: 'Failed'
  };
  target.replaceChildren();
  jobs.forEach((job) => {
    const item = document.createElement('article');
    item.className = 'saved-table extraction-job';

    const fileType = document.createElement('span');
    fileType.className = 'file-type';
    fileType.textContent = job.mimeType === 'application/pdf' ? 'PDF' : 'IMG';

    const detail = document.createElement('div');
    detail.className = 'saved-detail extraction-job-detail';
    const name = document.createElement('b');
    name.textContent = job.originalFilename;
    const meta = document.createElement('small');
    const createdAt = new Date(job.createdAt);
    const dateLabel = Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString('en-US');
    meta.textContent = `${job.totalPages} ${Number(job.totalPages) === 1 ? 'page' : 'pages'} · ${dateLabel}`;
    detail.append(name, meta);

    const status = document.createElement('span');
    status.className = 'job-status';
    const statusLabel = statusLabels[job.status];
    if (statusLabel) status.classList.add(`job-status-${job.status}`);
    status.textContent = statusLabel || 'Unknown';

    item.append(fileType, detail, status);
    if (job.status === 'failed' && job.errorMessage) {
      const error = document.createElement('p');
      error.className = 'extraction-job-error';
      error.textContent = job.errorMessage;
      item.append(error);
    }
    if (job.status === 'completed' && job.tableId) {
      const actions = document.createElement('div');
      actions.className = 'saved-actions';
      const open = document.createElement('button');
      open.className = 'button button-outline button-small';
      open.textContent = 'View results';
      open.addEventListener('click', () => openTable(job.tableId));
      actions.append(open);
      item.append(actions);
    }
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
  $('#quota-value').textContent = totalQuota.toLocaleString('en-US');
  $('#quota-note').textContent = `${Number(user.monthlyQuota).toLocaleString('en-US')} monthly · ${Number(user.addonQuota).toLocaleString('en-US')} bonus`;
  const limit = data.plans[user.planTier]?.tables ?? 1;
  const unlimitedTables = limit === 'unlimited';
  $('#table-count').textContent = `${data.tableCount} / ${unlimitedTables ? '∞' : limit}`;
  $('#table-note').textContent = 'tables saved in your workspace';
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
  await loadExtractionHistory();
  if (data.payouts.length) {
    const latest = data.payouts[0];
    if (latest.status === 'requested') showNotice('Your payout request is being processed.', 'info');
  }
}

async function openTable(id) {
  try {
    const { table } = await api(`/api/tables/${id}`);
    state.currentTableId = id;
    state.currentResult = table.result;
    $('#editor-title').textContent = table.title;
    $('#editor-meta').textContent = `${table.originalFilename} · ${table.totalPages} pages`;
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
  showNotice(`Uploading ${file.name} to the queue…`, 'info');
  try {
    const headers = {};
    if (state.recaptchaSiteKey) headers['x-recaptcha-token'] = await getRecaptchaToken('extract');
    const queued = await api('/api/extract', { method: 'POST', body, headers });
    await loadExtractionHistory();
    showNotice('Your document is queued. This page will update when processing is complete.', 'info');
    let completedJob;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const { job } = await api(`/api/extractions/${queued.id}`);
      if (job.status === 'failed') throw new Error(job.errorMessage || 'Extraction failed.');
      if (job.status === 'completed') {
        completedJob = job;
        break;
      }
      showNotice(job.status === 'processing' ? 'AI is extracting your data…' : 'Your document is waiting in the queue…', 'info');
    }
    if (!completedJob) throw new Error('Processing is taking longer than expected. Your job is saved; check your workspace again shortly.');
    showNotice('Extraction complete. Review and edit your results below.', 'success');
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
      script.onerror = () => reject(new Error('Could not load reCAPTCHA.'));
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
    $('#account-actions').innerHTML = '<a class="button button-quiet" href="/auth/google">Sign in <span>↗</span></a>';
    if (new URLSearchParams(location.search).has('login')) toast('Sign-in failed. Please try again.', true);
    return;
  }
  state.user = me.user;
  $('#account-actions').innerHTML = '<button class="button button-quiet" id="open-workspace">Open workspace <span>→</span></button>';
  $('#open-workspace').addEventListener('click', () => { location.href = '/dashboard'; });
  if (location.pathname === '/dashboard') {
    $('.hero').classList.add('hidden');
    $$('.trust-strip, .how-section, .workspace-preview, .pricing, .bottom-cta, footer').forEach((node) => node.classList.add('hidden'));
    $('#app-shell').classList.remove('hidden');
    await refreshDashboard();
    state.historyTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadExtractionHistory().catch((error) => {
          console.error('Could not refresh document history:', error);
        });
      }
    }, 15000);
    const params = new URLSearchParams(location.search);
    if (params.get('payment') === 'success') showNotice('Payment received. Your plan will update after Lemon Squeezy confirms the transaction.', 'info');
    if (params.get('payment') === 'cancelled') showNotice('Payment cancelled.', 'info');
  }
}

$('#choose-file-button')?.addEventListener('click', () => $('#document-file').click());
$('#choose-file-button-secondary')?.addEventListener('click', () => $('#document-file').click());
$('#choose-file-button-tables')?.addEventListener('click', () => $('#document-file').click());
$('#document-file')?.addEventListener('change', (event) => handleUpload(event.target.files[0]));
$('#refresh-extractions')?.addEventListener('click', () => {
  loadExtractionHistory().catch((error) => toast(error.message, true));
});
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
    toast('Table changes saved.');
  } catch (error) { toast(error.message, true); }
});
$('#export-csv')?.addEventListener('click', () => downloadExport('csv'));
$('#export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));
$('#copy-referral')?.addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#referral-link').textContent);
  toast('Referral link copied.');
});
$$('input[name="reward"]').forEach((radio) => radio.addEventListener('change', async () => {
  try {
    await api('/api/referral-reward', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choice: radio.value }) });
    toast('Reward preference updated.');
  } catch (error) { toast(error.message, true); }
}));
$('#payout-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/payouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: form.get('method'), account: form.get('account') }) });
    toast('Payout request submitted.');
    await refreshDashboard();
  } catch (error) { toast(error.message, true); }
});

initApp().catch((error) => {
  console.error(error);
  if (location.pathname === '/dashboard') showNotice(`Could not load workspace: ${error.message}`, 'error');
});

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#0b1020' : '#ffffff';
  try {
    localStorage.setItem('flexiparse-theme', theme);
  } catch (error) {
    console.warn('Could not save theme preference.', error);
  }
  $$('.theme-toggle').forEach((button) => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
    button.innerHTML = theme === 'dark' ? '☀ <span>Light mode</span>' : '☾ <span>Dark mode</span>';
  });
}

$$('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}));
