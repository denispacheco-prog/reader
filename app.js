const WATERLINE_KEY = 'reader:waterline';
const THEME_KEY = 'reader:theme';
const VIEW_KEY = 'reader:view';
const CATEGORY_ORDER_KEY = 'reader:categoryOrder';
const REFRESH_INTERVAL_MINUTES = 30;
const POLL_INTERVAL_MS = 120000;
const DASHBOARD_ITEMS_PER_CATEGORY = 8;
const DEFAULT_CATEGORY_ORDER = ['Brasil', 'Mundo', 'Tecnologia', 'Ciência', 'Futurismo', 'Cultura', 'Jogos', 'Ensaios'];

const SOURCE_PALETTE = [
  '#e87ba4',
  '#0891b2',
  '#eda100',
  '#1baf7a',
  '#4a3aa7',
  '#74b9ff',
  '#008300',
  '#2a78d6',
  '#eb6834',
];

function hueFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SOURCE_PALETTE[hash % SOURCE_PALETTE.length];
}

const CATEGORY_COLORS = {
  'Brasil': '#008300',
  'Mundo': '#1baf7a',
  'Tecnologia': '#2a78d6',
  'Ciência': '#0891b2',
  'Futurismo': '#74b9ff',
  'Cultura': '#c2255c',
  'Jogos': '#4a3aa7',
  'Ensaios': '#eb6834',
};

const CATEGORY_ALIASES = {
  'Cultura & Entretenimento': 'Cultura',
};

function canonicalCategory(name) {
  return CATEGORY_ALIASES[name] || name;
}

function categoryColor(name) {
  return CATEGORY_COLORS[canonicalCategory(name)] || hueFor(name);
}

const SHADE_STEPS = [0, 0.22, -0.18, 0.4, -0.32, 0.12];

function shadeColor(hex, ratio) {
  const target = ratio >= 0 ? 255 : 0;
  const amount = Math.abs(ratio);
  const num = parseInt(hex.slice(1), 16);
  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  const mixed = channels.map((c) => Math.round(c + (target - c) * amount));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function sourceColor(name, category) {
  if (!category) return hueFor(name);

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const step = SHADE_STEPS[hash % SHADE_STEPS.length];
  return shadeColor(categoryColor(category), step);
}

const streamEl = document.getElementById('stream');
const closureEl = document.getElementById('ambient-closure');
const searchEl = document.getElementById('search');
const themeToggleEl = document.getElementById('theme-toggle');
const sidebarEl = document.getElementById('sidebar');
const sidebarToggleEl = document.getElementById('sidebar-toggle');
const sidebarListEl = document.getElementById('sidebar-feed-list');
const siteTitleEl = document.querySelector('.site-title');
const backToTopEl = document.getElementById('back-to-top');
const categoryMenuEl = document.getElementById('category-menu');
const viewToggleEl = document.getElementById('view-toggle');

const state = {
  items: [],
  waterlineDate: readWaterline(),
  observer: null,
  initialRenderDone: false,
  sourceFilter: null,
  categoryFilter: null,
  generatedAt: null,
  viewMode: readViewMode(),
  categoryOrder: readCategoryOrder(),
  draggedCategory: null,
};

function readWaterline() {
  const stored = localStorage.getItem(WATERLINE_KEY);
  if (!stored) return null;
  const date = new Date(stored);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readViewMode() {
  return localStorage.getItem(VIEW_KEY) === 'dashboard' ? 'dashboard' : 'river';
}

function readCategoryOrder() {
  try {
    const stored = JSON.parse(localStorage.getItem(CATEGORY_ORDER_KEY));
    return Array.isArray(stored) ? stored.filter((c) => typeof c === 'string') : null;
  } catch (err) {
    return null;
  }
}

function orderCategories(categories) {
  const base = state.categoryOrder && state.categoryOrder.length ? state.categoryOrder : DEFAULT_CATEGORY_ORDER;
  const baseCanonical = base.map(canonicalCategory);
  const known = categories
    .filter((category) => baseCanonical.includes(canonicalCategory(category)))
    .sort((a, b) => baseCanonical.indexOf(canonicalCategory(a)) - baseCanonical.indexOf(canonicalCategory(b)));
  const unknown = categories
    .filter((category) => !baseCanonical.includes(canonicalCategory(category)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  return [...known, ...unknown];
}

function moveCategory(order, category, targetCategory) {
  const next = order.filter((c) => c !== category);
  const targetIndex = next.indexOf(targetCategory);
  next.splice(targetIndex === -1 ? next.length : targetIndex, 0, category);
  return next;
}

function isNew(item) {
  return state.waterlineDate !== null && new Date(item.date) > state.waterlineDate;
}

function filterItems(items, query) {
  let result = state.sourceFilter
    ? items.filter((item) => item.source === state.sourceFilter)
    : items;

  if (state.categoryFilter) {
    result = result.filter((item) => item.category === state.categoryFilter);
  }

  if (query) {
    result = result.filter((item) => {
      const haystack = `${item.title} ${item.source} ${item.category || ''} ${item.summary}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  return result;
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateShort(isoDate) {
  const date = new Date(isoDate);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${day} ${month}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayLabel(isoDate) {
  const date = new Date(isoDate);
  const today = startOfDay(new Date());
  const diffDays = Math.round((today - startOfDay(date)) / 86400000);

  if (diffDays === 0) return 'hoje';
  if (diffDays === 1) return 'ontem';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function renderDateHeading(label) {
  const heading = document.createElement('h3');
  heading.className = 'stream-date-heading';
  heading.textContent = label;
  return heading;
}

function renderWaterlineMarker() {
  const marker = document.createElement('div');
  marker.className = 'waterline-marker';
  marker.textContent = 'lido anteriormente';
  return marker;
}

function renderEmptyMessage() {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = state.items.length === 0
    ? 'nenhum item disponível.'
    : 'nada encontrado para essa busca.';
  return empty;
}

function currentQuery() {
  return searchEl.value.trim().toLowerCase();
}

function render() {
  if (state.viewMode === 'dashboard') {
    renderDashboard(currentQuery());
  } else {
    renderStream(currentQuery());
  }
}

function renderStream(query) {
  const filtered = filterItems(state.items, query);
  const animateEntrance = !state.initialRenderDone;
  streamEl.innerHTML = '';

  if (filtered.length === 0) {
    streamEl.appendChild(renderEmptyMessage());
    disconnectObserver();
    closureEl.classList.remove('is-visible');
    state.initialRenderDone = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastDayLabel = null;
  filtered.forEach((item, index) => {
    const label = dayLabel(item.date);
    if (label !== lastDayLabel) {
      fragment.appendChild(renderDateHeading(label));
      lastDayLabel = label;
    }
    if (index > 0 && isNew(filtered[index - 1]) && !isNew(item)) {
      fragment.appendChild(renderWaterlineMarker());
    }
    fragment.appendChild(renderItem(item, animateEntrance ? index : null));
  });
  streamEl.appendChild(fragment);
  state.initialRenderDone = true;

  if (query) {
    disconnectObserver();
    closureEl.classList.remove('is-visible');
  } else {
    setupAmbientClosure(filtered);
  }
}

function renderDashboard(query) {
  disconnectObserver();
  closureEl.classList.remove('is-visible');

  const filtered = filterItems(state.items, query);
  const animateEntrance = !state.initialRenderDone;
  streamEl.innerHTML = '';
  state.initialRenderDone = true;

  if (filtered.length === 0) {
    streamEl.appendChild(renderEmptyMessage());
    return;
  }

  const groups = new Map();
  filtered.forEach((item) => {
    const category = item.category || 'Outros';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });

  const categories = orderCategories([...groups.keys()]);

  const fragment = document.createDocumentFragment();
  if (categories.length > 1) {
    fragment.appendChild(renderDashboardCover(categories, groups, animateEntrance));
  }
  categories.forEach((category) => {
    fragment.appendChild(renderDashboardSection(category, groups.get(category), animateEntrance));
  });
  streamEl.appendChild(fragment);
}

function renderDashboardCover(categories, groups, animateEntrance) {
  const section = document.createElement('section');
  section.className = 'dashboard-section dashboard-cover-section';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-section-title';
  heading.textContent = 'Capa';

  const grid = document.createElement('div');
  grid.className = 'dashboard-cover';
  const featuredIndex = Math.floor(Math.random() * categories.length);
  categories.forEach((category, index) => {
    const item = groups.get(category)[0];
    if (!item) return;
    grid.appendChild(renderDashboardCard(item, {
      cover: true,
      featured: index === featuredIndex,
      animate: animateEntrance,
      delay: Math.min(index, 8) * 30,
    }));
  });

  section.append(heading, grid);
  return section;
}

function renderDashboardSection(category, items, animateEntrance) {
  const section = document.createElement('section');
  section.className = 'dashboard-section';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-section-title';
  heading.textContent = category;
  heading.style.setProperty('--cat-hue', categoryColor(category));

  const [heroItem, ...restItems] = items.slice(0, DASHBOARD_ITEMS_PER_CATEGORY);
  const hero = renderDashboardCard(heroItem, { hero: true, animate: animateEntrance });

  const grid = document.createElement('div');
  grid.className = 'dashboard-grid';
  restItems.forEach((item, index) => {
    grid.appendChild(renderDashboardCard(item, { animate: animateEntrance, delay: Math.min(index, 8) * 30 }));
  });

  section.append(heading, hero, grid);
  return section;
}

function renderDashboardCard(item, { hero = false, cover = false, featured = false, animate = false, delay = 0 } = {}) {
  const card = document.createElement('article');
  card.className = 'dashboard-card'
    + (hero ? ' dashboard-card--hero' : '')
    + (cover ? ' dashboard-card--cover' : '')
    + (cover && featured ? ' dashboard-card--cover-featured' : '')
    + (isNew(item) ? ' is-new' : '')
    + (animate ? '' : ' no-enter-anim');
  if (animate) card.style.animationDelay = `${delay}ms`;
  card.style.setProperty('--cat-hue', sourceColor(item.source, item.category));
  card.dataset.link = item.link;

  if ((hero || cover) && item.category) {
    const kicker = document.createElement('p');
    kicker.className = 'dashboard-card-kicker';
    kicker.textContent = item.category;
    kicker.style.setProperty('--cat-hue', categoryColor(item.category));
    card.append(kicker);
  }

  const title = document.createElement(hero ? 'h2' : 'h3');
  title.className = 'dashboard-card-title';
  const link = document.createElement('a');
  link.href = item.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.title;
  title.appendChild(link);

  const meta = document.createElement('p');
  meta.className = 'dashboard-card-meta';

  const source = document.createElement('span');
  source.className = 'dashboard-card-source';
  source.textContent = item.source;

  const date = document.createElement('span');
  date.className = 'dashboard-card-date';
  date.textContent = formatDateShort(item.date);

  meta.append(source, date);

  card.append(title, meta);

  if ((hero || cover) && item.summary) {
    const summary = document.createElement('p');
    summary.className = 'dashboard-card-summary';
    summary.textContent = item.summary;
    card.append(summary);
  }

  return card;
}

function renderItem(item, animateIndex) {
  const el = document.createElement('article');
  el.className = 'item' + (isNew(item) ? ' is-new' : '') + (animateIndex === null ? ' no-enter-anim' : '');
  if (animateIndex !== null) {
    el.style.animationDelay = `${Math.min(animateIndex, 8) * 40}ms`;
  }
  el.dataset.link = item.link;

  const meta = document.createElement('p');
  meta.className = 'item-meta';

  const source = document.createElement('span');
  source.className = 'item-source';
  source.textContent = item.source;
  source.style.setProperty('--cat-hue', sourceColor(item.source, item.category));

  meta.append(source);

  if (item.category) {
    const category = document.createElement('span');
    category.className = 'item-category';
    category.textContent = item.category;
    category.style.setProperty('--cat-hue', categoryColor(item.category));
    meta.append(category);
  }

  const date = document.createElement('span');
  date.className = 'item-date';
  date.textContent = formatDate(item.date);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'copy-link-btn';
  copyBtn.title = 'copiar link';
  copyBtn.setAttribute('aria-label', 'copiar link');
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    copyLink(item.link, copyBtn);
  });

  meta.append(date, copyBtn);

  const title = document.createElement('h2');
  title.className = 'item-title';
  const link = document.createElement('a');
  link.href = item.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.title;
  title.appendChild(link);

  const summary = document.createElement('p');
  summary.className = 'item-summary';
  summary.textContent = item.summary;

  el.append(meta, title, summary);
  return el;
}

function copyLink(link, btn) {
  navigator.clipboard.writeText(link).then(() => {
    btn.classList.add('copied');
    btn.textContent = '✓';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '⧉';
    }, 1200);
  }).catch((err) => {
    console.error('[app] falha ao copiar link:', err);
  });
}

function renderSidebar(items) {
  const sourceCategories = new Map();
  items.forEach((item) => {
    if (!sourceCategories.has(item.source)) sourceCategories.set(item.source, item.category);
  });

  const sources = [...sourceCategories.keys()].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
  );

  sidebarListEl.innerHTML = '';

  const allLi = document.createElement('li');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'sidebar-feed-btn sidebar-feed-btn--all' + (state.sourceFilter === null ? ' is-active' : '');
  allBtn.textContent = 'todos os feeds';
  allBtn.addEventListener('click', () => {
    state.sourceFilter = null;
    renderSidebar(state.items);
    render();
  });
  allLi.append(allBtn);
  sidebarListEl.append(allLi);

  sources.forEach((source) => {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-feed-btn' + (state.sourceFilter === source ? ' is-active' : '');
    btn.style.setProperty('--cat-hue', sourceColor(source, sourceCategories.get(source)));

    const dot = document.createElement('span');
    dot.className = 'sidebar-feed-dot';

    const name = document.createElement('span');
    name.className = 'sidebar-feed-name';
    name.textContent = source;

    btn.append(dot, name);
    btn.addEventListener('click', () => {
      state.sourceFilter = state.sourceFilter === source ? null : source;
      renderSidebar(state.items);
      render();
    });

    li.append(btn);
    sidebarListEl.append(li);
  });
}

function renderCategoryMenu(items) {
  const categories = orderCategories([...new Set(items.map((item) => item.category).filter(Boolean))]);
  state.categoryOrder = categories;

  categoryMenuEl.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'category-menu-btn' + (state.categoryFilter === null ? ' is-active' : '');
  allBtn.textContent = 'todas';
  allBtn.addEventListener('click', () => {
    state.categoryFilter = null;
    renderCategoryMenu(state.items);
    render();
  });
  categoryMenuEl.append(allBtn);

  categories.forEach((category) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.draggable = true;
    btn.className = 'category-menu-btn' + (state.categoryFilter === category ? ' is-active' : '');
    btn.textContent = category;
    btn.style.setProperty('--cat-hue', categoryColor(category));
    btn.addEventListener('click', () => {
      state.categoryFilter = state.categoryFilter === category ? null : category;
      renderCategoryMenu(state.items);
      render();
    });

    btn.addEventListener('dragstart', (event) => {
      state.draggedCategory = category;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', category);
      btn.classList.add('is-dragging');
    });
    btn.addEventListener('dragend', () => {
      btn.classList.remove('is-dragging');
      state.draggedCategory = null;
    });
    btn.addEventListener('dragover', (event) => {
      if (!state.draggedCategory || state.draggedCategory === category) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      btn.classList.add('drag-over');
    });
    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drag-over');
    });
    btn.addEventListener('drop', (event) => {
      event.preventDefault();
      btn.classList.remove('drag-over');
      const dragged = state.draggedCategory;
      if (!dragged || dragged === category) return;
      const newOrder = moveCategory(state.categoryOrder, dragged, category);
      state.categoryOrder = newOrder;
      localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(newOrder));
      renderCategoryMenu(state.items);
      render();
    });

    categoryMenuEl.append(btn);
  });
}

function setSidebarOpen(open) {
  sidebarEl.classList.toggle('is-open', open);
  sidebarToggleEl.classList.toggle('is-open', open);
  sidebarEl.setAttribute('aria-hidden', String(!open));
  sidebarToggleEl.setAttribute('aria-expanded', String(open));
}

sidebarToggleEl.addEventListener('click', () => {
  setSidebarOpen(!sidebarEl.classList.contains('is-open'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSidebarOpen(false);
});

document.addEventListener('click', (event) => {
  if (!sidebarEl.classList.contains('is-open')) return;
  if (sidebarEl.contains(event.target) || sidebarToggleEl.contains(event.target)) return;
  setSidebarOpen(false);
});

function disconnectObserver() {
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }
}

function setupAmbientClosure(items) {
  disconnectObserver();

  const newItems = items.filter(isNew);

  if (newItems.length === 0) {
    closureEl.classList.add('is-visible');
    return;
  }

  closureEl.classList.remove('is-visible');
  const lastNew = newItems[newItems.length - 1];
  const targetEl = streamEl.querySelector(`[data-link="${cssEscape(lastNew.link)}"]`);
  if (!targetEl) return;

  state.observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        closureEl.classList.remove('is-visible');
      } else if (entry.boundingClientRect.top < 0) {
        closureEl.classList.add('is-visible');
      }
    },
    { threshold: 0 }
  );
  state.observer.observe(targetEl);
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function saveWaterline() {
  if (state.items.length === 0) return;
  const newest = state.items[0];
  localStorage.setItem(WATERLINE_KEY, newest.date);
}

function updateRefreshStatus() {
  if (!state.generatedAt) return;

  const nextRefresh = new Date(state.generatedAt).getTime() + REFRESH_INTERVAL_MINUTES * 60000;
  const minutesLeft = Math.ceil((nextRefresh - Date.now()) / 60000);

  siteTitleEl.title = minutesLeft > 0
    ? `atualiza em ~${minutesLeft} min`
    : 'atualização a caminho';
}

function captureScrollAnchor() {
  if (window.scrollY <= 0) return null;
  const anchorEl = [...streamEl.querySelectorAll('[data-link]')].find(
    (el) => el.getBoundingClientRect().bottom > 0
  );
  if (!anchorEl) return null;
  return { link: anchorEl.dataset.link, offset: anchorEl.getBoundingClientRect().top };
}

function restoreScrollAnchor(anchor) {
  if (!anchor) return;
  const el = streamEl.querySelector(`[data-link="${cssEscape(anchor.link)}"]`);
  if (!el) return;
  window.scrollBy(0, el.getBoundingClientRect().top - anchor.offset);
}

function applyReaderData(data) {
  const anchor = captureScrollAnchor();
  state.items = data.items || [];
  state.generatedAt = data.generatedAt || null;
  renderSidebar(state.items);
  renderCategoryMenu(state.items);
  render();
  updateRefreshStatus();
  restoreScrollAnchor(anchor);
}

async function checkForUpdates() {
  try {
    const response = await fetch('reader.json', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (data.generatedAt && data.generatedAt === state.generatedAt) return;
    applyReaderData(data);
  } catch (err) {
    console.error('[app] falha ao verificar atualização:', err);
  }
}

async function loadReader() {
  try {
    const response = await fetch('reader.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    applyReaderData(data);
    setInterval(updateRefreshStatus, 60000);
    setInterval(checkForUpdates, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdates();
    });
  } catch (err) {
    streamEl.innerHTML = '';
    const error = document.createElement('p');
    error.className = 'empty';
    error.textContent = 'não foi possível carregar o Reader. rode "node scripts/build.js" e sirva a pasta com um servidor estático.';
    streamEl.appendChild(error);
    console.error('[app] falha ao carregar reader.json:', err);
  }
}

function getEffectiveTheme() {
  return (
    document.documentElement.dataset.theme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function updateThemeToggleButton(theme) {
  themeToggleEl.textContent = theme === 'dark' ? '☀' : '☾';
  const label = theme === 'dark' ? 'mudar para tema claro' : 'mudar para tema escuro';
  themeToggleEl.setAttribute('aria-label', label);
  themeToggleEl.title = label;

  const themeColorMeta = document.getElementById('theme-color-meta');
  if (themeColorMeta) themeColorMeta.setAttribute('content', theme === 'dark' ? '#221f1c' : '#faf9f6');
}

function toggleTheme() {
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  updateThemeToggleButton(next);
}

updateThemeToggleButton(getEffectiveTheme());
themeToggleEl.addEventListener('click', toggleTheme);

function updateViewToggleButton(mode) {
  viewToggleEl.classList.toggle('is-active', mode === 'dashboard');
  const label = mode === 'dashboard' ? 'voltar ao modo lista' : 'alternar para modo mosaico';
  viewToggleEl.setAttribute('aria-label', label);
  viewToggleEl.setAttribute('aria-pressed', String(mode === 'dashboard'));
  viewToggleEl.title = label;
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.documentElement.dataset.view = mode;
  localStorage.setItem(VIEW_KEY, mode);
  updateViewToggleButton(mode);
  render();
}

updateViewToggleButton(state.viewMode);
viewToggleEl.addEventListener('click', () => {
  setViewMode(state.viewMode === 'dashboard' ? 'river' : 'dashboard');
});

searchEl.addEventListener('input', () => {
  render();
});

backToTopEl.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', () => {
  backToTopEl.classList.toggle('is-visible', window.scrollY > 600);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveWaterline();
});
window.addEventListener('pagehide', saveWaterline);

loadReader();
