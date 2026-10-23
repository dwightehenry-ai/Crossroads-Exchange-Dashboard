'use strict';

const API_URL = '/api/dashboard';
const DEFAULT_REFRESH_SECONDS = 5;
let refreshTimer = null;
let refreshMs = DEFAULT_REFRESH_SECONDS * 1000;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const requestedScreen = ['1', '2', '3', 'all'].includes(params.get('screen'))
  ? params.get('screen')
  : 'all';
const debugEnabled = params.get('debug') === '1';
const autoFitEnabled = params.get('fit') !== 'off';
let fitTimer = null;

/*
| Display modes
| - TV mode (/tv1, /tv2, /tv3 add tv=1): clean and read-only. No navigation,
|   no tools, and always the plan the TVs are set to.
| - Admin tools: only on a phone/tablet/PC that has turned them on (?admin=1,
|   or "Show tools on this device" in the Manager). A plan picked there is a
|   preview for that device only. Changing the TVs takes the PIN every time.
*/
const ADMIN_DEVICE_KEY = 'exchangeAdminDevice';
const DEVICE_PREVIEW_KEY = 'exchangeDevicePreview';
const tvMode = params.get('tv') === '1';

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode: tools still work for this visit */ }
}

(function applyAdminUrlFlags() {
  if (tvMode) return;
  let changed = false;
  if (params.get('admin') === '1') { storageSet(ADMIN_DEVICE_KEY, '1'); changed = true; }
  if (params.get('admin') === '0') { storageSet(ADMIN_DEVICE_KEY, null); storageSet(DEVICE_PREVIEW_KEY, null); changed = true; }
  const previewPlanId = text(params.get('previewPlan'));
  if (previewPlanId) {
    storageSet(ADMIN_DEVICE_KEY, '1');
    storageSet(DEVICE_PREVIEW_KEY, JSON.stringify({
      serviceTypeId: text(params.get('previewServiceType')),
      planId: previewPlanId
    }));
    changed = true;
  }
  if (changed) {
    ['admin', 'previewPlan', 'previewServiceType'].forEach((key) => params.delete(key));
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }
})();

const adminMode = !tvMode && storageGet(ADMIN_DEVICE_KEY) === '1';

function devicePreview() {
  if (!adminMode) return null;
  try {
    const stored = JSON.parse(storageGet(DEVICE_PREVIEW_KEY) || 'null');
    return stored && text(stored.planId) ? stored : null;
  } catch {
    return null;
  }
}

function dashboardUrl() {
  const preview = devicePreview();
  if (!preview) return API_URL;
  const query = new URLSearchParams({ planId: preview.planId });
  if (text(preview.serviceTypeId)) query.set('serviceTypeId', preview.serviceTypeId);
  return `${API_URL}?${query}`;
}

function viewKey() {
  const preview = devicePreview();
  return preview ? `preview:${preview.serviceTypeId}:${preview.planId}` : 'tv';
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function text(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPlanningCenterText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textLines(value) {
  return cleanPlanningCenterText(value)
    .split(/\n+/)
    .map((line) => line.replace(/^[•*\-–—>]+\s*/, '').trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  return '';
}

function initials(name) {
  const parts = text(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function setError(message = '') {
  const el = $('dashboardError');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message;
}


function setupControllerLink() {
  const link = $('controllerLink');
  if (!link) return;
  link.href = `http://${window.location.hostname}:3002/`;
  link.target = '_blank';
  link.rel = 'noopener';
}

function setupScreenMode() {
  document.body.classList.toggle('screen-single', requestedScreen !== 'all');
  document.body.classList.toggle('screen-all', requestedScreen === 'all');
  document.body.classList.toggle('tv-mode', tvMode);
  document.body.classList.toggle('admin-device', adminMode);
  const nav = document.querySelector('.screen-nav');
  if (nav && tvMode) nav.hidden = true;
  document.querySelectorAll('[data-screen]').forEach((el) => {
    el.classList.toggle('is-active', requestedScreen === 'all' || el.dataset.screen === requestedScreen);
  });
  document.querySelectorAll('[data-screen-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.screenLink === requestedScreen);
  });
}

function resetAutoFit(screen) {
  if (!screen) return;
  screen.style.transform = '';
  screen.style.transformOrigin = '';
  screen.style.width = '';
  screen.style.height = '';
  screen.style.minHeight = '';
  screen.dataset.fitScale = '1';
}

function syncWorshipLeadTileSize() {
  const leadGrid = $('worshipServiceLeadGrid');
  const vocalGrid = $('vocalsGrid');
  if (!leadGrid || !vocalGrid) return;

  const vocalCards = [...vocalGrid.querySelectorAll('.person-card')];
  if (!vocalCards.length) {
    leadGrid.style.removeProperty('--matched-vocal-width');
    leadGrid.style.removeProperty('--matched-vocal-height');
    return;
  }

  const width = Math.max(...vocalCards.map((card) => card.offsetWidth || 0));
  const height = Math.max(...vocalCards.map((card) => card.offsetHeight || 0));
  if (width > 0) leadGrid.style.setProperty('--matched-vocal-width', `${width}px`);
  if (height > 0) leadGrid.style.setProperty('--matched-vocal-height', `${height}px`);
}

function fitActiveScreen() {
  if (!autoFitEnabled || requestedScreen === 'all') return;
  const screen = document.querySelector('.tv-screen.is-active');
  if (!screen) return;

  resetAutoFit(screen);
  syncWorshipLeadTileSize();

  const viewportWidth = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 0);
  const viewportHeight = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 0);
  let scale = 1;
  const minimumScale = viewportWidth <= 620 ? 0.68 : 0.62;

  // Give the browser one unscaled measurement, then progressively expand the
  // layout canvas and scale it back to the viewport until nothing is clipped.
  for (let i = 0; i < 14; i += 1) {
    screen.style.width = `${viewportWidth / scale}px`;
    screen.style.height = `${viewportHeight / scale}px`;
    screen.style.minHeight = `${viewportHeight / scale}px`;
    screen.style.transformOrigin = 'top left';
    screen.style.transform = `scale(${scale})`;

    const heightFits = screen.scrollHeight <= screen.clientHeight + 2;
    const widthFits = screen.scrollWidth <= screen.clientWidth + 2;
    if (heightFits && widthFits) break;
    if (scale <= minimumScale) break;
    scale = Math.max(minimumScale, scale - 0.035);
  }

  screen.dataset.fitScale = scale.toFixed(3);
}

function scheduleAutoFit() {
  if (!autoFitEnabled || requestedScreen === 'all') return;
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    requestAnimationFrame(() => fitActiveScreen());
  }, 40);
}


function attachImageFitHandlers() {
  document.querySelectorAll('.person-photo, .exchange-logo-image').forEach((img) => {
    if (img.dataset.fitListener === '1') return;
    img.dataset.fitListener = '1';
    img.addEventListener('load', scheduleAutoFit, { passive: true });
    img.addEventListener('error', scheduleAutoFit, { passive: true });
  });
}

function personName(member = {}) {
  return first(
    member.name,
    member.fullName,
    [member.firstName, member.lastName].filter(Boolean).join(' '),
    'Scheduled Person'
  );
}

function memberTeam(member = {}) {
  return normalize(first(member.teamName, member.team, member.team_name));
}

function memberPosition(member = {}) {
  return normalize(first(member.teamPositionName, member.role, member.positionName, member.position));
}

function memberPhoto(member = {}) {
  return first(member.photo, member.photoThumbnail, member.photoUrl, member.image, '');
}

function confirmationCode(member = {}) {
  const status = normalize(first(member.status, member.confirmationStatus, member.confirmation_status));
  if (['c', 'confirmed', 'accepted', 'yes'].includes(status)) return 'CONFIRMED';
  if (['u', 'unconfirmed', 'pending', 'requested'].includes(status)) return 'UNCONFIRMED';
  return status ? status.toUpperCase() : '';
}

function isConfirmedStatus(member = {}) {
  const status = normalize(first(member.status, member.confirmationStatus, member.confirmation_status));
  return ['c', 'confirmed', 'accepted', 'yes'].includes(status);
}

function isHiddenStatus(member = {}) {
  return !isConfirmedStatus(member);
}

function isTrainee(position) {
  return /\btrainee\b|\btraining\b/.test(position);
}

function isWorshipLeader(position) {
  return /\bworship leader\b|\bworship pastor\b|\bpastor of worship\b/.test(position);
}

function isWorshipServiceLead(position) {
  return /\bworship\s+service\s+lead\b|\bservice\s+lead\s*-?\s*worship\b/.test(position);
}

function isMusicDirector(position) {
  return /\bmusic(?:al)?\s+director\b|^md$|\bmd\b/.test(position);
}

function isCommunicationServiceLead(position) {
  return /communication.*service lead|comms?.*service lead|service lead.*communication|^service lead$/.test(position);
}

function isWelcomeRole(position) {
  return /\bwelcome\b|\bcall\s+to\s+worship\b|\bctw\b|\bc\.t\.w\b/.test(position);
}

function isCloseOutWorshipRole(position) {
  return /\bclose\s*out\s*worship\b|\bclosing\s+worship\b|\bcow\b|\bc\.o\.w\b/.test(position);
}

function isOfferingRole(position) {
  // TV1 should only use the exact Planning Center position titled "Offering".
  return normalize(position) === 'offering';
}

function isSpeakerRole(position) {
  return /\bspeaker\b|\bpresenter\b|\bsermon\s+communicator\b|\bsermon\b|\bmessage\b|\bpreacher\b/.test(position);
}

function isFirefighter(position) {
  return /\bfire\s*fighter\b|\bfirefighter\b/.test(position);
}

function isPaLead(position) {
  return /\bpa\s*(team\s*)?lead\b|\bteam lead\s*[- ]?pa\b/.test(position);
}

function isServiceSupportTeam(team, position) {
  return team.includes('service support') || team.includes('support team') ||
    isFirefighter(position) || isPaLead(position);
}

function isVocal(position, team) {
  return /\bvocal(s|ist)?\b|\bsinger\b|\bbgv\b/.test(position) || team === 'vocals' || team.includes('vocal');
}

function isCommunicationTeam(team, position) {
  return team.includes('communication') || team.includes('comms') ||
    /welcome|call to worship|announcement|speaker|presenter|offering|close out worship|service host|communicator/.test(position);
}

function isWorshipTeam(team, position) {
  return team.includes('worship') || team.includes('band') || team.includes('vocal') ||
    /drum|percussion|bass|guitar|acoustic|electric|keys|keyboard|piano|organ|synth|tracks|playback|music director|musical director|\bmd\b|rapper|vocal|singer|bgv/.test(position);
}

function dedupeAssignments(list) {
  const seen = new Set();
  return list.filter((member) => {
    const key = [member.id, memberPosition(member), personName(member)].map(text).join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categorizeMembers(members) {
  // Every TV only displays people who have explicitly confirmed.
  const visible = asArray(members).filter(Boolean).filter(isConfirmedStatus);
  const support = [];
  const communicationOther = [];
  const worshipServiceLead = [];
  const worshipLead = [];
  const vocals = [];
  const band = [];
  const singerCandidatesInPlanningCenterOrder = [];
  const communicationRoles = {
    serviceLead: [],
    welcome: [],
    worshipLead: [],
    closeOutWorship: [],
    offering: [],
    speaker: []
  };

  for (const member of visible) {
    const team = memberTeam(member);
    const position = memberPosition(member);

    if (isTrainee(position)) continue;

    if (isWorshipServiceLead(position)) {
      worshipServiceLead.push(member);
      continue;
    }

    if (isCommunicationServiceLead(position) && !team.includes('worship')) {
      communicationRoles.serviceLead.push(member);
      continue;
    }

    if (isWelcomeRole(position)) {
      communicationRoles.welcome.push(member);
      continue;
    }

    if (isWorshipLeader(position)) {
      communicationRoles.worshipLead.push(member);
      worshipLead.push(member);
      singerCandidatesInPlanningCenterOrder.push(member);
      continue;
    }

    if (isCloseOutWorshipRole(position)) {
      communicationRoles.closeOutWorship.push(member);
      continue;
    }

    if (isOfferingRole(position)) {
      communicationRoles.offering.push(member);
      continue;
    }

    if (isSpeakerRole(position) && isCommunicationTeam(team, position)) {
      communicationRoles.speaker.push(member);
      continue;
    }

    if (isServiceSupportTeam(team, position)) {
      support.push(member);
      continue;
    }

    if (isWorshipTeam(team, position)) {
      if (isMusicDirector(position)) {
        band.push(member);
        continue;
      }
      if (isVocal(position, team)) {
        vocals.push(member);
        singerCandidatesInPlanningCenterOrder.push(member);
      } else band.push(member);
      continue;
    }

    if (isCommunicationTeam(team, position)) {
      communicationOther.push(member);
    }
  }

  for (const key of Object.keys(communicationRoles)) {
    communicationRoles[key] = dedupeAssignments(communicationRoles[key]);
  }

  // The Offering tile is a single-person role on the Communication TV.
  communicationRoles.offering = communicationRoles.offering.slice(0, 1);

  return {
    communication: dedupeAssignments(communicationOther),
    communicationRoles,
    support: dedupeAssignments(support),
    worshipServiceLead: dedupeAssignments(worshipServiceLead),
    worshipLead: dedupeAssignments(worshipLead),
    vocals: dedupeAssignments(vocals),
    band: dedupeAssignments(band),
    singerCandidates: (() => {
      const seenPeople = new Set();
      return singerCandidatesInPlanningCenterOrder.filter((member) => {
        const key = normalize(personName(member));
        if (!key || seenPeople.has(key)) return false;
        seenPeople.add(key);
        return true;
      });
    })()
  };
}

function nameSizeClass(name) {
  const length = text(name).length;
  if (length >= 26) return 'name-xlong';
  if (length >= 20) return 'name-long';
  return '';
}

function personCard(member, kind = '') {
  const name = personName(member);
  const role = first(member.teamPositionName, member.role, member.positionName, 'TEAM MEMBER');
  const photo = memberPhoto(member);
  const status = confirmationCode(member);
  const photoMarkup = photo
    ? `<img class="person-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
    : '';
  const initialsHidden = photo ? ' hidden' : '';
  const nameClass = nameSizeClass(name);

  return `
    <article class="person-card ${kind === 'vocal' ? 'vocal-card' : ''}">
      <div class="person-photo-wrap">
        ${photoMarkup}
        <div class="person-initials"${initialsHidden}>${escapeHtml(initials(name))}</div>
      </div>
      <div class="person-copy">
        <div class="person-role">${escapeHtml(role)}</div>
        <div class="person-name ${nameClass}">${escapeHtml(name)}</div>
        ${status ? `<div class="person-status">${escapeHtml(status)}</div>` : ''}
      </div>
    </article>`;
}

function compactPerson(member) {
  const name = personName(member);
  const photo = memberPhoto(member);
  const status = confirmationCode(member);
  const photoMarkup = photo
    ? `<img class="comm-person-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
    : '';
  const initialsHidden = photo ? ' hidden' : '';
  return `
    <div class="comm-person">
      <div class="comm-person-photo-wrap">
        ${photoMarkup}
        <div class="comm-person-initials"${initialsHidden}>${escapeHtml(initials(name))}</div>
      </div>
      <div class="comm-person-copy">
        <div class="comm-person-name ${nameSizeClass(name)}">${escapeHtml(name)}</div>
        ${status ? `<div class="comm-person-status">${escapeHtml(status)}</div>` : ''}
      </div>
    </div>`;
}

function communicationRoleCard(label, members) {
  const list = asArray(members);
  return `
    <article class="communication-role-card">
      <div class="communication-role-label">${escapeHtml(label)}</div>
      <div class="communication-role-people">
        ${list.length ? list.map(compactPerson).join('') : '<div class="communication-unassigned">NOT SCHEDULED</div>'}
      </div>
    </article>`;
}

function infoCard(label, value, extraClass = '') {
  return `
    <article class="communication-info-card ${extraClass}">
      <div class="communication-info-label">${escapeHtml(label)}</div>
      <div class="communication-info-value">${escapeHtml(value || 'NOT LISTED')}</div>
    </article>`;
}

function isAnnouncementBoundary(item) {
  if (!item) return true;
  if (isHeaderItem(item) || isSongItem(item)) return true;
  const title = normalize(item.title);
  return /\b(open doors|welcome|call to worship|game|verse of the day|offering|worship|prayer|speaker|sermon|message|closing thoughts?)\b/.test(title);
}

function extractAnnouncements(items) {
  const ordered = asArray(items).filter(Boolean);
  const collected = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const item = ordered[i];
    const title = text(item.title);
    if (!/\bannouncements?\b/i.test(title)) continue;

    const titleRemainder = title
      .replace(/^.*?announcements?\s*[:\-–—]?\s*/i, '')
      .trim();
    if (titleRemainder && !/^announcements?$/i.test(titleRemainder)) collected.push(titleRemainder);
    collected.push(...textLines(item.description));

    if (isHeaderItem(item)) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const next = ordered[j];
        if (isAnnouncementBoundary(next)) break;
        if (text(next.title)) collected.push(text(next.title));
        collected.push(...textLines(next.description));
      }
    }
  }

  return [...new Set(collected.map((line) => line.trim()).filter(Boolean))].slice(0, 6);
}

function extractVerseOfDay(items) {
  const ordered = asArray(items).filter(Boolean);
  const index = ordered.findIndex((item) => /\bverse(?:\s+of\s+the\s+day)?\b/i.test(text(item.title)));
  if (index < 0) return '';

  const item = ordered[index];
  const description = cleanPlanningCenterText(item.description);
  if (description) return description;

  const title = text(item.title);
  const remainder = title.replace(/^.*?verse(?:\s+of\s+the\s+day)?\s*[:\-–—]?\s*/i, '').trim();
  if (remainder && !/^verse(?:\s+of\s+the\s+day)?$/i.test(remainder)) return remainder;

  if (isHeaderItem(item)) {
    const next = ordered[index + 1];
    if (next && !isHeaderItem(next)) return first(next.title, cleanPlanningCenterText(next.description));
  }
  return '';
}

function renderCommunicationBoard(groups, planningCenter = {}, manualBoardContent = {}) {
  const roleGrid = $('communicationRoleGrid');
  if (roleGrid) {
    roleGrid.innerHTML = [
      communicationRoleCard('SERVICE LEAD', groups.communicationRoles.serviceLead),
      communicationRoleCard('WELCOME / C.T.W.', groups.communicationRoles.welcome),
      communicationRoleCard('WORSHIP LEAD', groups.communicationRoles.worshipLead),
      communicationRoleCard('C.O.W. / CLOSE OUT WORSHIP', groups.communicationRoles.closeOutWorship),
      communicationRoleCard('OFFERING', groups.communicationRoles.offering),
      communicationRoleCard('SPEAKER', groups.communicationRoles.speaker)
    ].join('');
  }

  const infoGrid = $('communicationInfoGrid');
  if (infoGrid) {
    infoGrid.innerHTML = [
      infoCard('SERVICE TYPE', first(planningCenter.serviceTypeName, 'THE EXCHANGE')),
      infoCard('SERMON SERIES', first(planningCenter.seriesTitle, planningCenter.planTitle, 'NOT LISTED'))
    ].join('');
  }

  const announcements = textLines(manualBoardContent.announcements);
  const announcementsEl = $('announcementsContent');
  if (announcementsEl) {
    announcementsEl.innerHTML = announcements.length
      ? `<ul>${announcements.map((announcement) => `<li>${escapeHtml(announcement)}</li>`).join('')}</ul>`
      : '<div class="communication-empty-text">No manual announcements entered.</div>';
  }

  const verseEl = $('verseOfDayContent');
  if (verseEl) {
    const verse = cleanPlanningCenterText(manualBoardContent.verseOfDay);
    verseEl.textContent = verse || 'No verse entered.';
  }
}

const NOTE_CATEGORY_CLASSES = {
  general: 'general', worship: 'worship', production: 'production',
  students: 'students', 'follow-up': 'follow-up'
};

function renderManualNotes(manualBoardContent = {}) {
  const el = $('manualNotesContent');
  if (!el) return;

  // Structured notes (pinned + category). Older servers only send the text box.
  const notes = Array.isArray(manualBoardContent.notes)
    ? manualBoardContent.notes.filter((note) => text(note?.text))
    : textLines(manualBoardContent.worshipNotes).map((line) => ({ text: line, category: 'General', pinned: false }));

  if (!notes.length) {
    el.innerHTML = '<div class="notes-empty-text">No notes entered.</div>';
    return;
  }

  el.innerHTML = `<ul class="plan-notes">${notes.map((note) => {
    const category = first(note.category, 'General');
    const categoryClass = NOTE_CATEGORY_CLASSES[normalize(category)] || 'general';
    return `
      <li class="plan-note${note.pinned ? ' is-pinned' : ''}">
        <span class="note-meta">
          ${note.pinned ? '<span class="note-pin" aria-label="Pinned">PINNED</span>' : ''}
          <span class="note-category note-cat-${categoryClass}">${escapeHtml(category)}</span>
        </span>
        <span class="note-text">${escapeHtml(note.text)}</span>
      </li>`;
  }).join('')}</ul>`;
}

function renderPeople(containerId, members, emptyMessage, kind = '') {
  const el = $(containerId);
  if (!el) return;
  const list = asArray(members);
  if (!list.length) {
    el.innerHTML = `<div class="empty-card">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  el.innerHTML = list.map((m) => personCard(m, kind)).join('');
}

function isHeaderItem(item) {
  return normalize(item?.itemType) === 'header';
}

function isSongItem(item = {}) {
  const type = normalize(item.itemType);
  const title = normalize(item.title);
  return Boolean(item.songId) || type.includes('song') || Boolean(text(item.keyName)) || /^song\s*\d+\b/.test(title);
}

function songItems(items) {
  const ordered = asArray(items).filter(Boolean).filter((item) => !isHeaderItem(item));
  const result = [];
  const seen = new Set();

  const add = (item) => {
    if (!item || result.length >= 3) return;
    const key = text(item.id || `${item.title}|${item.sequence}`);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  };

  ordered.filter((i) => Boolean(i.songId)).forEach(add);
  ordered.filter((i) => normalize(i.itemType).includes('song')).forEach(add);
  ordered.filter((i) => Boolean(text(i.keyName))).forEach(add);
  ordered.filter((i) => /^song\s*\d+\b/.test(normalize(i.title))).forEach(add);

  return result.slice(0, 3);
}

function singerNamesFromDescription(description, candidates) {
  const clean = cleanPlanningCenterText(description);
  if (!clean) return [];

  const result = [];
  const labeledPattern = /(?:^|\n|\||;)\s*(?:vocals?|vocalists?|singers?|lead(?:\s+vocal)?|sung\s+by|who\s+sings?)\s*[:\-–—]\s*([^\n|;]+)/gi;
  let match;
  while ((match = labeledPattern.exec(clean))) {
    result.push(...match[1].split(/\s*(?:,|&|\+|\band\b|\/)\s*/i).map((name) => name.trim()).filter(Boolean));
  }

  for (const member of asArray(candidates)) {
    const fullName = personName(member);
    if (!fullName) continue;
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || '';
    const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
    const escapedFirst = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedLast = lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fullHit = normalize(clean).includes(normalize(fullName));
    const firstHit = firstName.length >= 3 && new RegExp(`\\b${escapedFirst}\\b`, 'i').test(clean);
    const lastHit = lastName.length >= 3 && new RegExp(`\\b${escapedLast}\\b`, 'i').test(clean);
    if (fullHit || firstHit || lastHit) result.push(fullName);
  }

  const expanded = [];
  for (const rawName of result) {
    const normalizedRaw = normalize(rawName);
    const matches = asArray(candidates).filter((member) => {
      const full = personName(member);
      const parts = full.split(/\s+/).filter(Boolean);
      return normalize(full) === normalizedRaw || normalize(parts[0]) === normalizedRaw || normalize(parts.at(-1)) === normalizedRaw;
    });
    expanded.push(matches.length === 1 ? personName(matches[0]) : rawName);
  }

  const uniqueNames = [...new Set(expanded.map(text).filter(Boolean))];
  if (uniqueNames.length) {
    const planningCenterOrder = new Map(
      asArray(candidates).map((member, index) => [normalize(personName(member)), index])
    );
    return uniqueNames
      .map((name, index) => ({ name, index }))
      .sort((a, b) => {
        const aOrder = planningCenterOrder.has(normalize(a.name))
          ? planningCenterOrder.get(normalize(a.name))
          : Number.MAX_SAFE_INTEGER;
        const bOrder = planningCenterOrder.has(normalize(b.name))
          ? planningCenterOrder.get(normalize(b.name))
          : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder || a.index - b.index;
      })
      .map((entry) => entry.name);
  }

  // Do not show a singer name unless it resolves to a confirmed scheduled
  // vocalist/worship lead. This keeps the confirmed-only rule consistent.
  return [];
}

function singersForSong(song, songIndex, candidates) {
  const result = singerNamesFromDescription(song?.description, candidates);
  const songTitle = normalize(song?.title);
  const songNumberPattern = new RegExp(`\\bsong\\s*#?\\s*${songIndex + 1}\\b`, 'i');

  for (const member of asArray(candidates)) {
    const notes = cleanPlanningCenterText(member?.notes);
    const normalizedNotes = normalize(notes);
    if (!notes) continue;
    if (
      (songTitle && normalizedNotes.includes(songTitle)) ||
      songNumberPattern.test(notes) ||
      /\ball\s+songs?\b/i.test(notes)
    ) {
      result.push(personName(member));
    }
  }

  const unique = [...new Set(result.map(text).filter(Boolean))];
  const planningCenterOrder = new Map(
    asArray(candidates).map((member, index) => [normalize(personName(member)), index])
  );
  return unique
    .map((name, index) => ({ name, index }))
    .sort((a, b) => {
      const aOrder = planningCenterOrder.has(normalize(a.name))
        ? planningCenterOrder.get(normalize(a.name))
        : Number.MAX_SAFE_INTEGER;
      const bOrder = planningCenterOrder.has(normalize(b.name))
        ? planningCenterOrder.get(normalize(b.name))
        : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.index - b.index;
    })
    .map((entry) => entry.name);
}

function renderSongs(items, singerCandidates = []) {
  const el = $('songsList');
  if (!el) return;
  const songs = songItems(items);
  if (!songs.length) {
    el.innerHTML = '<div class="empty-card">No song items found in this Planning Center plan.</div>';
    return;
  }
  el.innerHTML = songs.map((song, index) => {
    const singers = singersForSong(song, index, singerCandidates);
    return `
      <div class="song-row">
        <div class="song-number">${index + 1}</div>
        <div class="song-copy">
          <div class="song-title">${escapeHtml(first(song.title, `Song ${index + 1}`))}</div>
          <div class="song-singers">SINGERS: ${escapeHtml(singers.length ? singers.join(' • ') : 'NOT LISTED')}</div>
        </div>
        <div class="song-key">${text(song.keyName) ? `KEY: ${escapeHtml(song.keyName)}` : ''}</div>
      </div>`;
  }).join('');
}

function orderIcon(item, songNumber) {
  if (songNumber) return '♪';
  const title = normalize(item?.title);
  if (/\bgame\b/.test(title)) return 'G';
  if (/welcome|call to worship|open doors/.test(title)) return '✦';
  if (/offer/.test(title)) return '$';
  if (/announce/.test(title)) return '!';
  if (/speaker|message|sermon/.test(title)) return '●';
  if (/prayer/.test(title)) return '+';
  return '›';
}

function gameSubheading(item) {
  const title = text(item?.title);
  const fromTitle = title.match(/\bgame\b\s*[:\-–—]\s*(.+)$/i)?.[1]?.trim();
  if (fromTitle) return fromTitle;
  const descriptionLines = textLines(item?.description);
  return descriptionLines[0] || '';
}

function announcementGroupAt(items, index) {
  const item = items[index];
  const announcements = [];
  announcements.push(...textLines(item?.description));
  let nextIndex = index + 1;

  if (isHeaderItem(item)) {
    while (nextIndex < items.length && !isAnnouncementBoundary(items[nextIndex])) {
      const next = items[nextIndex];
      if (text(next.title)) announcements.push(text(next.title));
      announcements.push(...textLines(next.description));
      nextIndex += 1;
    }
  }

  return {
    announcements: [...new Set(announcements.map(text).filter(Boolean))].slice(0, 6),
    nextIndex
  };
}

function renderOrder(items, singerCandidates = []) {
  const el = $('orderList');
  if (!el) return;

  const ordered = asArray(items).filter(Boolean);
  const openDoorsIndex = ordered.findIndex((item) => /\bopen\s+doors\b/.test(normalize(item?.title)));
  let scoped = openDoorsIndex >= 0 ? ordered.slice(openDoorsIndex) : ordered;
  const closingThoughtsIndex = scoped.findIndex((item) => /\bclosing\s+thoughts?\b/.test(normalize(item?.title)));
  if (closingThoughtsIndex >= 0) scoped = scoped.slice(0, closingThoughtsIndex + 1);

  const songs = songItems(scoped);
  const songNumberById = new Map(songs.map((item, index) => [String(item.id), index + 1]));
  const rows = [];

  for (let i = 0; i < scoped.length; i += 1) {
    const item = scoped[i];
    const title = text(item.title);
    const normalizedTitle = normalize(title);
    if (!title) continue;

    if (/\bannouncements?\b/.test(normalizedTitle)) {
      const grouped = announcementGroupAt(scoped, i);
      rows.push({
        item,
        label: 'ANNOUNCEMENTS',
        subheading: grouped.announcements.length ? grouped.announcements.join(' • ') : 'No announcements listed.',
        className: 'order-announcements',
        songNumber: 0
      });
      if (isHeaderItem(item)) i = grouped.nextIndex - 1;
      continue;
    }

    const songNumber = songNumberById.get(String(item.id)) || 0;
    if (songNumber) {
      const singers = singersForSong(item, songNumber - 1, singerCandidates);
      rows.push({
        item,
        label: title,
        subheading: `SINGERS: ${singers.length ? singers.join(' • ') : 'NOT LISTED'}`,
        className: 'order-song-row',
        songNumber
      });
      continue;
    }

    if (isHeaderItem(item) && !/\bopen\s+doors\b/.test(normalizedTitle)) continue;

    if (/\bgame\b/.test(normalizedTitle)) {
      rows.push({
        item,
        label: 'GAME',
        subheading: gameSubheading(item) || title.replace(/^game\s*[:\-–—]?\s*/i, '').trim() || 'Game details not listed.',
        className: 'order-game',
        songNumber: 0
      });
      continue;
    }

    rows.push({
      item,
      label: title,
      subheading: '',
      className: '',
      songNumber: 0
    });
  }

  if (!rows.length) {
    el.innerHTML = '<div class="empty-card">No service items found between Open Doors and Closing Thoughts.</div>';
    return;
  }

  el.innerHTML = rows.map((row) => `
    <div class="order-row ${row.className}">
      <div class="order-icon">${escapeHtml(orderIcon(row.item, row.songNumber))}</div>
      <div class="order-copy">
        <div class="order-label">${escapeHtml(row.label)}</div>
        ${row.subheading ? `<div class="order-subheading">${escapeHtml(row.subheading)}</div>` : ''}
      </div>
    </div>`).join('');
}

function formatPlanDate(planningCenter = {}) {
  const raw = first(planningCenter.sortDate, planningCenter.planDate, planningCenter.shortDates);
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    }
  }
  return text(first(planningCenter.shortDates, planningCenter.planDate, 'UPCOMING SERVICE')).toUpperCase();
}

function renderHeader(planningCenter = {}, dashboard = {}) {
  const planDate = formatPlanDate(planningCenter);
  // Message title from the server (Message Title item, then Sermon Bumper).
  // When there's no title, show nothing rather than a placeholder.
  const rawTitle = planningCenter.connected
    ? text(planningCenter.planTitle)
    : text(first(dashboard.header?.plan));
  const planTitle = /^untitled plan$/i.test(rawTitle) ? '' : rawTitle;
  document.querySelectorAll('[data-plan-date]').forEach((el) => { el.textContent = planDate; });
  document.querySelectorAll('[data-plan-title]').forEach((el) => {
    el.textContent = planTitle;
    el.hidden = !planTitle;
  });
}

/*
| Planning Center freshness. The server reports how old its data is
| (dataAgeSeconds), which avoids trusting each TV's own clock.
*/
const DEFAULT_STALE_AFTER_SECONDS = 180;
const freshness = {
  updatedAtIso: null,        // when Planning Center last answered (server time)
  receivedAtMs: 0,           // when this device got that answer
  ageAtReceiptSeconds: 0,
  staleAfterSeconds: DEFAULT_STALE_AFTER_SECONDS,
  serverSaysStale: false,
  showingFallback: false
};

function noteFreshness(planningCenter = {}, { fallback = false } = {}) {
  if (!fallback) {
    freshness.updatedAtIso = planningCenter.lastUpdatedAt || freshness.updatedAtIso;
    freshness.receivedAtMs = Date.now();
    freshness.ageAtReceiptSeconds = Number(planningCenter.dataAgeSeconds) || 0;
  }
  freshness.staleAfterSeconds = Number(planningCenter.staleAfterSeconds) || DEFAULT_STALE_AFTER_SECONDS;
  freshness.serverSaysStale = Boolean(planningCenter.stale);
  freshness.showingFallback = fallback;
}

function planningCenterAgeSeconds() {
  if (!freshness.receivedAtMs) return null;
  return freshness.ageAtReceiptSeconds + (Date.now() - freshness.receivedAtMs) / 1000;
}

function isDataStale() {
  const age = planningCenterAgeSeconds();
  return freshness.showingFallback ||
    freshness.serverSaysStale ||
    (age !== null && age > freshness.staleAfterSeconds);
}

function formatClockTime(iso) {
  const date = new Date(iso || '');
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderFooter() {
  const updated = formatClockTime(freshness.updatedAtIso);
  const stale = isDataStale();
  const label = !updated
    ? 'Waiting for Planning Center'
    : stale
      ? `Planning Center data may be outdated · last updated ${updated}`
      : `Planning Center updated ${updated}`;

  document.querySelectorAll('[data-last-updated]').forEach((el) => {
    el.textContent = label;
    el.classList.toggle('is-stale', Boolean(updated && stale));
  });
  document.body.classList.toggle('pco-stale', Boolean(updated && stale));
  updateAdminStatus();
}

function renderDebug(planningCenter, groups) {
  const panel = $('debugPanel');
  const content = $('debugContent');
  if (!panel || !content || !debugEnabled) return;
  panel.hidden = false;

  const rows = asArray(planningCenter.teamMembers).map((m) => `
    <tr><td>${escapeHtml(personName(m))}</td><td>${escapeHtml(first(m.teamName, m.team, ''))}</td><td>${escapeHtml(first(m.teamPositionName, m.role, ''))}</td><td>${escapeHtml(first(m.status, ''))}</td></tr>`).join('');
  const items = asArray(planningCenter.items).map((i) => `
    <tr><td>${escapeHtml(i.sequence)}</td><td>${escapeHtml(i.title)}</td><td>${escapeHtml(i.itemType)}</td><td>${i.songId ? 'yes' : ''}</td><td>${escapeHtml(i.keyName || '')}</td></tr>`).join('');

  content.innerHTML = `
    <p>Detected: ${groups.communication.length} unmatched communication positions, ${groups.support.length} support, ${groups.worshipServiceLead.length} worship service lead, ${groups.worshipLead.length} worship lead, ${groups.vocals.length} vocals, ${groups.band.length} band.</p>
    <h3>Raw Team Assignments</h3>
    <table class="debug-table"><thead><tr><th>Name</th><th>Team</th><th>Position</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Raw Plan Items</h3>
    <table class="debug-table"><thead><tr><th>Seq</th><th>Title</th><th>Type</th><th>Song</th><th>Key</th></tr></thead><tbody>${items}</tbody></table>`;
}

// Last good Planning Center data for each view (the TV plan, or a device
// preview). If Planning Center stops answering, the screens keep showing it.
const lastGoodByView = new Map();

function withFallback(payload) {
  const dashboard = payload?.dashboard || payload || {};
  const planningCenter = dashboard.planningCenter || {};
  const key = viewKey();

  if (planningCenter.connected !== false) {
    lastGoodByView.set(key, {
      planningCenter,
      manualBoardContent: dashboard.manualBoardContent || {}
    });
    noteFreshness(planningCenter);
    return { dashboard, fallback: false };
  }

  const lastGood = lastGoodByView.get(key);
  if (!lastGood) {
    noteFreshness(planningCenter, { fallback: true });
    return { dashboard, fallback: false, noData: true };
  }

  noteFreshness(planningCenter, { fallback: true });
  return {
    fallback: true,
    dashboard: {
      ...dashboard,
      planningCenter: { ...lastGood.planningCenter, stale: true },
      manualBoardContent: text(dashboard.manualBoardContent?.planId)
        ? dashboard.manualBoardContent
        : lastGood.manualBoardContent
    }
  };
}

function renderDashboard(payload) {
  const resolved = withFallback(payload);
  const dashboard = resolved.dashboard;
  const planningCenter = dashboard.planningCenter || {};
  latestDashboard = dashboard;

  if (resolved.noData) {
    setError(`Planning Center: ${first(planningCenter.error, 'not connected')}`);
  } else {
    setError('');
  }

  const members = asArray(planningCenter.teamMembers);
  const groups = categorizeMembers(members);
  const vocalCols = Math.min(5, Math.max(3, groups.vocals.length || 3));
  $('vocalsGrid')?.style.setProperty('--vocal-cols', String(vocalCols));

  renderHeader(planningCenter, dashboard);
  renderCommunicationBoard(groups, planningCenter, dashboard.manualBoardContent || {});
  renderPeople('serviceSupportGrid', groups.support, 'Service Support space reserved — no team members scheduled.');

  const worshipServiceLeadSection = $('worshipServiceLeadSection');
  if (worshipServiceLeadSection) worshipServiceLeadSection.hidden = groups.worshipServiceLead.length === 0;
  if (groups.worshipServiceLead.length) {
    renderPeople('worshipServiceLeadGrid', groups.worshipServiceLead, '');
  }

  renderPeople('vocalsGrid', groups.vocals, 'No vocal assignments found.');
  syncWorshipLeadTileSize();
  renderPeople('bandGrid', groups.band, 'No band assignments found.');
  renderSongs(planningCenter.items, groups.singerCandidates);
  renderManualNotes(dashboard.manualBoardContent || {});
  renderOrder(planningCenter.items, groups.singerCandidates);
  renderFooter();
  renderDebug(planningCenter, groups);
  attachImageFitHandlers();
  scheduleAutoFit();

  const seconds = Number(payload?.refreshSeconds || DEFAULT_REFRESH_SECONDS);
  const nextMs = Number.isFinite(seconds) && seconds > 0 ? Math.max(1000, seconds * 1000) : DEFAULT_REFRESH_SECONDS * 1000;
  if (nextMs !== refreshMs) refreshMs = nextMs;
}

let latestDashboard = null;
let refreshSequence = 0;

async function refresh() {
  const sequence = ++refreshSequence;
  const requestedView = viewKey();
  try {
    const response = await fetch(dashboardUrl(), { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Dashboard API returned HTTP ${response.status}`);
    const payload = await response.json();
    // Ignore an answer for a view this device has already switched away from.
    if (sequence === refreshSequence && requestedView === viewKey()) renderDashboard(payload);
  } catch (error) {
    console.error(error);
    // Keep whatever is on screen. Only show an error if nothing ever loaded.
    if (!lastGoodByView.size) setError(error.message || 'Exchange Dashboard could not load.');
    renderFooter();
  } finally {
    if (sequence === refreshSequence) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, refreshMs);
    }
  }
}

function refreshNow() {
  clearTimeout(refreshTimer);
  return refresh();
}

/*
|--------------------------------------------------------------------------
| Admin tools (phones/tablets/PCs that turned them on; never on TVs)
|--------------------------------------------------------------------------
*/

const admin = {
  context: null,      // plans list + TV selection from the server
  loadingPlans: null,
  pendingTvPlanId: null
};

function adminPlanLabel(plan) {
  if (!plan) return '';
  const title = plan.title && plan.title !== 'Untitled Plan' ? plan.title : '';
  return [plan.shortDates || plan.dates, title].filter(Boolean).join(' — ') || String(plan.id || '');
}

function adminPlans() {
  return Array.isArray(admin.context?.plans) ? admin.context.plans : [];
}

function tvSelection() {
  const fromDashboard = latestDashboard?.tvControl;
  const control = fromDashboard || admin.context?.control || {};
  return {
    serviceTypeId: text(control.serviceTypeId || admin.context?.defaultServiceTypeId),
    planId: text(control.planId)
  };
}

// The plan the TVs are actually on. On automatic that is the next upcoming plan.
function tvActualPlanId() {
  const tv = tvSelection();
  return tv.planId || text(adminPlans()[0]?.id);
}

function tvPlanLabel() {
  const tv = tvSelection();
  if (!tv.planId) {
    const upcoming = adminPlans()[0];
    return upcoming ? `Automatic — ${adminPlanLabel(upcoming)}` : 'Automatic — next upcoming plan';
  }
  const plan = adminPlans().find((entry) => String(entry.id) === tv.planId);
  return plan ? adminPlanLabel(plan) : 'A selected plan';
}

function adminEl(id) { return document.getElementById(id); }

function setAdminMessage(message, type = '') {
  const el = adminEl('adminMessage');
  if (!el) return;
  el.textContent = message || '';
  el.dataset.type = type;
}

async function adminJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadAdminPlans() {
  if (admin.loadingPlans) return admin.loadingPlans;
  admin.loadingPlans = adminJson('/api/exchange-input-context')
    .then((context) => {
      admin.context = context;
      renderAdminPlanSelect();
      updateAdminStatus();
    })
    .catch((error) => setAdminMessage(`Plans could not load: ${error.message}`, 'error'))
    .finally(() => { admin.loadingPlans = null; });
  return admin.loadingPlans;
}

function renderAdminPlanSelect() {
  const select = adminEl('adminPlanSelect');
  if (!select) return;
  const preview = devicePreview();
  const plans = adminPlans();
  select.innerHTML = [
    '<option value="">Same as the TVs</option>',
    ...plans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(adminPlanLabel(plan))}</option>`)
  ].join('');
  const selectedId = preview ? String(preview.planId) : '';
  if (selectedId && !plans.some((plan) => String(plan.id) === selectedId)) {
    select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(selectedId)}">Saved preview plan</option>`);
  }
  select.value = selectedId;
}

function updateAdminStatus() {
  if (!adminMode) return;
  const preview = devicePreview();
  const tv = tvSelection();
  const previewing = Boolean(preview && String(preview.planId) !== tvActualPlanId());
  document.body.classList.toggle('device-preview', previewing);

  const toggle = adminEl('adminToggle');
  if (toggle) toggle.dataset.preview = previewing ? '1' : '0';
  const toggleLabel = adminEl('adminToggleLabel');
  if (toggleLabel) toggleLabel.textContent = previewing ? 'Preview · this device only' : 'Tools';

  const tvLabel = adminEl('adminTvPlan');
  if (tvLabel) tvLabel.textContent = tvPlanLabel();

  const deviceLabel = adminEl('adminDeviceNote');
  if (deviceLabel) {
    deviceLabel.textContent = previewing
      ? 'This screen is showing a different plan than the TVs. Only this device is affected.'
      : 'This screen matches the TVs. Picking another plan changes only this device.';
  }

  const pushButton = adminEl('adminPushButton');
  if (pushButton) {
    pushButton.disabled = !previewing;
    pushButton.title = previewing ? '' : 'Pick a plan above first';
  }

  const autoButton = adminEl('adminAutoButton');
  if (autoButton) {
    autoButton.hidden = !tv.planId;  // already automatic: nothing to undo
  }

  const status = adminEl('adminPcoStatus');
  if (status) {
    const updated = formatClockTime(freshness.updatedAtIso);
    status.textContent = updated
      ? `${isDataStale() ? 'May be outdated — last updated' : 'Updated'} ${updated}`
      : 'Waiting for Planning Center';
    status.dataset.stale = isDataStale() ? '1' : '0';
  }
}

function setDevicePreview(planId) {
  const id = text(planId);
  const tv = tvSelection();
  const sameAsTvs = !id || id === tvActualPlanId();
  if (sameAsTvs) {
    storageSet(DEVICE_PREVIEW_KEY, null);
  } else {
    storageSet(DEVICE_PREVIEW_KEY, JSON.stringify({
      serviceTypeId: text(admin.context?.serviceType?.id) || tv.serviceTypeId,
      planId: id
    }));
  }
  renderAdminPlanSelect();
  updateAdminStatus();
  setAdminMessage(sameAsTvs ? 'Back to the TV plan on this device.' : 'Loading that plan on this device…');
  refreshNow().then(() => setAdminMessage(''));
}

async function adminRefreshPlanningCenter() {
  const button = adminEl('adminRefreshButton');
  if (button) button.disabled = true;
  setAdminMessage('Asking Planning Center for the latest…');
  try {
    const preview = devicePreview();
    await adminJson('/api/planning-center/refresh', {
      method: 'POST',
      body: JSON.stringify(preview ? { serviceTypeId: preview.serviceTypeId, planId: preview.planId } : {})
    });
    await refreshNow();
    await loadAdminPlans();
    setAdminMessage(`Refreshed at ${formatClockTime(new Date().toISOString())}. The TVs pick it up within a few seconds.`, 'success');
  } catch (error) {
    setAdminMessage(error.message, error.status === 429 ? '' : 'error');
  } finally {
    if (button) setTimeout(() => { button.disabled = false; }, 3000);
  }
}

function openPinDialog(planId) {
  const dialog = adminEl('adminPinDialog');
  if (!dialog) return;
  admin.pendingTvPlanId = planId;
  const plan = adminPlans().find((entry) => String(entry.id) === String(planId));
  adminEl('adminPinTitle').textContent = planId ? 'Show this plan on the TVs?' : 'Put the TVs back on automatic?';
  adminEl('adminPinPlan').textContent = planId
    ? adminPlanLabel(plan) || 'Selected plan'
    : 'The TVs will follow the next upcoming Exchange plan again.';
  const input = adminEl('adminPinInput');
  input.value = '';
  adminEl('adminPinMessage').textContent = '';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  setTimeout(() => input.focus(), 50);
}

function closePinDialog() {
  const dialog = adminEl('adminPinDialog');
  adminEl('adminPinInput').value = '';
  if (dialog?.open) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }
}

async function submitTvPlanChange(event) {
  event?.preventDefault();
  const pin = text(adminEl('adminPinInput')?.value);
  const message = adminEl('adminPinMessage');
  if (!pin) {
    message.textContent = 'Enter the PIN.';
    return;
  }
  const planId = admin.pendingTvPlanId || '';
  const serviceTypeId = text(admin.context?.serviceType?.id) || tvSelection().serviceTypeId;
  const submit = adminEl('adminPinSubmit');
  submit.disabled = true;
  message.textContent = 'Changing the TVs…';
  try {
    // The PIN is sent once for this change and never saved on this device.
    await adminJson('/api/exchange-control', {
      method: 'POST',
      headers: { 'x-exchange-pin': pin },
      body: JSON.stringify({ serviceTypeId, planId })
    });
    storageSet(DEVICE_PREVIEW_KEY, null);
    closePinDialog();
    await refreshNow();
    await loadAdminPlans();
    setAdminMessage(planId ? 'The TVs now show this plan.' : 'The TVs are back on the automatic upcoming plan.', 'success');
  } catch (error) {
    message.textContent = error.status === 401 ? 'That PIN is not correct.' : error.message;
  } finally {
    submit.disabled = false;
    adminEl('adminPinInput').value = '';
  }
}

function setupAdminTools() {
  const toolsLink = adminEl('toolsLink');
  if (toolsLink) {
    if (adminMode || tvMode) toolsLink.remove();
    else {
      const query = new URLSearchParams(location.search);
      query.set('admin', '1');
      toolsLink.href = `${location.pathname}?${query}`;
    }
  }

  const root = adminEl('adminTools');
  if (!root) return;
  if (!adminMode) {
    root.remove();
    return;
  }
  root.hidden = false;

  const toggle = adminEl('adminToggle');
  const panel = adminEl('adminPanel');
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) loadAdminPlans();
  });

  adminEl('adminPlanSelect').addEventListener('change', (event) => setDevicePreview(event.target.value));
  adminEl('adminRefreshButton').addEventListener('click', adminRefreshPlanningCenter);
  adminEl('adminPushButton').addEventListener('click', () => {
    const preview = devicePreview();
    if (preview) openPinDialog(preview.planId);
  });
  adminEl('adminAutoButton').addEventListener('click', () => openPinDialog(''));
  adminEl('adminHideButton').addEventListener('click', () => {
    storageSet(ADMIN_DEVICE_KEY, null);
    storageSet(DEVICE_PREVIEW_KEY, null);
    location.reload();
  });
  adminEl('adminPinForm').addEventListener('submit', submitTvPlanChange);
  adminEl('adminPinCancel').addEventListener('click', closePinDialog);

  loadAdminPlans();
}

setupControllerLink();
setupScreenMode();
setupAdminTools();
// Re-check freshness even if this device loses its own connection.
setInterval(renderFooter, 15000);
window.addEventListener('resize', scheduleAutoFit, { passive: true });
window.addEventListener('orientationchange', scheduleAutoFit, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleAutoFit, { passive: true });
if (document.fonts?.ready) document.fonts.ready.then(scheduleAutoFit).catch(() => {});
refresh();
