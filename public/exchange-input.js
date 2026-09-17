
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
  const worshipNotesInput = $("worshipNotesInput");

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
    const pin = managerPin();
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
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
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
    usePlanButton.disabled = !canWrite;
    autoPlanButton.disabled = !canWrite;
    $("saveManualButton").disabled = !canWrite;
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
    if (!plan || !serviceType) {
      editingPlanLabel.textContent = "Select a plan";
      announcementsInput.value = "";
      verseInput.value = "";
      worshipNotesInput.value = "";
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
    worshipNotesInput.value = payload.content?.worshipNotes || "";
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

  usePlanButton.addEventListener("click", async () => {
    const plan = selectedPlan();
    const serviceType = selectedServiceType();
    if (!plan || !serviceType) {
      setMessage(planMessage, "Select an Exchange service type and service plan first.", "error");
      return;
    }
    try {
      setMessage(planMessage, "Applying plan to all Exchange TVs…");
      await requestJson("/api/exchange-control", {
        method: "POST",
        body: JSON.stringify({
          serviceTypeId: serviceType.id,
          planId: plan.id
        })
      });
      context.control = {
        serviceTypeId: String(serviceType.id),
        planId: String(plan.id)
      };
      updateActiveBadge();
      setMessage(planMessage, "Selected service type and plan are now used by TV 1, TV 2, and TV 3.", "success");
    } catch (error) {
      setMessage(planMessage, error.message, "error");
    }
  });

  autoPlanButton.addEventListener("click", async () => {
    const serviceType = selectedServiceType();
    if (!serviceType) {
      setMessage(planMessage, "Select an Exchange service type first.", "error");
      return;
    }
    try {
      setMessage(planMessage, "Returning the Exchange TVs to this service type's automatic upcoming plan…");
      await requestJson("/api/exchange-control", {
        method: "POST",
        body: JSON.stringify({
          serviceTypeId: serviceType.id,
          planId: ""
        })
      });
      context.control = {
        serviceTypeId: String(serviceType.id),
        planId: ""
      };
      updateActiveBadge();
      setMessage(planMessage, `The TVs will now use the next upcoming plan for ${serviceType.name} automatically.`, "success");
    } catch (error) {
      setMessage(planMessage, error.message, "error");
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
          verseOfDay: verseInput.value,
          worshipNotes: worshipNotesInput.value
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
})();
