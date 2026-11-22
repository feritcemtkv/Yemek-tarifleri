'use strict';

/* Tariflerim — Surface'taki PocketBase'e bağlanan PWA.
   Tarifler sunucuda "tarifler" koleksiyonunda durur; son liste bu cihazda da
   saklanır, böylece bağlantı yokken de tarifler açılır. */

const COLLECTION = 'tarifler';
const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULT_CATEGORIES = ['Ana Yemek', 'Çorbalar', 'Tatlılar', 'Hamur İşi', 'Kahvaltılık', 'Salatalar', 'Fit Tarifler', 'Atıştırmalık', 'İçecekler'];

const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* depolama kapalı olabilir */ }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* yok say */ } },
};

const state = {
  server: store.get('server', ''),
  auth: store.get('auth', null),          // { token, email }
  recipes: store.get('recipes_cache', []),
  filter: { q: '', category: 'Tümü' },
  current: null,                           // ayrıntıda açık tarif
  editing: null,                           // düzenlenen tarif (yeni ise null)
  wakeLock: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trLower = (s) => String(s ?? '').toLocaleLowerCase('tr');

/* ---------- Sunucu ---------- */

function apiBase() {
  const s = (state.server || '').trim().replace(/\/+$/, '');
  return s || location.origin;
}

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth && state.auth?.token) headers.Authorization = state.auth.token;
  let res;
  try {
    res = await fetch(apiBase() + path, { method, headers, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)) });
  } catch {
    throw new ApiError('Sunucuya ulaşılamadı.', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) { logout(true); }
    throw new ApiError(data?.message || `Sunucu hatası (${res.status}).`, res.status);
  }
  return data;
}

async function login(email, password) {
  const data = await api('/api/collections/users/auth-with-password', {
    method: 'POST', auth: false, body: { identity: email, password },
  });
  state.auth = { token: data.token, email: data.record?.email || email };
  store.set('auth', state.auth);
}

async function refreshAuth() {
  if (!state.auth?.token) return;
  try {
    const data = await api('/api/collections/users/auth-refresh', { method: 'POST' });
    state.auth.token = data.token;
    store.set('auth', state.auth);
  } catch { /* çevrimdışı olabilir; mevcut belirteçle devam */ }
}

function logout(expired = false) {
  state.auth = null;
  store.remove('auth');
  store.remove('recipes_cache');
  state.recipes = [];
  go('login');
  if (expired) showError('login-error', 'Oturumun süresi doldu. Tekrar giriş yap.');
}

function toRecord(r) {
  return {
    title: r.title?.trim() || '',
    category: r.category?.trim() || '',
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map((x) => String(x).trim()).filter(Boolean) : [],
    instructions: r.instructions?.trim() || '',
    url: r.url?.trim() || '',
    favorite: !!r.favorite,
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(r[k] ?? '').trim()])),
  };
}

const TEXT_FIELDS = ['porsiyon', 'hazirlik', 'pisirme', 'notlar', 'thermomix', 'yazar'];

function fileUrl(r, field, thumb) {
  if (!r?.[field]) return '';
  return `${apiBase()}/api/files/${encodeURIComponent(r.collectionId)}/${encodeURIComponent(r.id)}/${encodeURIComponent(r[field])}`
    + (thumb ? `?thumb=${thumb}` : '');
}

async function fetchAll() {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const data = await api(`/api/collections/${COLLECTION}/records?page=${page}&perPage=200&sort=-created&skipTotal=1`);
    out.push(...data.items);
    if (data.items.length < 200) break;
  }
  return out;
}

async function sync({ quiet = false } = {}) {
  if (!state.auth) return;
  if (!quiet) setStatus('Güncelleniyor…');
  try {
    state.recipes = await fetchAll();
    store.set('recipes_cache', state.recipes);
    setStatus('');
    renderList();
  } catch (e) {
    if (e.status === 401) return;
    setStatus(state.recipes.length ? 'Çevrimdışı: kayıtlı tarifler gösteriliyor.' : e.message);
  }
}

function upsertLocal(rec) {
  const i = state.recipes.findIndex((x) => x.id === rec.id);
  if (i >= 0) state.recipes[i] = rec; else state.recipes.unshift(rec);
  store.set('recipes_cache', state.recipes);
}

/* ---------- Gezinme ---------- */

const VIEWS = ['login', 'list', 'detail', 'edit', 'settings'];

function go(view, { push = true } = {}) {
  for (const v of VIEWS) $('view-' + v).hidden = v !== view;
  if (view !== 'detail') { releaseWake(); document.querySelectorAll('#detail video').forEach((v) => v.pause()); }
  if (push && location.hash !== '#' + view) history.pushState({ view }, '', '#' + view);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  const view = (location.hash || '#list').slice(1);
  if (!state.auth) return go('login', { push: false });
  if (view === 'detail') {
    if (!state.current) return go('list', { push: false });
    renderDetail(state.current);
  }
  if (VIEWS.includes(view) && view !== 'login') go(view, { push: false }); else go('list', { push: false });
  if (view === 'list') renderList();
});

document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));

/* ---------- Liste ---------- */

function categories() {
  const used = new Set(state.recipes.map((r) => r.category).filter(Boolean));
  return [...used].sort((a, b) => a.localeCompare(b, 'tr'));
}

function renderChips() {
  const cats = ['Tümü', 'Favoriler', ...categories()];
  if (!cats.includes(state.filter.category)) state.filter.category = 'Tümü';
  $('chips').innerHTML = cats.map((c) =>
    `<button class="chip" aria-pressed="${c === state.filter.category}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.filter.category = b.dataset.cat;
  renderList();
});

function matches(r) {
  const { q, category } = state.filter;
  if (category === 'Favoriler' && !r.favorite) return false;
  if (category !== 'Tümü' && category !== 'Favoriler' && r.category !== category) return false;
  if (!q) return true;
  const hay = trLower([r.title, r.category, r.notlar, ...(r.ingredients || [])].join(' '));
  return trLower(q).split(/\s+/).every((w) => hay.includes(w));
}

function renderList() {
  renderChips();
  const list = state.recipes.filter(matches);
  $('cards').innerHTML = list.map((r) => `
    <li><button class="card${r.kapak ? ' has-img' : ''}" data-id="${esc(r.id)}">
      ${r.kapak ? `<img class="card-img" src="${esc(fileUrl(r, 'kapak', '400x400f'))}" alt="" loading="lazy">` : ''}
      <div class="card-body">
      ${r.category ? `<div class="card-cat">${esc(r.category)}${r.favorite ? ' <span class="card-fav" aria-label="favori">♥</span>' : ''}</div>`
                   : (r.favorite ? '<div class="card-cat card-fav">♥</div>' : '')}
      <div class="card-title">${esc(r.title)}</div>
      ${(r.ingredients || []).length ? `<div class="card-sub">${esc(r.ingredients.join(' · '))}</div>` : ''}
      </div>
    </button></li>`).join('');

  const empty = $('empty');
  if (list.length) { empty.hidden = true; return; }
  empty.hidden = false;
  empty.innerHTML = state.recipes.length
    ? `<strong>Eşleşen tarif yok</strong>Aramayı veya kategoriyi değiştir.`
    : `<strong>Henüz tarif yok</strong>“Tarif ekle” ile ilk tarifini ekle ya da Ayarlar'dan eski arşivi aktar.`;
}

$('cards').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) openDetail(b.dataset.id);
});

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filter.q = e.target.value.trim(); renderList(); }, 120);
});

function setStatus(text) {
  $('status').hidden = !text;
  $('status').textContent = text;
}

/* ---------- Ayrıntı ---------- */

function splitSteps(text) {
  return String(text || '')
    .split(/\n+/)
    .map((s) => s.replace(/^\s*(\d+[.)-]|[-•*])\s*/, '').trim())
    .filter(Boolean);
}

function openDetail(id, { push = true } = {}) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return;
  state.current = r;
  renderDetail(r);
  go('detail', { push });
}

function renderDetail(r) {
  const steps = splitSteps(r.instructions);
  const kapak = fileUrl(r, 'kapak');
  const media = r.video
    ? `<div class="detail-media"><video controls playsinline preload="none" src="${esc(fileUrl(r, 'video'))}"${kapak ? ` poster="${esc(kapak)}"` : ''}></video></div>`
    : (kapak ? `<div class="detail-media"><img src="${esc(kapak)}" alt=""></div>` : '');
  const meta = [['Porsiyon', r.porsiyon], ['Hazırlık', r.hazirlik], ['Pişirme', r.pisirme]].filter(([, v]) => v);
  $('detail').innerHTML = `
    ${media}
    ${r.category ? `<div class="card-cat">${esc(r.category)}</div>` : ''}
    <h1>${esc(r.title)}</h1>
    ${meta.length ? `<div class="meta">${meta.map(([k, v]) => `<span>${k === 'Porsiyon' ? `<span class="sr-only">${k}: </span>` : `<span class="muted">${k} </span>`}${esc(v)}</span>`).join('')}</div>` : ''}
    ${(r.ingredients || []).length ? `
      <h2>Malzemeler</h2>
      <ul class="ing-list">${r.ingredients.map((i, n) =>
        `<li><label><input type="checkbox" id="ing-${n}"><span>${esc(i)}</span></label></li>`).join('')}</ul>` : ''}
    ${steps.length ? `
      <h2>Hazırlanışı</h2>
      <ol class="step-list">${steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>` : ''}
    ${r.thermomix ? `
      <h2>Thermomix</h2>
      <ol class="step-list">${splitSteps(r.thermomix).map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>` : ''}
    ${r.notlar ? `<h2>Notlar</h2><p class="note">${esc(r.notlar)}</p>` : ''}
    ${safeUrl(r.url) ? `<a class="source-link" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Kaynağı aç ↗</a>` : ''}
    ${r.yazar ? `<div class="source-meta">@${esc(r.yazar.replace(/^@/, ''))}</div>` : ''}
    ${'wakeLock' in navigator ? `<label class="wake"><input type="checkbox" id="wake-toggle"> Pişirirken ekran kapanmasın</label>` : ''}
  `;
  $('wake-toggle')?.addEventListener('change', (e) => (e.target.checked ? holdWake() : releaseWake()));
  setFavButton(r.favorite);
}

function safeUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}

function setFavButton(on) {
  $('btn-fav').classList.toggle('on', !!on);
  $('btn-fav').setAttribute('aria-label', on ? 'Favorilerden çıkar' : 'Favorilere ekle');
  $('btn-fav').setAttribute('aria-pressed', String(!!on));
}

$('btn-fav').addEventListener('click', async () => {
  const r = state.current;
  if (!r) return;
  const next = !r.favorite;
  setFavButton(next);
  try {
    const rec = await api(`/api/collections/${COLLECTION}/records/${r.id}`, { method: 'PATCH', body: { favorite: next } });
    state.current = rec;
    upsertLocal(rec);
  } catch (e) {
    setFavButton(r.favorite);
    toast(e.status === 0 ? 'Bağlantı yok, favori kaydedilemedi.' : e.message);
  }
});

$('btn-edit').addEventListener('click', () => openEdit(state.current));

async function holdWake() {
  try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* desteklenmiyor */ }
}
function releaseWake() {
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('wake-toggle')?.checked && !$('view-detail').hidden) holdWake();
});

/* ---------- Ekle / düzenle ---------- */

function openEdit(r) {
  state.editing = r || null;
  $('edit-title').textContent = r ? 'Tarifi düzenle' : 'Yeni tarif';
  $('ai-box').hidden = !!r;
  $('btn-delete').hidden = !r;
  $('ai-raw').value = '';
  fillForm(r || {});
  $('f-title-error').hidden = true;
  $('edit-error').hidden = true;
  $('ai-error').hidden = true;
  $('category-list').innerHTML = [...new Set([...DEFAULT_CATEGORIES, ...categories()])]
    .map((c) => `<option value="${esc(c)}">`).join('');
  go('edit');
}

function fillForm(r) {
  $('f-title').value = r.title || '';
  $('f-category').value = r.category || '';
  $('f-ingredients').value = (r.ingredients || []).join('\n');
  $('f-instructions').value = r.instructions || '';
  $('f-url').value = r.url || '';
  for (const k of ['porsiyon', 'hazirlik', 'pisirme', 'notlar', 'thermomix']) $('f-' + k).value = r[k] || '';
  $('f-kapak').value = '';
  const onizleme = $('f-kapak-onizleme');
  const url = r.id ? fileUrl(r, 'kapak', '400x400f') : '';
  onizleme.hidden = !url;
  if (url) onizleme.src = url; else onizleme.removeAttribute('src');
}

$('f-kapak').addEventListener('change', (e) => {
  const f = e.target.files[0];
  const onizleme = $('f-kapak-onizleme');
  if (!f) return;
  onizleme.src = URL.createObjectURL(f);
  onizleme.hidden = false;
});

function readForm() {
  return toRecord({
    title: $('f-title').value,
    category: $('f-category').value,
    ingredients: $('f-ingredients').value.split('\n'),
    instructions: $('f-instructions').value,
    url: $('f-url').value,
    favorite: state.editing?.favorite,
    yazar: state.editing?.yazar,
    ...Object.fromEntries(['porsiyon', 'hazirlik', 'pisirme', 'notlar', 'thermomix'].map((k) => [k, $('f-' + k).value])),
  });
}

function toBody(data) {
  const file = $('f-kapak').files[0];
  if (!file) return data;
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  fd.append('kapak', file);
  return fd;
}

$('btn-add').addEventListener('click', () => openEdit(null));

$('f-title').addEventListener('blur', () => { $('f-title-error').hidden = !!$('f-title').value.trim(); });
$('f-title').addEventListener('input', () => { if ($('f-title').value.trim()) $('f-title-error').hidden = true; });

$('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readForm();
  if (!data.title) { $('f-title-error').hidden = false; $('f-title').focus(); return; }
  const btn = $('btn-save');
  btn.disabled = true; btn.textContent = 'Kaydediliyor…';
  $('edit-error').hidden = true;
  try {
    const rec = state.editing
      ? await api(`/api/collections/${COLLECTION}/records/${state.editing.id}`, { method: 'PATCH', body: toBody(data) })
      : await api(`/api/collections/${COLLECTION}/records`, { method: 'POST', body: toBody(data) });
    upsertLocal(rec);
    state.current = rec;
    toast('Tarif kaydedildi.');
    renderList();
    if (state.editing) {
      history.back();                       // düzenleme ayrıntıdan açıldı: oraya dön
    } else {
      history.replaceState({ view: 'detail' }, '', '#detail');
      openDetail(rec.id, { push: false });
    }
  } catch (err) {
    showError('edit-error', err.status === 0
      ? 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar kaydet; yazdıkların burada duruyor.'
      : 'Kaydedilemedi: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Tarifi kaydet';
  }
});

$('btn-delete').addEventListener('click', async () => {
  const r = state.editing;
  if (!r) return;
  const ok = await confirmDialog(`“${r.title}” tarifi silinsin mi? Bu geri alınamaz.`, 'Tarifi sil');
  if (!ok) return;
  try {
    await api(`/api/collections/${COLLECTION}/records/${r.id}`, { method: 'DELETE' });
    state.recipes = state.recipes.filter((x) => x.id !== r.id);
    store.set('recipes_cache', state.recipes);
    state.current = null;
    toast('Tarif silindi.');
    history.go(-2);                         // düzenle → ayrıntı → liste
  } catch (err) {
    showError('edit-error', err.status === 0 ? 'Sunucuya ulaşılamadı, tarif silinmedi.' : 'Silinemedi: ' + err.message);
  }
});

/* ---------- Yapay zeka ---------- */

$('btn-ai').addEventListener('click', async () => {
  const raw = $('ai-raw').value.trim();
  $('ai-error').hidden = true;
  if (!raw) { showError('ai-error', 'Önce düzenlenecek tarif metnini yapıştır.'); return; }
  const key = store.get('gemini_key', '');
  if (!key) { showError('ai-error', 'Gemini API anahtarı yok. Ayarlar\'dan ekleyebilir ya da formu elle doldurabilirsin.'); return; }

  const btn = $('btn-ai');
  btn.disabled = true; btn.textContent = 'Düzenleniyor…';
  try {
    const r = await aiFormat(raw, key, store.get('gemini_model', DEFAULT_MODEL));
    const url = (raw.match(/https?:\/\/\S+/) || [''])[0];
    const kapakSecimi = $('f-kapak').files[0];
    fillForm({ ...r, url: $('f-url').value || url });
    if (kapakSecimi) { const dt = new DataTransfer(); dt.items.add(kapakSecimi); $('f-kapak').files = dt.files; $('f-kapak').dispatchEvent(new Event('change')); }
    toast('Tarif düzenlendi. Kontrol edip kaydet.');
    $('f-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showError('ai-error', err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Yapay zekayla düzenle';
  }
});

async function aiFormat(raw, key, model) {
  const prompt = `Sen deneyimli bir şef ve mutfak asistanısın. Aşağıdaki ham tarif metnini düzenle:
- Türkçeye çevir.
- Tüm ölçüleri gram, mililitre, su bardağı, çay bardağı, yemek kaşığı veya tatlı kaşığına dönüştür (ör. "1 su bardağı un (120 g)").
- Kategori şu listeden biri olsun: ${DEFAULT_CATEGORIES.join(', ')}.
- Hazırlanışı kısa adımlar halinde, her adım ayrı satırda yaz (numara koyma).
Yalnızca şu JSON nesnesini döndür:
{"title": "...", "category": "...", "ingredients": ["..."], "instructions": "adım 1\\nadım 2"}

Ham metin:
${raw}`;

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
      }),
    });
  } catch {
    throw new Error('Yapay zekaya ulaşılamadı. İnternet bağlantını kontrol et.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || '';
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Gemini API anahtarı geçersiz. Ayarlar\'dan kontrol et.');
    if (res.status === 404) throw new Error(`"${model}" modeli bulunamadı. Ayarlar'dan model adını değiştir.`);
    if (res.status === 429) throw new Error('Gemini kullanım sınırı doldu. Biraz sonra tekrar dene.');
    throw new Error('Yapay zeka hatası: ' + (msg || res.status));
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return toRecord(parsed);
  } catch {
    throw new Error('Yapay zekanın cevabı okunamadı. Tekrar dene ya da formu elle doldur.');
  }
}

/* ---------- Ayarlar, yedek ---------- */

$('btn-settings').addEventListener('click', () => {
  $('s-key').value = store.get('gemini_key', '');
  $('s-model').value = store.get('gemini_model', DEFAULT_MODEL);
  $('s-account').textContent = `${state.auth?.email || ''} · ${apiBase()}`;
  $('import-status').textContent = '';
  go('settings');
});

$('btn-save-ai').addEventListener('click', () => {
  store.set('gemini_key', $('s-key').value.trim());
  store.set('gemini_model', $('s-model').value.trim() || DEFAULT_MODEL);
  toast('Yapay zeka ayarları kaydedildi.');
});

$('btn-export').addEventListener('click', () => {
  const data = state.recipes.map((r) => ({ ...toRecord(r), created: r.created }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tarifler-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('import-status');
  let items;
  try {
    const json = JSON.parse(await file.text());
    items = (Array.isArray(json) ? json : json.items || json.recipes || []).map(toRecord).filter((r) => r.title);
  } catch {
    status.textContent = 'Dosya okunamadı. Tarif listesi içeren bir JSON dosyası seç.';
    return;
  }
  const existing = new Set(state.recipes.map((r) => trLower(r.title)));
  const fresh = items.filter((r) => !existing.has(trLower(r.title)));
  let done = 0, failed = 0;
  for (const r of fresh) {
    status.textContent = `Aktarılıyor… ${done + failed + 1}/${fresh.length}`;
    try { upsertLocal(await api(`/api/collections/${COLLECTION}/records`, { method: 'POST', body: r })); done++; }
    catch { failed++; }
  }
  const skipped = items.length - fresh.length;
  status.textContent = `${done} tarif aktarıldı` + (skipped ? `, ${skipped} tanesi zaten vardı` : '') +
    (failed ? `, ${failed} tanesi aktarılamadı (bağlantıyı kontrol edip dosyayı tekrar seç)` : '') + '.';
  renderList();
});

$('btn-logout').addEventListener('click', async () => {
  if (await confirmDialog('Bu cihazda çıkış yapılsın mı? Tarifler sunucuda kalır.', 'Çıkış yap')) logout();
});

/* ---------- Giriş ---------- */

$('login-server').value = state.server;
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const pass = $('login-pass').value;
  $('login-error').hidden = true;
  if (!email || !pass) { showError('login-error', 'E-posta ve şifreyi yaz.'); return; }
  state.server = $('login-server').value.trim();
  store.set('server', state.server);
  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Giriş yapılıyor…';
  try {
    await login(email, pass);
    $('login-pass').value = '';
    history.replaceState({ view: 'list' }, '', '#list');
    go('list', { push: false });
    renderList();
    sync();
  } catch (err) {
    showError('login-error', err.status === 400
      ? 'E-posta veya şifre yanlış.'
      : err.status === 0 ? 'Sunucuya ulaşılamadı. Adresi ve internet bağlantını kontrol et.' : err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Giriş yap';
  }
});

/* ---------- Yardımcılar ---------- */

function showError(id, text) { const el = $(id); el.textContent = text; el.hidden = false; }

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function confirmDialog(text, okLabel) {
  const d = $('confirm-dialog');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

/* ---------- Başlat ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (state.auth) {
  history.replaceState({ view: 'list' }, '', '#list');
  go('list', { push: false });
  renderList();
  refreshAuth().then(() => sync({ quiet: state.recipes.length > 0 }));
} else {
  history.replaceState({ view: 'login' }, '', '#login');
  go('login', { push: false });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.auth && !$('view-list').hidden) sync({ quiet: true });
});
