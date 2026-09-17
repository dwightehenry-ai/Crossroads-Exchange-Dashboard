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

function renderManualNotes(manualBoardContent = {}) {
  const el = $('manualNotesContent');
  if (!el) return;
  const notes = textLines(manualBoardContent.worshipNotes);
  el.innerHTML = notes.length
    ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
    : '<div class="notes-empty-text">No notes entered.</div>';
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
  const planTitle = first(planningCenter.planTitle, dashboard.header?.plan, 'THE EXCHANGE');
  document.querySelectorAll('[data-plan-date]').forEach((el) => { el.textContent = planDate; });
  document.querySelectorAll('[data-plan-title]').forEach((el) => { el.textContent = planTitle; });
}

function renderFooter() {
  const stamp = `UPDATED ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  document.querySelectorAll('[data-last-updated]').forEach((el) => { el.textContent = stamp; });
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

function renderDashboard(payload) {
  const dashboard = payload?.dashboard || payload || {};
  const planningCenter = dashboard.planningCenter || {};

  if (planningCenter.connected === false) {
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

async function refresh() {
  try {
    const response = await fetch(API_URL, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Dashboard API returned HTTP ${response.status}`);
    const payload = await response.json();
    renderDashboard(payload);
  } catch (error) {
    console.error(error);
    setError(error.message || 'Exchange Dashboard could not load.');
  } finally {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, refreshMs);
  }
}

setupControllerLink();
setupScreenMode();
window.addEventListener('resize', scheduleAutoFit, { passive: true });
window.addEventListener('orientationchange', scheduleAutoFit, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleAutoFit, { passive: true });
if (document.fonts?.ready) document.fonts.ready.then(scheduleAutoFit).catch(() => {});
refresh();
