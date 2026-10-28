const THEME_KEY = 'reader:theme';
const SAVED_KEY = 'reader:saved';
const COLUMNS_KEY = 'reader:columns';
const SEEN_KEY = 'reader:seenCutoff';
const LEGACY_WATERLINE_KEY = 'reader:waterline';
const LEGACY_CATEGORY_ORDER_KEY = 'reader:categoryOrder';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 50;
const LOAD_MORE_THRESHOLD_PX = 600;
const ADDED_CATEGORIES_KEY = 'reader:addedCategories';
const DEFAULT_CATEGORY_ORDER = ['Brasil', 'São Paulo', 'Mundo', 'Tecnologia', 'Ciência', 'Futurismo', 'Cultura', 'Jogos', 'Ensaios'];

// Categories introduced after the deck launched. Decks that already have
// saved columns get each one inserted once (after `after`); removing the
// column afterwards sticks.
const ADDED_CATEGORIES = [
  { category: 'São Paulo', after: 'Brasil' },
];

const SOURCE_PALETTE = [
  '#f5a6c8',
  '#8ad8d3',
  '#f3d27e',
  '#8fd19e',
  '#d1a6ec',
  '#94bdf5',
  '#f4a09c',
  '#b9b3f6',
  '#f7bc8c',
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hueFor(name) {
  return SOURCE_PALETTE[hashString(name) % SOURCE_PALETTE.length];
}

// Pastel tones, one distinct hue per category; avatars use dark initials.
const CATEGORY_COLORS = {
  'Brasil': '#8fd19e',
  'São Paulo': '#b8c2cf',
  'Mundo': '#f4a09c',
  'Ásia': '#f3d27e',
  'Tecnologia': '#94bdf5',
  'Ciência': '#8ad8d3',
  'Futurismo': '#b9b3f6',
  'Cultura': '#f5a6c8',
  'Jogos': '#d1a6ec',
  'Ensaios': '#f7bc8c',
};

// Neutral glyphs that identify category columns (header + rail). ︎ asks
// for the text presentation so they stay gray instead of becoming emoji.
const CATEGORY_SYMBOLS = {
  'Brasil': '⚑︎',
  'São Paulo': '⌂',
  'Mundo': '◎',
  'Ásia': '◑',
  'Tecnologia': '⌘',
  'Ciência': '⚛︎',
  'Futurismo': '✦',
  'Cultura': '♫︎',
  'Jogos': '♟︎',
  'Ensaios': '¶',
};

function categorySymbol(name) {
  return CATEGORY_SYMBOLS[canonicalCategory(name)] || '◆';
}

const CATEGORY_ALIASES = {
  'Cultura & Entretenimento': 'Cultura',
};

function canonicalCategory(name) {
  return CATEGORY_ALIASES[name] || name;
}

function categoryColor(name) {
  return CATEGORY_COLORS[canonicalCategory(name)] || hueFor(name);
}

const SHADE_STEPS = [0, 0.14, -0.1, 0.24, -0.18, 0.07];

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

  const step = SHADE_STEPS[hashString(name) % SHADE_STEPS.length];
  return shadeColor(categoryColor(category), step);
}

function sourceInitial(name) {
  const match = name.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : '•';
}

const deckEl = document.getElementById('deck');
const addColumnEl = document.getElementById('add-column');
const searchToggleEl = document.getElementById('search-toggle');
const searchPopEl = document.getElementById('search-pop');
const searchEl = document.getElementById('search');
const refreshEl = document.getElementById('refresh');
const refreshStatusEl = document.getElementById('refresh-status');
const themeToggleEl = document.getElementById('theme-toggle');
const addDialogEl = document.getElementById('add-dialog');
const addDialogCloseEl = document.getElementById('add-dialog-close');
const addPanelEl = document.getElementById('add-panel');
const railColumnsEl = document.getElementById('rail-columns');
const compactLayout = window.matchMedia('(max-width: 640px)');

const state = {
  items: [],
  feeds: [],
  generatedAt: null,
  columns: readColumns(),
  saved: readSaved(),
  seenCutoff: readSeenCutoff(),
  query: '',
  views: new Map(),
  addTab: 'category',
  draggedColumnId: null,
  visibilityObserver: null,
};

// --- storage ---------------------------------------------------------------

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.error('[app] falha ao salvar no navegador:', err);
  }
}

function readJson(key) {
  try {
    return JSON.parse(storageGet(key));
  } catch (err) {
    return null;
  }
}

function readColumns() {
  const stored = readJson(COLUMNS_KEY);
  if (!Array.isArray(stored)) return null;
  return stored
    .filter((col) => col && typeof col.type === 'string')
    .map((col) => ({ ...col, id: columnId(col) }));
}

function saveColumns() {
  storageSet(COLUMNS_KEY, JSON.stringify(state.columns));
}

function readSaved() {
  const stored = readJson(SAVED_KEY);
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

function readSeenCutoff() {
  const stored = storageGet(SEEN_KEY) || storageGet(LEGACY_WATERLINE_KEY);
  if (!stored) return null;
  const date = new Date(stored);
  return Number.isNaN(date.getTime()) ? null : date;
}

function saveSeenCutoff() {
  const newest = state.items[0];
  if (!newest) return;
  storageSet(SEEN_KEY, newest.date);
}

// --- saved -----------------------------------------------------------------

function isSaved(link) {
  return Object.prototype.hasOwnProperty.call(state.saved, link);
}

function toggleSaved(item) {
  if (isSaved(item.link)) {
    delete state.saved[item.link];
  } else {
    state.saved[item.link] = {
      title: item.title,
      link: item.link,
      source: item.source,
      category: item.category,
      date: item.date,
      summary: item.summary,
    };
  }
  storageSet(SAVED_KEY, JSON.stringify(state.saved));
}

function getSavedItemsSorted() {
  return Object.values(state.saved).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function findItem(link) {
  return state.items.find((item) => item.link === link) || state.saved[link] || null;
}

// --- columns ---------------------------------------------------------------

function columnId(col) {
  return `${col.type}:${col.value || ''}`;
}

function makeColumn(type, value) {
  const col = value ? { type, value } : { type };
  col.id = columnId(col);
  return col;
}

function availableCategories() {
  const categories = new Set();
  state.feeds.forEach((feed) => {
    if (feed.category) categories.add(feed.category);
  });
  state.items.forEach((item) => {
    if (item.category) categories.add(item.category);
  });
  return [...categories];
}

function orderCategories(categories, order) {
  const baseCanonical = order.map(canonicalCategory);
  const known = categories
    .filter((category) => baseCanonical.includes(canonicalCategory(category)))
    .sort((a, b) => baseCanonical.indexOf(canonicalCategory(a)) - baseCanonical.indexOf(canonicalCategory(b)));
  const unknown = categories
    .filter((category) => !baseCanonical.includes(canonicalCategory(category)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  return [...known, ...unknown];
}

function defaultColumns() {
  const legacyOrder = readJson(LEGACY_CATEGORY_ORDER_KEY);
  const order = Array.isArray(legacyOrder) && legacyOrder.length ? legacyOrder : DEFAULT_CATEGORY_ORDER;
  const categories = orderCategories(availableCategories(), order);
  return [...categories.map((category) => makeColumn('category', category)), makeColumn('saved')];
}

function applyAddedCategories() {
  const stored = readJson(ADDED_CATEGORIES_KEY);
  const applied = new Set(Array.isArray(stored) ? stored : []);
  const available = availableCategories();
  let changed = false;

  ADDED_CATEGORIES.forEach(({ category, after }) => {
    if (applied.has(category) || !available.includes(category)) return;
    applied.add(category);
    const col = makeColumn('category', category);
    if (state.columns.some((c) => c.id === col.id)) return;
    const anchor = state.columns.findIndex((c) => c.type === 'category' && c.value === after);
    state.columns.splice(anchor === -1 ? 0 : anchor + 1, 0, col);
    changed = true;
  });

  storageSet(ADDED_CATEGORIES_KEY, JSON.stringify([...applied]));
  if (changed) saveColumns();
}

function matchesQuery(item, query) {
  const haystack = `${item.title} ${item.source} ${item.category || ''} ${item.summary}`.toLowerCase();
  return haystack.includes(query);
}

function itemsForColumn(col) {
  let items;
  switch (col.type) {
    case 'saved':
      items = getSavedItemsSorted();
      break;
    case 'category':
      items = state.items.filter((item) => canonicalCategory(item.category) === canonicalCategory(col.value));
      break;
    case 'feed':
      items = state.items.filter((item) => item.source === col.value);
      break;
    case 'search': {
      const term = col.value.toLowerCase();
      items = state.items.filter((item) => matchesQuery(item, term));
      break;
    }
    default:
      items = state.items;
  }

  return state.query ? items.filter((item) => matchesQuery(item, state.query)) : items;
}

function feedCategory(source) {
  const feed = state.feeds.find((f) => f.title === source);
  if (feed) return feed.category;
  const item = state.items.find((i) => i.source === source);
  return item ? item.category : null;
}

function columnInfo(col) {
  switch (col.type) {
    case 'category':
      return { title: col.value, subtitle: 'categoria', icon: categorySymbol(col.value) };
    case 'feed': {
      const category = feedCategory(col.value);
      return {
        title: col.value,
        subtitle: category ? `fonte · ${category}` : 'fonte',
        icon: sourceInitial(col.value),
        round: true,
      };
    }
    case 'search':
      return { title: `“${col.value}”`, subtitle: 'busca', icon: '⌕' };
    case 'saved':
      return { title: 'Salvos', subtitle: 'itens salvos', icon: '★' };
    default:
      return { title: 'Tudo', subtitle: 'todas as fontes', icon: '≡' };
  }
}

function emptyMessage(col) {
  if (state.query) return 'nada com essa busca nesta coluna.';
  if (col.type === 'saved') return 'nenhum item salvo ainda. use ☆ nos cards para guardar.';
  return 'nada por aqui nos últimos dias.';
}

function addColumn(type, value) {
  const col = makeColumn(type, value);
  const existing = state.views.get(col.id);
  if (existing) {
    focusColumn(existing);
    return;
  }
  state.columns.push(col);
  saveColumns();
  renderDeck();
  focusColumn(state.views.get(col.id));
}

function removeColumn(id) {
  state.columns = state.columns.filter((col) => col.id !== id);
  saveColumns();
  renderDeck();
}

function moveColumn(id, delta) {
  const index = state.columns.findIndex((col) => col.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= state.columns.length) return;
  const [col] = state.columns.splice(index, 1);
  state.columns.splice(target, 0, col);
  saveColumns();
  renderDeck();
  focusColumn(state.views.get(id));
}

function moveColumnBefore(id, beforeId) {
  if (id === beforeId) return;
  const index = state.columns.findIndex((col) => col.id === id);
  if (index === -1) return;
  const [col] = state.columns.splice(index, 1);
  const target = beforeId ? state.columns.findIndex((c) => c.id === beforeId) : -1;
  state.columns.splice(target === -1 ? state.columns.length : target, 0, col);
  saveColumns();
  renderDeck();
  focusColumn(state.views.get(id));
}

function markColumnSeen(id) {
  const col = state.columns.find((c) => c.id === id);
  if (!col) return;
  col.seenAt = new Date().toISOString();
  saveColumns();
  const view = state.views.get(id);
  if (view) {
    view.col = col;
    view.cardByLink.forEach((card) => card.classList.remove('is-unseen'));
    view.hasUnseen = false;
    updateRailItem(view);
  }
}

function focusColumn(view) {
  if (!view) return;
  view.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  view.el.classList.remove('is-flash');
  void view.el.offsetWidth;
  view.el.classList.add('is-flash');
}

// --- rendering -------------------------------------------------------------

function isUnseen(item, col) {
  const cutoffs = [state.seenCutoff, col.seenAt ? new Date(col.seenAt) : null].filter(Boolean);
  if (cutoffs.length === 0) return false;
  const cutoff = Math.max(...cutoffs.map((d) => d.getTime()));
  return new Date(item.date).getTime() > cutoff;
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(isoDate) {
  const minutes = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  const date = new Date(isoDate);
  return `${String(date.getDate()).padStart(2, '0')} ${date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderColumnIcon(info) {
  const icon = el('span', 'column-icon', info.icon);
  if (info.color) {
    icon.style.background = info.color;
    icon.classList.add('has-color');
  }
  if (info.round) icon.classList.add('is-round');
  return icon;
}

function renderCard(item, col) {
  const card = el('article', 'card');
  card.dataset.link = item.link;
  if (isUnseen(item, col)) card.classList.add('is-unseen');

  const avatar = el('span', 'card-avatar', sourceInitial(item.source));
  avatar.style.background = sourceColor(item.source, item.category);
  avatar.setAttribute('aria-hidden', 'true');

  const main = el('div', 'card-main');

  const meta = el('div', 'card-meta');
  const source = el('button', 'card-source', item.source);
  source.type = 'button';
  source.title = `abrir coluna de ${item.source}`;
  const time = el('time', 'card-time', relativeTime(item.date));
  time.dateTime = item.date;
  time.title = formatDate(item.date);
  meta.append(source, el('span', 'card-dot', '·'), time);

  const title = el('a', 'card-title', item.title);
  title.href = item.link;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';

  main.append(meta, title);

  if (item.summary) {
    main.append(el('p', 'card-summary', item.summary));
  }

  const actions = el('div', 'card-actions');
  const save = el('button', 'card-action card-save');
  save.type = 'button';
  updateSaveButton(save, isSaved(item.link));
  const copy = el('button', 'card-action card-copy', '⧉');
  copy.type = 'button';
  copy.title = 'copiar link';
  copy.setAttribute('aria-label', 'copiar link');
  actions.append(save, copy);
  main.append(actions);

  card.append(avatar, main);
  return card;
}

function updateSaveButton(btn, saved) {
  btn.textContent = saved ? '★' : '☆';
  btn.classList.toggle('is-active', saved);
  const label = saved ? 'remover dos salvos' : 'salvar';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function createColumnView(col) {
  const info = columnInfo(col);
  const section = el('section', 'column');
  section.dataset.columnId = col.id;
  section.setAttribute('aria-label', info.title);

  const header = el('header', 'column-header');
  const heading = el('div', 'column-heading');
  const titleEl = el('h2', 'column-title', info.title);
  titleEl.title = info.title;
  const subtitleEl = el('span', 'column-subtitle', info.subtitle);
  heading.append(titleEl, subtitleEl);

  const menuBtn = el('button', 'icon-btn column-menu-btn', '⋯');
  menuBtn.type = 'button';
  menuBtn.title = 'opções da coluna';
  menuBtn.setAttribute('aria-label', 'opções da coluna');
  menuBtn.setAttribute('aria-expanded', 'false');

  const menu = el('div', 'column-menu');
  menu.hidden = true;
  const menuActions = [
    ['left', '← mover para a esquerda'],
    ['right', 'mover para a direita →'],
    ['seen', 'marcar como visto'],
    ['top', 'voltar ao topo'],
    ['remove', 'remover coluna'],
  ];
  menuActions.forEach(([action, label]) => {
    const btn = el('button', 'column-menu-item', label);
    btn.type = 'button';
    btn.dataset.action = action;
    if (action === 'remove') btn.classList.add('is-danger');
    menu.append(btn);
  });

  header.append(renderColumnIcon(info), heading, menuBtn, menu);

  const pill = el('button', 'new-pill');
  pill.type = 'button';
  pill.hidden = true;

  const body = el('div', 'column-body');
  const list = el('div', 'column-list');
  const footer = el('div', 'column-footer');
  body.append(list, footer);

  section.append(header, pill, body);

  const view = {
    col,
    el: section,
    bodyEl: body,
    listEl: list,
    footerEl: footer,
    subtitleEl,
    menuEl: menu,
    menuBtn,
    pillEl: pill,
    baseSubtitle: info.subtitle,
    items: [],
    limit: PAGE_SIZE,
    knownLinks: new Set(),
    cardByLink: new Map(),
    pendingNew: 0,
  };

  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(view, menu.hidden);
  });

  menu.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    setMenuOpen(view, false);
    const action = btn.dataset.action;
    if (action === 'left') moveColumn(col.id, -1);
    else if (action === 'right') moveColumn(col.id, 1);
    else if (action === 'seen') markColumnSeen(col.id);
    else if (action === 'top') scrollColumnToTop(view);
    else if (action === 'remove') removeColumn(col.id);
  });

  pill.addEventListener('click', () => scrollColumnToTop(view));

  body.addEventListener('scroll', () => onColumnScroll(view), { passive: true });

  return view;
}

function setMenuOpen(view, open) {
  closeAllMenus(view);
  view.menuEl.hidden = !open;
  view.menuBtn.setAttribute('aria-expanded', String(open));
}

function closeAllMenus(except) {
  state.views.forEach((view) => {
    if (view === except) return;
    view.menuEl.hidden = true;
    view.menuBtn.setAttribute('aria-expanded', 'false');
  });
}

function scrollColumnToTop(view) {
  view.bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
}

function onColumnScroll(view) {
  const body = view.bodyEl;
  if (body.scrollTop < 8 && view.pendingNew > 0) {
    view.pendingNew = 0;
    updatePill(view);
  }
  if (
    view.limit < view.items.length &&
    body.scrollTop + body.clientHeight > body.scrollHeight - LOAD_MORE_THRESHOLD_PX
  ) {
    appendNextPage(view);
  }
}

function appendNextPage(view) {
  const next = view.items.slice(view.limit, view.limit + PAGE_SIZE);
  view.limit += next.length;
  const fragment = document.createDocumentFragment();
  next.forEach((item) => {
    const card = renderCard(item, view.col);
    view.cardByLink.set(item.link, card);
    fragment.append(card);
  });
  view.listEl.append(fragment);
  updateFooter(view);
}

function updateFooter(view) {
  view.footerEl.textContent = '';
  if (view.items.length === 0) {
    view.footerEl.append(el('p', 'column-empty', emptyMessage(view.col)));
  } else if (view.limit >= view.items.length) {
    view.footerEl.append(el('p', 'column-end', 'fim da coluna'));
  }
}

function updatePill(view) {
  view.pillEl.hidden = view.pendingNew === 0;
  view.pillEl.textContent = `↑ ${view.pendingNew} ${view.pendingNew === 1 ? 'novo' : 'novos'}`;
}

function captureColumnAnchor(view) {
  const body = view.bodyEl;
  if (body.scrollTop < 8) return null;
  for (const card of view.listEl.children) {
    if (card.offsetTop + card.offsetHeight > body.scrollTop) {
      return { link: card.dataset.link, offset: card.offsetTop - body.scrollTop };
    }
  }
  return null;
}

function renderColumnBody(view, { fromUpdate = false } = {}) {
  const items = itemsForColumn(view.col);
  const anchor = fromUpdate ? captureColumnAnchor(view) : null;

  let newCount = 0;
  if (fromUpdate && view.knownLinks.size > 0) {
    newCount = items.filter((item) => !view.knownLinks.has(item.link)).length;
  }

  if (!fromUpdate) view.limit = PAGE_SIZE;
  else view.limit = Math.max(PAGE_SIZE, view.limit + newCount);

  view.items = items;
  view.knownLinks = new Set(items.map((item) => item.link));
  view.cardByLink = new Map();

  const fragment = document.createDocumentFragment();
  items.slice(0, view.limit).forEach((item) => {
    const card = renderCard(item, view.col);
    view.cardByLink.set(item.link, card);
    fragment.append(card);
  });
  view.listEl.replaceChildren(fragment);
  updateFooter(view);

  view.subtitleEl.textContent = `${view.baseSubtitle} · ${items.length}`;
  view.hasUnseen = items.some((item) => isUnseen(item, view.col));
  updateRailItem(view);

  if (anchor) {
    const card = view.cardByLink.get(anchor.link);
    if (card) view.bodyEl.scrollTop = card.offsetTop - anchor.offset;
    view.pendingNew += newCount;
  } else if (!fromUpdate) {
    view.bodyEl.scrollTop = 0;
    view.pendingNew = 0;
  }
  updatePill(view);
}

function renderDeck() {
  if (!state.columns) state.columns = defaultColumns();
  applyAddedCategories();

  const previous = state.views;
  state.views = new Map();
  const nodes = [];

  state.columns.forEach((col) => {
    let view = previous.get(col.id);
    if (view) {
      view.col = col;
    } else {
      view = createColumnView(col);
      renderColumnBody(view);
    }
    state.views.set(col.id, view);
    nodes.push(view.el);
  });

  if (nodes.length === 0) {
    const empty = el('div', 'deck-empty');
    empty.append(el('p', null, 'nenhuma coluna no deck.'));
    const btn = el('button', 'deck-empty-btn', '＋ adicionar coluna');
    btn.type = 'button';
    btn.addEventListener('click', openAddDialog);
    empty.append(btn);
    nodes.push(empty);
  }

  deckEl.replaceChildren(...nodes);
  renderRailColumns();
  observeColumnVisibility();
}

// --- rail column list ------------------------------------------------------

function renderRailColumns() {
  const nodes = state.columns.map((col) => {
    const view = state.views.get(col.id);
    const info = columnInfo(col);
    const item = el('button', 'rail-col');
    item.type = 'button';
    item.draggable = true;
    item.dataset.columnId = col.id;
    item.setAttribute('role', 'listitem');
    item.title = `${info.title} — clique para ir, arraste para reordenar`;
    item.setAttribute('aria-label', info.title);
    item.append(renderColumnIcon(info), el('span', 'rail-col-dot'));
    view.railEl = item;
    updateRailItem(view);
    return item;
  });
  railColumnsEl.replaceChildren(...nodes);
}

function updateRailItem(view) {
  if (!view.railEl) return;
  view.railEl.classList.toggle('has-unseen', Boolean(view.hasUnseen));
}

function observeColumnVisibility() {
  if (state.visibilityObserver) state.visibilityObserver.disconnect();
  state.visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const view = state.views.get(entry.target.dataset.columnId);
      if (view && view.railEl) view.railEl.classList.toggle('is-in-view', entry.isIntersecting);
    });
  }, { root: deckEl, threshold: 0.6 });
  state.views.forEach((view) => state.visibilityObserver.observe(view.el));
}

function clearDropMarkers() {
  railColumnsEl.querySelectorAll('.drop-before, .drop-after').forEach((node) => {
    node.classList.remove('drop-before', 'drop-after');
  });
}

// Returns the rail item the dragged column should land before (null = end),
// based on which half of the hovered item the pointer is over.
function railDropTarget(event) {
  const horizontal = compactLayout.matches;
  const items = [...railColumnsEl.querySelectorAll('.rail-col')];
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if ((horizontal ? event.clientX : event.clientY) < middle) return item;
  }
  return null;
}

railColumnsEl.addEventListener('click', (event) => {
  const item = event.target.closest('.rail-col');
  if (item) focusColumn(state.views.get(item.dataset.columnId));
});

railColumnsEl.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.rail-col');
  if (!item) return;
  state.draggedColumnId = item.dataset.columnId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', item.dataset.columnId);
  requestAnimationFrame(() => item.classList.add('is-dragging'));
});

railColumnsEl.addEventListener('dragover', (event) => {
  if (!state.draggedColumnId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearDropMarkers();
  const target = railDropTarget(event);
  if (target) {
    target.classList.add('drop-before');
  } else if (railColumnsEl.lastElementChild) {
    railColumnsEl.lastElementChild.classList.add('drop-after');
  }
});

railColumnsEl.addEventListener('dragleave', (event) => {
  if (!railColumnsEl.contains(event.relatedTarget)) clearDropMarkers();
});

railColumnsEl.addEventListener('drop', (event) => {
  if (!state.draggedColumnId) return;
  event.preventDefault();
  const target = railDropTarget(event);
  const id = state.draggedColumnId;
  state.draggedColumnId = null;
  clearDropMarkers();
  moveColumnBefore(id, target ? target.dataset.columnId : null);
});

railColumnsEl.addEventListener('dragend', () => {
  state.draggedColumnId = null;
  clearDropMarkers();
  railColumnsEl.querySelectorAll('.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
});

function refreshAllColumns({ fromUpdate = false } = {}) {
  state.views.forEach((view) => renderColumnBody(view, { fromUpdate }));
}

function refreshSavedColumns() {
  state.views.forEach((view) => {
    if (view.col.type === 'saved') renderColumnBody(view, { fromUpdate: true });
  });
}

function syncSaveButtons(link) {
  const saved = isSaved(link);
  state.views.forEach((view) => {
    const card = view.cardByLink.get(link);
    if (card) updateSaveButton(card.querySelector('.card-save'), saved);
  });
}

function updateRelativeTimes() {
  deckEl.querySelectorAll('time.card-time').forEach((time) => {
    time.textContent = relativeTime(time.dateTime);
  });
}

// --- deck interactions -----------------------------------------------------

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

deckEl.addEventListener('click', (event) => {
  const card = event.target.closest('.card');
  if (!card) return;
  const link = card.dataset.link;

  if (event.target.closest('.card-save')) {
    const item = findItem(link);
    if (!item) return;
    toggleSaved(item);
    syncSaveButtons(link);
    refreshSavedColumns();
    return;
  }

  if (event.target.closest('.card-copy')) {
    copyLink(link, event.target.closest('.card-copy'));
    return;
  }

  const source = event.target.closest('.card-source');
  if (source) {
    addColumn('feed', source.textContent);
    return;
  }

  if (event.target.closest('a')) return;
  if (window.getSelection().toString()) return;
  window.open(link, '_blank', 'noopener,noreferrer');
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.column-menu, .column-menu-btn')) closeAllMenus();
  if (!searchPopEl.hidden && !event.target.closest('#search-pop, #search-toggle')) {
    if (!state.query) setSearchOpen(false);
  }
});

// --- search ----------------------------------------------------------------

function setSearchOpen(open) {
  searchPopEl.hidden = !open;
  searchToggleEl.setAttribute('aria-expanded', String(open));
  searchToggleEl.classList.toggle('is-active', open || Boolean(state.query));
  if (open) searchEl.focus();
}

let searchDebounce = null;
searchEl.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.query = searchEl.value.trim().toLowerCase();
    searchToggleEl.classList.toggle('is-active', true);
    refreshAllColumns();
  }, 150);
});

searchEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    searchEl.value = '';
    state.query = '';
    refreshAllColumns();
    setSearchOpen(false);
    searchToggleEl.focus();
  }
});

searchToggleEl.addEventListener('click', () => setSearchOpen(searchPopEl.hidden));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAllMenus();
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || addDialogEl.open) return;
  event.preventDefault();
  setSearchOpen(true);
});

// --- add column dialog -----------------------------------------------------

function hasColumn(type, value) {
  return state.views.has(columnId(value ? { type, value } : { type }));
}

function addOptionButton({ label, detail, color, icon, round, type, value }) {
  const btn = el('button', 'add-option');
  btn.type = 'button';
  const iconEl = el('span', 'column-icon', icon);
  if (color) {
    iconEl.style.background = color;
    iconEl.classList.add('has-color');
  }
  if (round) iconEl.classList.add('is-round');
  const text = el('span', 'add-option-text');
  text.append(el('span', 'add-option-label', label));
  if (detail) text.append(el('span', 'add-option-detail', detail));
  btn.append(iconEl, text);

  if (hasColumn(type, value)) {
    btn.classList.add('is-present');
    btn.append(el('span', 'add-option-badge', 'no deck'));
  }

  btn.addEventListener('click', () => {
    addDialogEl.close();
    addColumn(type, value);
  });
  return btn;
}

function feedsForPicker() {
  if (state.feeds.length) return state.feeds;
  const seen = new Map();
  state.items.forEach((item) => {
    if (!seen.has(item.source)) seen.set(item.source, { title: item.source, category: item.category });
  });
  return [...seen.values()];
}

function renderAddPanel() {
  addDialogEl.querySelectorAll('.add-tab').forEach((tab) => {
    const active = tab.dataset.tab === state.addTab;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  addPanelEl.replaceChildren();

  if (state.addTab === 'category') {
    const counts = new Map();
    feedsForPicker().forEach((feed) => {
      if (feed.category) counts.set(feed.category, (counts.get(feed.category) || 0) + 1);
    });
    const grid = el('div', 'add-grid');
    orderCategories(availableCategories(), DEFAULT_CATEGORY_ORDER).forEach((category) => {
      const n = counts.get(category) || 0;
      grid.append(addOptionButton({
        label: category,
        detail: `${n} ${n === 1 ? 'fonte' : 'fontes'}`,
        icon: categorySymbol(category),
        type: 'category',
        value: category,
      }));
    });
    addPanelEl.append(grid);
    return;
  }

  if (state.addTab === 'feed') {
    const filter = el('input', 'add-input');
    filter.type = 'search';
    filter.placeholder = 'Filtrar fontes...';
    filter.autocomplete = 'off';
    const list = el('div', 'add-list');
    const feeds = [...feedsForPicker()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' }));

    const renderList = () => {
      const term = filter.value.trim().toLowerCase();
      list.replaceChildren(
        ...feeds
          .filter((feed) => !term || `${feed.title} ${feed.category || ''}`.toLowerCase().includes(term))
          .map((feed) => addOptionButton({
            label: feed.title,
            detail: feed.category,
            icon: sourceInitial(feed.title),
            round: true,
            type: 'feed',
            value: feed.title,
          })),
      );
      if (!list.children.length) list.append(el('p', 'column-empty', 'nenhuma fonte encontrada.'));
    };

    filter.addEventListener('input', renderList);
    renderList();
    addPanelEl.append(filter, list);
    filter.focus();
    return;
  }

  if (state.addTab === 'search') {
    const row = el('div', 'add-search-row');
    const input = el('input', 'add-input');
    input.type = 'text';
    input.placeholder = 'Termo, ex.: eleições, nintendo, IA...';
    input.autocomplete = 'off';
    const submit = el('button', 'add-submit', 'Adicionar');
    submit.type = 'button';
    const commit = () => {
      const term = input.value.trim();
      if (!term) {
        input.focus();
        return;
      }
      addDialogEl.close();
      addColumn('search', term);
    };
    submit.addEventListener('click', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    row.append(input, submit);
    addPanelEl.append(
      row,
      el('p', 'add-hint', 'A coluna mostra os itens de todas as fontes cujo título, fonte ou resumo contém o termo.'),
    );
    input.focus();
    return;
  }

  const grid = el('div', 'add-grid');
  grid.append(
    addOptionButton({ label: 'Tudo', detail: 'todas as fontes juntas', icon: '≡', type: 'all' }),
    addOptionButton({ label: 'Salvos', detail: 'itens marcados com ☆', icon: '★', type: 'saved' }),
  );
  addPanelEl.append(grid);
}

function openAddDialog() {
  renderAddPanel();
  addDialogEl.showModal();
}

addDialogEl.querySelectorAll('.add-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.addTab = tab.dataset.tab;
    renderAddPanel();
  });
});

addDialogCloseEl.addEventListener('click', () => addDialogEl.close());
addDialogEl.addEventListener('click', (event) => {
  if (event.target === addDialogEl) addDialogEl.close();
});
addColumnEl.addEventListener('click', openAddDialog);

// --- data ------------------------------------------------------------------

function updateRefreshStatus() {
  if (!state.generatedAt) {
    refreshStatusEl.textContent = '';
    return;
  }
  const label = relativeTime(state.generatedAt);
  refreshStatusEl.textContent = label;
  const full = `atualizado ${label === 'agora' ? 'agora' : `há ${label}`} (${formatDate(state.generatedAt)})`;
  refreshStatusEl.title = full;
  refreshEl.title = `atualizar agora — ${full}`;
}

function applyReaderData(data, { initial = false } = {}) {
  state.items = data.items || [];
  state.feeds = data.feeds || [];
  state.generatedAt = data.generatedAt || null;

  if (state.seenCutoff === null && state.items[0]) {
    state.seenCutoff = new Date(state.items[0].date);
    saveSeenCutoff();
  }

  if (initial) {
    renderDeck();
  } else {
    refreshAllColumns({ fromUpdate: true });
  }
  updateRefreshStatus();
}

let fetching = false;

async function checkForUpdates({ manual = false } = {}) {
  if (fetching) return;
  fetching = true;
  refreshEl.classList.add('is-spinning');
  try {
    const response = await fetch('reader.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.generatedAt && data.generatedAt === state.generatedAt) {
      if (manual) flashStatus('sem novidades');
      return;
    }
    applyReaderData(data);
  } catch (err) {
    if (manual) flashStatus('erro');
    console.error('[app] falha ao verificar atualização:', err);
  } finally {
    fetching = false;
    refreshEl.classList.remove('is-spinning');
  }
}

let flashTimer = null;
function flashStatus(text) {
  clearTimeout(flashTimer);
  refreshStatusEl.textContent = text;
  refreshStatusEl.classList.add('is-flash');
  flashTimer = setTimeout(() => {
    refreshStatusEl.classList.remove('is-flash');
    updateRefreshStatus();
  }, 2000);
}

async function loadReader() {
  try {
    const response = await fetch('reader.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyReaderData(await response.json(), { initial: true });
  } catch (err) {
    const error = el('p', 'deck-loading', 'não foi possível carregar o Reader. rode "node scripts/build.js" e sirva a pasta com um servidor estático.');
    deckEl.replaceChildren(error);
    console.error('[app] falha ao carregar reader.json:', err);
    return;
  }

  setInterval(() => {
    updateRefreshStatus();
    updateRelativeTimes();
  }, 60000);
  setInterval(checkForUpdates, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdates();
    else saveSeenCutoff();
  });
  window.addEventListener('pagehide', saveSeenCutoff);
}

refreshEl.addEventListener('click', () => checkForUpdates({ manual: true }));

// --- theme -----------------------------------------------------------------

function getEffectiveTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function updateThemeToggleButton(theme) {
  themeToggleEl.textContent = theme === 'dark' ? '☀' : '☾';
  const label = theme === 'dark' ? 'mudar para tema claro' : 'mudar para tema escuro';
  themeToggleEl.setAttribute('aria-label', label);
  themeToggleEl.title = label;

  const themeColorMeta = document.getElementById('theme-color-meta');
  if (themeColorMeta) themeColorMeta.setAttribute('content', theme === 'dark' ? '#0b0f14' : '#e9edf1');
}

function toggleTheme() {
  const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
  if (next === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  storageSet(THEME_KEY, next);
  updateThemeToggleButton(next);
}

updateThemeToggleButton(getEffectiveTheme());
themeToggleEl.addEventListener('click', toggleTheme);

loadReader();
