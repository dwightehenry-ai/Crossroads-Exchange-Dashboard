'use strict';

const $ = (id) => document.getElementById(id);
let teamSignature = '';

function first(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
}

function confirmed(person) {
  if (person.confirmed === true) return true;
  const status = String(first(person.confirmationStatus, person.schedulingStatus, person.status)).trim().toLowerCase();
  return ['c', 'confirmed', 'accepted', 'accept', 'yes'].includes(status);
}

function safePhoto(value) {
  const url = String(value || '').trim();
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return '';
}

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
}

function photoNode(person, large) {
  const name = first(person.name, person.fullName, 'Team member');
  const fallback = el('div', large ? 'portrait-fallback' : 'avatar', initials(name));
  const url = safePhoto(first(large ? person.photo : person.photoThumbnail, person.photo, person.image, person.avatar, person.photoUrl));
  if (!url) return fallback;
  const img = el('img', large ? 'portrait' : 'avatar');
  img.src = url;
  img.alt = large ? `Photo of ${name}` : '';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.replaceWith(fallback), { once: true });
  return img;
}

function detailField(list, title, value, extraClass = '') {
  const item = el('div', extraClass);
  item.append(el('dt', '', title), el('dd', '', first(value, 'Not assigned')));
  list.append(item);
}

function personRow(person, groupName, index) {
  const name = first(person.name, person.fullName, 'Team member');
  const role = first(person.role, person.teamPositionName, person.instrument, person.assignment, groupName);
  const row = el('details', 'person');
  row.dataset.key = `${groupName}:${first(person.id, person.personId, name + ':' + role)}:${index}`;
  const summary = el('summary');
  const labels = el('span', 'person-title');
  labels.append(el('strong', '', name), el('small', '', role));
  summary.append(photoNode(person, false), labels, el('span', 'chevron', '›'));
  const body = el('div', 'person-detail');
  const assignments = el('dl', 'assignments');
  detailField(assignments, 'POSITION', role, 'position');
  detailField(assignments, 'PACK', first(person.packAssignment, person.pack, person.bodypack, person.iem, person.packNumber));
  detailField(assignments, 'MIC', first(person.micAssignment, person.mic, person.microphone, person.micNumber));
  body.append(photoNode(person, true), el('h4', 'full-name', name), assignments);
  row.append(summary, body);
  return row;
}

function renderTeam(volunteers = {}) {
  const groups = [
    ['Vocals', volunteers.vocals],
    ['Band', volunteers.band],
    ['Communicators', volunteers.communications]
  ].map(([name, people]) => [name, (Array.isArray(people) ? people : []).filter(confirmed)]);
  const signature = JSON.stringify(groups);
  if (signature === teamSignature) return;
  const openKeys = new Set([...$('team-content').querySelectorAll('details[open]')].map((row) => row.dataset.key));
  const fragment = document.createDocumentFragment();
  let count = 0;
  for (const [name, people] of groups) {
    count += people.length;
    const section = el('section', 'team-group');
    section.append(el('h3', '', `${name.toUpperCase()} · ${people.length}`));
    const list = el('div', 'people-list');
    if (!people.length) list.append(el('p', 'empty', 'No confirmed assignments'));
    people.forEach((person, index) => {
      const row = personRow(person, name, index);
      row.open = openKeys.has(row.dataset.key);
      list.append(row);
    });
    section.append(list);
    fragment.append(section);
  }
  $('team-content').replaceChildren(fragment);
  $('team-count').textContent = `${count} ${count === 1 ? 'person' : 'people'}`;
  teamSignature = signature;
}

function renderSystems(statuses) {
  const list = $('systems-content');
  const entries = Array.isArray(statuses) ? statuses.map((item, i) => [
    first(item?.name, item?.label, item?.system, `System ${i + 1}`),
    first(item?.state, item?.status, item?.connected, item?.online, item)
  ]) : Object.entries(statuses || {});
  if (!entries.length) {
    list.replaceChildren(el('p', 'empty', 'System status unavailable'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const [name, raw] of entries) {
    const value = raw && typeof raw === 'object' ? first(raw.state, raw.status, raw.connected, raw.online, raw.ready, 'Unknown') : raw;
    const text = value === true ? 'ONLINE' : value === false ? 'OFFLINE' : String(first(value, 'Unknown')).toUpperCase();
    const row = el('div', 'system-row');
    const state = el('strong', /^(ONLINE|CONNECTED|READY|LIVE|OK)$/.test(text) ? 'good' : /^(OFFLINE|DISCONNECTED|ERROR|FAILED)$/.test(text) ? 'bad' : '', text);
    row.append(el('span', '', name), state);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function render(payload) {
  const data = payload.dashboard || payload;
  const service = data.service || {};
  $('plan').textContent = first(data.header?.plan, data.header?.servicePlan, 'No plan selected');
  $('current-item').textContent = first(service.current?.title, service.current?.name, 'No current item');
  $('current-type').textContent = first(service.current?.type, '');
  $('next-item').textContent = first(service.next?.title, service.next?.name, 'No next item');
  $('next-type').textContent = first(service.next?.type, '');
  $('message').textContent = typeof data.message === 'string' ? data.message : first(data.message?.text, data.message?.message, data.message?.body, 'No green room message');
  renderTeam(data.volunteers || {});
  renderSystems(data.systems || data.statuses || payload.statuses || []);
  $('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
}

async function refresh() {
  let delay = 5000;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10000);
  try {
    const response = await fetch('/api/dashboard', { cache: 'no-store', signal: timeout.signal });
    if (!response.ok) throw new Error(`Dashboard returned ${response.status}`);
    const payload = await response.json();
    render(payload);
    $('connection').textContent = 'Live';
    $('connection').className = 'connection online';
    $('error').hidden = true;
    delay = Math.max(3000, Math.min(60000, Number(payload.refreshSeconds) * 1000 || 5000));
  } catch (error) {
    $('connection').textContent = 'Disconnected';
    $('connection').className = 'connection offline';
    $('error').textContent = `Cannot update dashboard: ${error.message}. Retrying…`;
    $('error').hidden = false;
  } finally {
    clearTimeout(timer);
    setTimeout(refresh, delay);
  }
}

function showTab(id, focus = false) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const active = tab.dataset.tab === id;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) tab.focus();
  }
}

document.querySelector('.tab-bar').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) showTab(tab.dataset.tab);
});
document.querySelector('.tab-bar').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
  showTab(tabs[next].dataset.tab, true);
});
refresh();
