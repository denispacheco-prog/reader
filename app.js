const WATERLINE_KEY = 'reader:waterline';
const THEME_KEY = 'reader:theme';

const streamEl = document.getElementById('stream');
const closureEl = document.getElementById('ambient-closure');
const searchEl = document.getElementById('search');
const themeToggleEl = document.getElementById('theme-toggle');

const state = {
  items: [],
  waterlineDate: readWaterline(),
  observer: null,
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
  if (!query) return items;
  return items.filter((item) => {
    const haystack = `${item.title} ${item.source} ${item.summary}`.toLowerCase();
    return haystack.includes(query);
  });
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

function renderStream(query) {
  const filtered = filterItems(state.items, query);
  streamEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.items.length === 0
      ? 'nenhum item disponível.'
      : 'nada encontrado para essa busca.';
    streamEl.appendChild(empty);
    disconnectObserver();
    closureEl.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of filtered) {
    fragment.appendChild(renderItem(item));
  }
  streamEl.appendChild(fragment);

  if (query) {
    disconnectObserver();
    closureEl.hidden = true;
  } else {
    setupAmbientClosure(filtered);
  }
}

function renderItem(item) {
  const el = document.createElement('article');
  el.className = 'item' + (isNew(item) ? ' is-new' : '');
  el.dataset.link = item.link;

  const meta = document.createElement('p');
  meta.className = 'item-meta';

  const source = document.createElement('span');
  source.className = 'item-source';
  source.textContent = item.source;

  const date = document.createElement('span');
  date.className = 'item-date';
  date.textContent = formatDate(item.date);

  meta.append(source, date);

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
    closureEl.hidden = false;
    return;
  }

  closureEl.hidden = true;
  const lastNew = newItems[newItems.length - 1];
  const targetEl = streamEl.querySelector(`[data-link="${cssEscape(lastNew.link)}"]`);
  if (!targetEl) return;

  state.observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        closureEl.hidden = true;
      } else if (entry.boundingClientRect.top < 0) {
        closureEl.hidden = false;
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

async function loadReader() {
  try {
    const response = await fetch('reader.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.items = data.items || [];
    renderStream('');
  } catch (err) {
    streamEl.innerHTML = '';
    const error = document.createElement('p');
    error.className = 'empty';
    error.textContent = 'não foi possível carregar o reader. rode "node scripts/build.js" e sirva a pasta com um servidor estático.';
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
