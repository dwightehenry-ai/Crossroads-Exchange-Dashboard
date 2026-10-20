
function setupControllerLink() {
  const link = document.getElementById('controllerLink');
  if (!link) return;
  link.href = `http://${window.location.hostname}:3002/`;
  link.target = '_blank';
  link.rel = 'noopener';
}

setupControllerLink();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/dashboard-manager-sw.js').catch(() => {});
}

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const serviceTypeSelect = $("serviceTypeSelect");
  const planSelect = $("planSelect");
  const usePlanButton = $("usePlanButton");
  const autoPlanButton = $("autoPlanButton");
  const activePlanBadge = $("activePlanBadge");
  const editingPlanLabel = $("editingPlanLabel");
  const planMessage = $("planMessage");
  const manualMessage = $("manualMessage");
  const accessBanner = $("accessBanner");
  const manualForm = $("manualForm");
  const managerUnlock = $("managerUnlock");
  const managerPinInput = $("managerPinInput");
  const managerUnlockButton = $("managerUnlockButton");
  const unlockMessage = $("unlockMessage");
  const MANAGER_PIN_KEY = "exchangeDashboardManagerPin";
  const announcementsInput = $("announcementsInput");
  const verseInput = $("verseInput");
  const tvPinInput = $("tvPinInput");
  const pcoStatus = $("pcoStatus");
  const refreshPcoButton = $("refreshPcoButton");
  const previewLink = $("previewLink");
  const adminDeviceToggle = $("adminDeviceToggle");
  const ADMIN_DEVICE_KEY = "exchangeAdminDevice";
  const DEVICE_PREVIEW_KEY = "exchangeDevicePreview";

  let context = null;
  let canWrite = true;

  function setMessage(element, text, type = "") {
    element.textContent = text || "";
    element.className = "message" + (type ? ` ${type}` : "");
  }

  function managerPin() {
    return String(managerPinInput?.value || localStorage.getItem(MANAGER_PIN_KEY) || "").trim();
  }

  async function requestJson(url, options = {}) {
    // options.pin: use exactly this PIN (TV changes), never the saved one.
    const pin = options.pin !== undefined ? options.pin : managerPin();
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(pin ? { "x-exchange-pin": pin } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.detail || payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function planLabel(plan) {
    if (!plan) return "";
    const title = plan.title && plan.title !== "Untitled Plan" ? plan.title : "";
    const date = plan.shortDates || plan.dates || "";
    const series = plan.seriesTitle || "";
    return [date, title, series].filter(Boolean).join(" — ") || String(plan.id || "");
  }

  function selectedServiceType() {
    const id = String(serviceTypeSelect.value || "");
    return context?.serviceTypes?.find((entry) => String(entry.id) === id) || context?.serviceType || null;
  }

  function selectedPlan() {
    const id = String(planSelect.value || "");
    return context?.plans?.find((plan) => String(plan.id) === id) || null;
  }

  function renderServiceTypes(serviceTypes, preferredId) {
    const items = Array.isArray(serviceTypes) ? serviceTypes : [];
    serviceTypeSelect.innerHTML = items.length
      ? items.map((serviceType) =>
          `<option value="${escapeHtml(serviceType.id)}">${escapeHtml(serviceType.name)}</option>`
        ).join("")
      : '<option value="">No Exchange service types found</option>';

    const validPreferred = items.some((entry) => String(entry.id) === String(preferredId || ""));
    if (validPreferred) {
      serviceTypeSelect.value = String(preferredId);
    } else if (items[0]) {
      serviceTypeSelect.value = String(items[0].id);
    }
    serviceTypeSelect.disabled = !items.length;
  }

  function renderPlans(plans, preferredId = "") {
    const items = Array.isArray(plans) ? plans : [];
    planSelect.innerHTML = [
      '<option value="">Select an Exchange service plan</option>',
      ...items.map((plan) =>
        `<option value="${escapeHtml(plan.id)}">${escapeHtml(planLabel(plan))}</option>`
      )
    ].join("");

    if (items.some((plan) => String(plan.id) === String(preferredId || ""))) {
      planSelect.value = String(preferredId);
    } else if (items[0]) {
      planSelect.value = String(items[0].id);
    }
  }

  function updateActiveBadge() {
    const control = context?.control || {};
    const controlServiceTypeId = String(control.serviceTypeId || context?.defaultServiceTypeId || "");
    const activeServiceType = context?.serviceTypes?.find(
      (entry) => String(entry.id) === controlServiceTypeId
    );
    const serviceName = activeServiceType?.name || context?.serviceType?.name || "Exchange service";
    const activePlanId = String(control.planId || "");

    if (!activePlanId) {
      activePlanBadge.textContent = `ACTIVE: ${serviceName} — AUTOMATIC UPCOMING PLAN`;
      return;
    }

    const activePlan =
      String(context?.serviceType?.id || "") === controlServiceTypeId
        ? context?.plans?.find((plan) => String(plan.id) === activePlanId)
        : null;

    activePlanBadge.textContent = activePlan
      ? `ACTIVE: ${serviceName} — ${planLabel(activePlan)}`
      : `ACTIVE: ${serviceName} — SAVED PLAN`;
  }

  async function checkAccess() {
    try {
      const payload = await requestJson("/api/control-access");
      canWrite = Boolean(payload.allowed);
    } catch {
      canWrite = false;
    }
    // TV changes are not gated here: they always ask for the PIN on the spot.
    $("saveManualButton").disabled = !canWrite;
    $("noteSaveButton").disabled = !canWrite;
    renderNotes();
    managerUnlock.hidden = canWrite;
    accessBanner.hidden = canWrite;
    if (!canWrite) {
      accessBanner.textContent = "Dashboard Manager is available on this device. Enter the Dashboard Control PIN below to enable editing.";
    }
    return canWrite;
  }

  if (managerPinInput) {
    managerPinInput.value = localStorage.getItem(MANAGER_PIN_KEY) || "";
  }

  managerUnlockButton?.addEventListener("click", async () => {
    const pin = String(managerPinInput?.value || "").trim();
    if (!pin) {
      setMessage(unlockMessage, "Enter the Dashboard Control PIN.", "error");
      return;
    }
    localStorage.setItem(MANAGER_PIN_KEY, pin);
    setMessage(unlockMessage, "Checking PIN…");
    const allowed = await checkAccess();
    if (allowed) {
      setMessage(unlockMessage, "Dashboard Manager unlocked.", "success");
    } else {
      localStorage.removeItem(MANAGER_PIN_KEY);
      setMessage(unlockMessage, "Incorrect PIN.", "error");
    }
  });

  async function loadContext(serviceTypeId = "") {
    setMessage(planMessage, "Loading Exchange service types and plans…");
    const suffix = serviceTypeId
      ? `?serviceTypeId=${encodeURIComponent(serviceTypeId)}`
      : "";

    const nextContext = await requestJson(`/api/exchange-input-context${suffix}`);
    context = nextContext;

    const serviceTypes = Array.isArray(context.serviceTypes) ? context.serviceTypes : [];
    const currentServiceTypeId = String(context.serviceType?.id || context.control?.serviceTypeId || context.defaultServiceTypeId || "");
    renderServiceTypes(serviceTypes, currentServiceTypeId);

    const controlMatchesCurrentType =
      String(context.control?.serviceTypeId || context.defaultServiceTypeId || "") ===
      String(context.serviceType?.id || "");
    const preferredPlanId = controlMatchesCurrentType
      ? String(context.control?.planId || "")
      : "";

    renderPlans(context.plans, preferredPlanId);
    updateActiveBadge();

    const planCount = Array.isArray(context.plans) ? context.plans.length : 0;
    const serviceName = context.serviceType?.name || selectedServiceType()?.name || "Exchange service";
    setMessage(
      planMessage,
      planCount
        ? `${planCount} upcoming plan${planCount === 1 ? "" : "s"} loaded for ${serviceName}.`
        : `No upcoming plans were returned for ${serviceName}.`
    );

    await loadManualContent();
  }

  async function loadManualContent() {
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    updatePreviewLink();
    loadNotes();
    if (!plan || !serviceType) {
      editingPlanLabel.textContent = "Select a plan";
      announcementsInput.value = "";
      verseInput.value = "";
      setMessage(manualMessage, "Select an Exchange service plan to load its manual inputs.");
      return;
    }

    editingPlanLabel.textContent = `${serviceType.name} — ${planLabel(plan)}`;
    setMessage(manualMessage, "Loading saved inputs…");
    const payload = await requestJson(
      `/api/manual-board-content?serviceTypeId=${encodeURIComponent(serviceType.id)}&planId=${encodeURIComponent(plan.id)}`
    );
    announcementsInput.value = payload.content?.announcements || "";
    verseInput.value = payload.content?.verseOfDay || "";
    setMessage(
      manualMessage,
      payload.content?.updatedAt
        ? "Saved inputs loaded."
        : "No manual inputs have been saved for this plan yet."
    );
  }

  serviceTypeSelect.addEventListener("change", async () => {
    try {
      const serviceTypeId = String(serviceTypeSelect.value || "");
      if (!serviceTypeId) return;
      setMessage(manualMessage, "");
      await loadContext(serviceTypeId);
    } catch (error) {
      setMessage(planMessage, error.message, "error");
    }
  });

  planSelect.addEventListener("change", () => {
    loadManualContent().catch((error) =>
      setMessage(manualMessage, error.message, "error")
    );
  });

  function typedTvPin() {
    const pin = String(tvPinInput?.value || "").trim();
    if (!pin) {
      setMessage(planMessage, "Enter the PIN to change what the TVs show.", "error");
      tvPinInput?.focus();
      return "";
    }
    return pin;
  }

  async function changeTvPlan(serviceType, planId, successText) {
    const pin = typedTvPin();
    if (!pin) return;
    try {
      setMessage(planMessage, "Changing the TVs…");
      await requestJson("/api/exchange-control", {
        method: "POST",
        pin,
        body: JSON.stringify({ serviceTypeId: serviceType.id, planId })
      });
      context.control = { serviceTypeId: String(serviceType.id), planId: String(planId) };
      updateActiveBadge();
      setMessage(planMessage, successText, "success");
    } catch (error) {
      setMessage(planMessage, error.status === 401 ? "That PIN is not correct. The TVs did not change." : error.message, "error");
    } finally {
      // The PIN is used once and never kept.
      if (tvPinInput) tvPinInput.value = "";
    }
  }

  usePlanButton.addEventListener("click", () => {
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    if (!plan || !serviceType) {
      setMessage(planMessage, "Select an Exchange service type and service plan first.", "error");
      return;
    }
    changeTvPlan(serviceType, plan.id, `TV 1, TV 2 and TV 3 now show ${planLabel(plan)}.`);
  });

  autoPlanButton.addEventListener("click", () => {
    const serviceType = selectedServiceType();
    if (!serviceType) {
      setMessage(planMessage, "Select an Exchange service type first.", "error");
      return;
    }
    changeTvPlan(serviceType, "", `The TVs will follow the next upcoming ${serviceType.name} plan automatically.`);
  });

  /* ---------- Planning Center status + manual refresh ---------- */

  function clockTime(iso) {
    const date = new Date(iso || "");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function showPcoStatus(status = {}) {
    if (!pcoStatus) return;
    const updated = clockTime(status.lastSuccessAt);
    pcoStatus.dataset.stale = status.stale ? "1" : "0";
    pcoStatus.textContent = !updated
      ? "Not loaded yet. Open the dashboard or press Refresh."
      : status.stale
        ? `May be outdated — last updated ${updated}${status.lastError ? ` (${status.lastError})` : ""}`
        : `Planning Center updated ${updated}`;
  }

  async function loadPcoStatus() {
    try {
      showPcoStatus(await requestJson("/api/planning-center/status"));
    } catch {
      if (pcoStatus) pcoStatus.textContent = "Status unavailable";
    }
  }

  refreshPcoButton?.addEventListener("click", async () => {
    refreshPcoButton.disabled = true;
    setMessage(planMessage, "Asking Planning Center for the latest…");
    try {
      const plan = selectedPlan();
      const serviceType = selectedServiceType();
      const payload = await requestJson("/api/planning-center/refresh", {
        method: "POST",
        body: JSON.stringify(plan && serviceType ? { serviceTypeId: serviceType.id, planId: plan.id } : {})
      });
      showPcoStatus(payload.status);
      await loadContext(String(serviceTypeSelect.value || ""));
      setMessage(planMessage, "Planning Center refreshed. The TVs pick it up within a few seconds.", "success");
    } catch (error) {
      setMessage(planMessage, error.message, error.status === 429 ? "" : "error");
      loadPcoStatus();
    } finally {
      setTimeout(() => { refreshPcoButton.disabled = false; }, 3000);
    }
  });

  /* ---------- Device-only preview + tools ---------- */

  function updatePreviewLink() {
    if (!previewLink) return;
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    previewLink.href = plan && serviceType
      ? `/?screen=all&previewPlan=${encodeURIComponent(plan.id)}&previewServiceType=${encodeURIComponent(serviceType.id)}`
      : "/?screen=all&admin=1";
  }

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* private browsing */ }
    return null;
  }

  if (adminDeviceToggle) {
    adminDeviceToggle.checked = storage(ADMIN_DEVICE_KEY) === "1";
    adminDeviceToggle.addEventListener("change", () => {
      storage(ADMIN_DEVICE_KEY, adminDeviceToggle.checked ? "1" : null);
      if (!adminDeviceToggle.checked) storage(DEVICE_PREVIEW_KEY, null);
    });
  }

  /* ---------- Plan notes ---------- */

  const noteForm = $("noteForm");
  const noteTextInput = $("noteTextInput");
  const noteCategoryInput = $("noteCategoryInput");
  const notePinnedInput = $("notePinnedInput");
  const noteSaveButton = $("noteSaveButton");
  const noteCancelButton = $("noteCancelButton");
  const noteFormLabel = $("noteFormLabel");
  const notesList = $("notesList");
  const notesMessage = $("notesMessage");
  const notesPlanLabel = $("notesPlanLabel");
  let notes = [];
  let editingNoteId = null;
  let notesRequest = 0;

  function notePlanBody(extra = {}) {
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    return { serviceTypeId: serviceType?.id, planId: plan?.id, planLabel: planLabel(plan), ...extra };
  }

  function categoryClass(category) {
    return String(category || "General").toLowerCase().replace(/[^a-z]+/g, "-");
  }

  function renderNotes() {
    if (!notesList) return;
    const plan = selectedPlan();
    if (!plan) {
      notesList.innerHTML = '<li class="notes-empty">Select a plan to see its notes.</li>';
      return;
    }
    if (!notes.length) {
      notesList.innerHTML = '<li class="notes-empty">No notes for this plan yet.</li>';
      return;
    }
    notesList.innerHTML = notes.map((note) => `
      <li class="note-item${note.pinned ? " is-pinned" : ""}" data-id="${escapeHtml(note.id)}">
        <div>
          <div class="note-item-tags">
            ${note.pinned ? '<span class="note-tag pin">Pinned</span>' : ""}
            <span class="note-tag cat-${categoryClass(note.category)}">${escapeHtml(note.category)}</span>
          </div>
          <div class="note-item-text">${escapeHtml(note.text)}</div>
        </div>
        <div class="note-actions">
          <button class="secondary-button" type="button" data-action="pin" ${canWrite ? "" : "disabled"}>${note.pinned ? "Unpin" : "Pin"}</button>
          <button class="secondary-button" type="button" data-action="edit" ${canWrite ? "" : "disabled"}>Edit</button>
          <button class="secondary-button danger" type="button" data-action="delete" ${canWrite ? "" : "disabled"}>Delete</button>
        </div>
      </li>`).join("");
  }

  function resetNoteForm() {
    editingNoteId = null;
    noteForm?.classList.remove("is-editing");
    if (noteTextInput) noteTextInput.value = "";
    if (noteCategoryInput) noteCategoryInput.value = "General";
    if (notePinnedInput) notePinnedInput.checked = false;
    if (noteSaveButton) noteSaveButton.textContent = "Add Note";
    if (noteFormLabel) noteFormLabel.textContent = "New note";
    if (noteCancelButton) noteCancelButton.hidden = true;
  }

  async function loadNotes() {
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    const request = ++notesRequest;
    resetNoteForm();
    if (notesPlanLabel) notesPlanLabel.textContent = plan ? planLabel(plan) : "Select a plan";
    if (!plan || !serviceType) {
      notes = [];
      renderNotes();
      return;
    }
    try {
      const payload = await requestJson(
        `/api/notes?serviceTypeId=${encodeURIComponent(serviceType.id)}&planId=${encodeURIComponent(plan.id)}`
      );
      if (request !== notesRequest) return;
      notes = Array.isArray(payload.notes) ? payload.notes : [];
      renderNotes();
      setMessage(notesMessage, "");
    } catch (error) {
      setMessage(notesMessage, error.message, "error");
    }
  }

  async function saveNotesChange(url, method, body, successText) {
    try {
      const payload = await requestJson(url, { method, body: JSON.stringify(body) });
      notes = Array.isArray(payload.notes) ? payload.notes : notes;
      renderNotes();
      setMessage(notesMessage, successText, "success");
      return true;
    } catch (error) {
      setMessage(notesMessage, error.status === 401 ? "Unlock the Manager with the PIN to edit notes." : error.message, "error");
      return false;
    }
  }

  noteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedPlan()) {
      setMessage(notesMessage, "Select a plan first.", "error");
      return;
    }
    const text = String(noteTextInput.value || "").trim();
    if (!text) {
      setMessage(notesMessage, "Type the note first.", "error");
      noteTextInput.focus();
      return;
    }
    const body = notePlanBody({ text, category: noteCategoryInput.value, pinned: notePinnedInput.checked });
    const ok = editingNoteId
      ? await saveNotesChange(`/api/notes/${encodeURIComponent(editingNoteId)}`, "PUT", body, "Note updated.")
      : await saveNotesChange("/api/notes", "POST", body, "Note added.");
    if (ok) resetNoteForm();
  });

  noteCancelButton?.addEventListener("click", () => {
    resetNoteForm();
    setMessage(notesMessage, "");
  });

  notesList?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.closest("[data-id]")?.dataset.id;
    const note = notes.find((entry) => String(entry.id) === String(id));
    if (!note) return;
    const action = button.dataset.action;

    if (action === "edit") {
      editingNoteId = note.id;
      noteForm.classList.add("is-editing");
      noteTextInput.value = note.text;
      noteCategoryInput.value = note.category;
      notePinnedInput.checked = Boolean(note.pinned);
      noteSaveButton.textContent = "Save Changes";
      noteFormLabel.textContent = "Edit note";
      noteCancelButton.hidden = false;
      noteTextInput.focus();
      noteForm.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (action === "pin") {
      await saveNotesChange(
        `/api/notes/${encodeURIComponent(note.id)}`, "PUT",
        notePlanBody({ pinned: !note.pinned }),
        note.pinned ? "Note unpinned." : "Note pinned to the top."
      );
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`Delete this note?\n\n${note.text}`)) return;
      const plan = notePlanBody();
      const ok = await saveNotesChange(
        `/api/notes/${encodeURIComponent(note.id)}?serviceTypeId=${encodeURIComponent(plan.serviceTypeId)}&planId=${encodeURIComponent(plan.planId)}`,
        "DELETE", plan, "Note deleted."
      );
      if (ok && editingNoteId === note.id) resetNoteForm();
    }
  });

  manualForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    if (!plan || !serviceType) {
      setMessage(manualMessage, "Select an Exchange service type and service plan first.", "error");
      return;
    }
    try {
      setMessage(manualMessage, "Saving Exchange inputs…");
      await requestJson("/api/manual-board-content", {
        method: "POST",
        body: JSON.stringify({
          serviceTypeId: serviceType.id,
          serviceTypeName: serviceType.name,
          planId: plan.id,
          planLabel: planLabel(plan),
          announcements: announcementsInput.value,
          verseOfDay: verseInput.value
        })
      });
      setMessage(manualMessage, "Inputs saved for this Exchange plan.", "success");
    } catch (error) {
      setMessage(manualMessage, error.message, "error");
    }
  });

  Promise.all([checkAccess(), loadContext()]).catch((error) => {
    setMessage(planMessage, error.message, "error");
  });
  loadPcoStatus();
  setInterval(loadPcoStatus, 30000);
})();
