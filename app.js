const WATERLINE_KEY = 'reader:waterline';
const THEME_KEY = 'reader:theme';
const REFRESH_INTERVAL_MINUTES = 30;

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

const streamEl = document.getElementById('stream');
const closureEl = document.getElementById('ambient-closure');
const searchEl = document.getElementById('search');
const themeToggleEl = document.getElementById('theme-toggle');
const sidebarEl = document.getElementById('sidebar');
const sidebarToggleEl = document.getElementById('sidebar-toggle');
const sidebarListEl = document.getElementById('sidebar-feed-list');
const refreshStatusEl = document.getElementById('refresh-status');

const state = {
  items: [],
  waterlineDate: readWaterline(),
  observer: null,
  initialRenderDone: false,
  sourceFilter: null,
  generatedAt: null,
};

function readWaterline() {
  const stored = localStorage.getItem(WATERLINE_KEY);
  if (!stored) return null;
  const date = new Date(stored);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNew(item) {
  return state.waterlineDate !== null && new Date(item.date) > state.waterlineDate;
}

function filterItems(items, query) {
  let result = state.sourceFilter
    ? items.filter((item) => item.source === state.sourceFilter)
    : items;

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

function renderStream(query) {
  const filtered = filterItems(state.items, query);
  const animateEntrance = !state.initialRenderDone;
  streamEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.items.length === 0
      ? 'nenhum item disponível.'
      : 'nada encontrado para essa busca.';
    streamEl.appendChild(empty);
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
  source.style.setProperty('--cat-hue', hueFor(item.source));

  meta.append(source);

  if (item.category) {
    const category = document.createElement('span');
    category.className = 'item-category';
    category.textContent = item.category;
    category.style.setProperty('--cat-hue', hueFor(item.category));
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
  const sources = [...new Set(items.map((item) => item.source))].sort((a, b) =>
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
    renderStream(searchEl.value.trim().toLowerCase());
  });
  allLi.append(allBtn);
  sidebarListEl.append(allLi);

  sources.forEach((source) => {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-feed-btn' + (state.sourceFilter === source ? ' is-active' : '');
    btn.style.setProperty('--cat-hue', hueFor(source));

    const dot = document.createElement('span');
    dot.className = 'sidebar-feed-dot';

    const name = document.createElement('span');
    name.className = 'sidebar-feed-name';
    name.textContent = source;

    btn.append(dot, name);
    btn.addEventListener('click', () => {
      state.sourceFilter = state.sourceFilter === source ? null : source;
      renderSidebar(state.items);
      renderStream(searchEl.value.trim().toLowerCase());
    });

    li.append(btn);
    sidebarListEl.append(li);
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

  refreshStatusEl.textContent = minutesLeft > 0
    ? `atualiza em ~${minutesLeft} min`
    : 'atualização a caminho';
}

async function loadReader() {
  try {
    const response = await fetch('reader.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.items = data.items || [];
    state.generatedAt = data.generatedAt || null;
    renderSidebar(state.items);
    renderStream('');
    updateRefreshStatus();
    setInterval(updateRefreshStatus, 60000);
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

searchEl.addEventListener('input', () => {
  renderStream(searchEl.value.trim().toLowerCase());
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveWaterline();
});
window.addEventListener('pagehide', saveWaterline);

loadReader();
