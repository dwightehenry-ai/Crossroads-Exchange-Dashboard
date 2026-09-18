'use strict';

const express = require("express");
const fs = require("fs");
const path = require("path");
const net = require("net");
const os = require("os");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");

const app = express();

/*
|--------------------------------------------------------------------------
| Project paths
|--------------------------------------------------------------------------
*/

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");

const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const EXAMPLE_CONFIG_PATH = path.join(ROOT_DIR, "config.example.json");
const DEMO_PATH = path.join(DATA_DIR, "demo.json");
const MANUAL_GUESTS_PATH = path.join(
  DATA_DIR,
  "manual-guests.json"
);
const MANUAL_BOARD_CONTENT_PATH = path.join(
  DATA_DIR,
  "manual-board-content.json"
);

// Confirmed ATEM 1 M/E Production Studio 4K switcher address.
// A host set in config.json still takes priority if the address changes later.
const DEFAULT_ATEM_IP_ADDRESS = "192.168.10.240";

app.use(express.json());

/*
|--------------------------------------------------------------------------
| EXCHANGE SERVER ONLY CONTROL
|--------------------------------------------------------------------------
*/

const EXCHANGE_CONTROL_FILE =
  path.join(DATA_DIR, "exchange-control.json");

function normalizeControlAddress(value) {
  return String(value || "")
    .replace(/^::ffff:/, "")
    .replace(/%.+$/, "")
    .trim()
    .toLowerCase();
}

function serverComputerAddresses() {
  const addresses = new Set([
    "127.0.0.1",
    "::1"
  ]);

  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry && entry.address) {
        addresses.add(
          normalizeControlAddress(entry.address)
        );
      }
    }
  }

  return addresses;
}

function isServerComputerRequest(req) {
  const address = normalizeControlAddress(
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.ip ||
    ""
  );

  return serverComputerAddresses().has(address);
}

const EXCHANGE_MANAGER_PIN = String(
  process.env.EXCHANGE_MANAGER_PIN ||
  process.env.EXCHANGE_CONTROLLER_PIN ||
  "1386"
);

function requireServerComputer(req, res, next) {
  if (isServerComputerRequest(req)) {
    return next();
  }

  return res.status(403).send(
    "The Exchange Dashboard Control is available only on the dashboard server computer."
  );
}

function isDashboardManagerAuthorized(req) {
  if (isServerComputerRequest(req)) return true;
  return String(req.headers["x-exchange-pin"] || "") === EXCHANGE_MANAGER_PIN;
}

function requireDashboardManager(req, res, next) {
  if (isDashboardManagerAuthorized(req)) {
    return next();
  }

  return res.status(401).json({
    error: "Dashboard Manager PIN required",
    detail: "Enter the Exchange Dashboard Control PIN to save changes from this device."
  });
}

function loadExchangeControl() {
  try {
    // Exchange control state is intentionally independent from the
    // Green Room dashboard. Never fall back to green-room-control.json.
    if (!fs.existsSync(EXCHANGE_CONTROL_FILE)) {
      return {
        serviceTypeId: "",
        planId: ""
      };
    }

    const data = JSON.parse(
      fs.readFileSync(
        EXCHANGE_CONTROL_FILE,
        "utf8"
      )
    );

    return {
      serviceTypeId:
        String(data.serviceTypeId || ""),
      planId:
        String(data.planId || "")
    };
  } catch (error) {
    console.warn(
      "Could not read Exchange control state:",
      error.message
    );

    return {
      serviceTypeId: "",
      planId: ""
    };
  }
}

function saveExchangeControl(
  serviceTypeId,
  planId
) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });

  fs.writeFileSync(
    EXCHANGE_CONTROL_FILE,
    JSON.stringify(
      {
        serviceTypeId:
          String(serviceTypeId || ""),
        planId:
          String(planId || ""),
        updatedAt:
          new Date().toISOString()
      },
      null,
      2
    )
  );
}

app.get(
  "/api/control-access",
  (req, res) => {
    res.json({
      allowed: isDashboardManagerAuthorized(req),
      serverComputer: isServerComputerRequest(req)
    });
  }
);

app.get(
  "/setup.html",
  requireServerComputer,
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "setup.html"
      )
    );
  }
);

app.get(
  "/exchange-input.html",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "exchange-input.html"
      )
    );
  }
);

app.get("/tv1", (req, res) => res.redirect(302, "/?screen=1"));
app.get("/tv2", (req, res) => res.redirect(302, "/?screen=2"));
app.get("/tv3", (req, res) => res.redirect(302, "/?screen=3"));
app.get("/all", (req, res) => res.redirect(302, "/?screen=all"));

app.use(express.static(PUBLIC_DIR));

/*
|--------------------------------------------------------------------------
| Local JSON files
|--------------------------------------------------------------------------
*/

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadConfig() {
  const fs.existsSync(CONFIG_PATH)
    ? readJson(CONFIG_PATH)
    : readJson(EXAMPLE_CONFIG_PATH);
}

function loadDemo() {
  return readJson(DEMO_PATH);
}

function loadManualGuests() {
  if (!fs.existsSync(MANUAL_GUESTS_PATH)) {
    return [];
  }

  try {
    const stored = readJson(MANUAL_GUESTS_PATH);

    return Array.isArray(stored)
      ? stored
      : Array.isArray(stored?.guests)
        ? stored.guests
        : [];
  } catch (error) {
    console.warn(
      "Manual guest data could not be read:",
      error.message
    );

    return [];
  }
}

function saveManualGuests(guests) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const temporaryPath = `${MANUAL_GUESTS_PATH}.tmp`;
  const payload = {
    guests,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(payload, null, 2)
  );

  fs.renameSync(temporaryPath, MANUAL_GUESTS_PATH);
}


function loadManualBoardContent() {
  if (!fs.existsSync(MANUAL_BOARD_CONTENT_PATH)) {
    return [];
  }

  try {
    const stored = readJson(MANUAL_BOARD_CONTENT_PATH);
    return Array.isArray(stored)
      ? stored
      : Array.isArray(stored?.entries)
        ? stored.entries
        : [];
  } catch (error) {
    console.warn(
      "Manual board content could not be read:",
      error.message
    );
    return [];
  }
}

function saveManualBoardContent(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = `${MANUAL_BOARD_CONTENT_PATH}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(
      {
        entries,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  fs.renameSync(temporaryPath, MANUAL_BOARD_CONTENT_PATH);
}

function cleanManualBoardText(value, maxLength = 4000) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .slice(0, maxLength)
    .trim();
}

function manualBoardContentForPlan(serviceTypeId, planId) {
  const serviceId = String(serviceTypeId || "").trim();
  const selectedPlanId = String(planId || "").trim();
  if (!serviceId || !selectedPlanId) return null;

  return loadManualBoardContent().find((entry) =>
    String(entry?.serviceTypeId || "") === serviceId &&
    String(entry?.planId || "") === selectedPlanId
  ) || null;
}

function upsertManualBoardContent(input = {}) {
  const serviceTypeId = cleanManualBoardText(input.serviceTypeId, 80);
  const planId = cleanManualBoardText(input.planId, 80);
  if (!serviceTypeId || !planId) {
    throw new Error("serviceTypeId and planId are required");
  }

  const entries = loadManualBoardContent();
  const existingIndex = entries.findIndex((entry) =>
    String(entry?.serviceTypeId || "") === serviceTypeId &&
    String(entry?.planId || "") === planId
  );

  const record = {
    serviceTypeId,
    serviceTypeName: cleanManualBoardText(input.serviceTypeName, 120),
    planId,
    planLabel: cleanManualBoardText(input.planLabel, 250),
    announcements: cleanManualBoardText(input.announcements, 5000),
    verseOfDay: cleanManualBoardText(input.verseOfDay, 2000),
    worshipNotes: cleanManualBoardText(input.worshipNotes, 5000),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) entries[existingIndex] = record;
  else entries.push(record);

  saveManualBoardContent(entries);
  return record;
}

/*
|--------------------------------------------------------------------------
| Manual status overrides
|--------------------------------------------------------------------------
*/

const overrides = {
  planningCenter: "auto",
  proPresenter: "auto",
  atem: "auto",
  audio: "auto",
  streamDeck: "auto",
  etcIon: "auto",
  live: "auto"
};

function statusRecord(state, label, detail = "") {
  return {
    state,
    label,
    detail,
    checkedAt: new Date().toISOString()
  };
}

function applyOverride(key, automaticStatus) {
  const value = overrides[key] || "auto";

  if (value === "auto") {
    return automaticStatus;
  }

  return statusRecord(
    value,
    automaticStatus.label,
    "Manual override"
  );
}

/*
|--------------------------------------------------------------------------
| Planning Center authentication
|--------------------------------------------------------------------------
*/

function createPlanningCenterAuth(config) {
  const pco = config.planningCenter;

  if (!pco?.enabled) {
    throw new Error("Planning Center is not enabled");
  }

  if (!pco.applicationId || !pco.secret) {
    throw new Error("Planning Center credentials are missing");
  }

  return Buffer.from(
    `${pco.applicationId}:${pco.secret}`
  ).toString("base64");
}

async function planningCenterRequest(
  config,
  endpoint,
  timeoutMs = 15000
) {
  const auth = createPlanningCenterAuth(config);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const requestUrl = endpoint.startsWith("http")
      ? endpoint
      : `https://api.planningcenteronline.com${endpoint}`;

    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "User-Agent": "Crossroads-Exchange-Dashboard"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      let detail = "";

      try {
        const errorBody = await response.json();

        detail =
          errorBody?.errors?.[0]?.detail ||
          errorBody?.errors?.[0]?.title ||
          "";
      } catch {
        // Error response was not JSON.
      }

      throw new Error(
        `Planning Center returned HTTP ${response.status}` +
          (detail ? `: ${detail}` : "")
      );
    }

    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Planning Center request timed out for ${endpoint}`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/*
|--------------------------------------------------------------------------
| Planning Center dashboard cache
|--------------------------------------------------------------------------
*/

const PLANNING_CENTER_CORE_CACHE_MS = 30 * 1000;
const PLANNING_CENTER_LIVE_CACHE_MS = 4 * 1000;

const planningCenterCoreCache = new Map();
const planningCenterCorePending = new Map();
const planningCenterLiveCache = new Map();
const planningCenterLivePending = new Map();

function planningCenterCacheKey(
  serviceTypeId,
  planId = "upcoming"
) {
  return `${String(serviceTypeId || "")}:${String(
    planId || "upcoming"
  )}`;
}

async function getPlanningCenterCoreData(
  config,
  serviceTypeId,
  requestedPlanId = ""
) {
  const cacheKey = planningCenterCacheKey(
    serviceTypeId,
    requestedPlanId || "upcoming"
  );

  const now = Date.now();
  const cached = planningCenterCoreCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return {
      ...cached.data,
      cached: true,
      stale: false,
      lastUpdatedAt: cached.updatedAt
    };
  }

  if (planningCenterCorePending.has(cacheKey)) {
    return planningCenterCorePending.get(cacheKey);
  }

  const request = (async () => {
    try {
      const plan = requestedPlanId
        ? await getPlanningCenterPlan(
            config,
            serviceTypeId,
            requestedPlanId
          )
        : await getUpcomingPlanningCenterPlan(
            config,
            serviceTypeId
          );

      const [planItems, teamMembers] = await Promise.all([
        getPlanningCenterPlanItems(
          config,
          plan.id,
          serviceTypeId
        ),
        getPlanningCenterTeamMembers(
          config,
          plan.id,
          serviceTypeId
        )
      ]);

      let kingdomBuilders = null;
      let kingdomBuildersError = "";

      try {
        kingdomBuilders =
          await getKingdomBuildersForMonth(
            config,
            serviceTypeId,
            plan,
            planItems
          );
      } catch (error) {
        kingdomBuildersError = error.message;

        console.warn(
          "Kingdom Builders data error:",
          error.message
        );
      }

      const updatedAt = new Date().toISOString();
      const data = {
        plan,
        planItems,
        teamMembers,
        kingdomBuilders,
        kingdomBuildersError
      };

      planningCenterCoreCache.set(cacheKey, {
        data,
        updatedAt,
        expiresAt:
          Date.now() + PLANNING_CENTER_CORE_CACHE_MS
      });

      return {
        ...data,
        cached: false,
        stale: false,
        lastUpdatedAt: updatedAt
      };
    } catch (error) {
      if (cached?.data) {
        console.warn(
          "Planning Center refresh failed; using last successful data:",
          error.message
        );

        return {
          ...cached.data,
          cached: true,
          stale: true,
          cacheError: error.message,
          lastUpdatedAt: cached.updatedAt
        };
      }

      throw error;
    } finally {
      planningCenterCorePending.delete(cacheKey);
    }
  })();

  planningCenterCorePending.set(cacheKey, request);

  return request;
}

async function getCachedPlanningCenterLiveState(
  config,
  planId,
  planItems,
  serviceTypeId
) {
  const cacheKey = planningCenterCacheKey(
    serviceTypeId,
    planId
  );

  const now = Date.now();
  const cached = planningCenterLiveCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return {
      ...cached.data,
      cached: true,
      stale: false,
      lastUpdatedAt: cached.updatedAt
    };
  }

  if (planningCenterLivePending.has(cacheKey)) {
    return planningCenterLivePending.get(cacheKey);
  }

  const request = (async () => {
    try {
      const data = await getPlanningCenterLiveState(
        config,
        planId,
        planItems,
        serviceTypeId
      );

      const updatedAt = new Date().toISOString();

      planningCenterLiveCache.set(cacheKey, {
        data,
        updatedAt,
        expiresAt:
          Date.now() + PLANNING_CENTER_LIVE_CACHE_MS
      });

      return {
        ...data,
        cached: false,
        stale: false,
        lastUpdatedAt: updatedAt
      };
    } catch (error) {
      if (cached?.data) {
        console.warn(
          "Planning Center Live refresh failed; using last successful state:",
          error.message
        );

        return {
          ...cached.data,
          connected: false,
          cached: true,
          stale: true,
          error: error.message,
          lastUpdatedAt: cached.updatedAt
        };
      }

      throw error;
    } finally {
      planningCenterLivePending.delete(cacheKey);
    }
  })();

  planningCenterLivePending.set(cacheKey, request);

  return request;
}

/*
|--------------------------------------------------------------------------
| Planning Center plan
|--------------------------------------------------------------------------
*/

async function getUpcomingPlanningCenterPlan(
  config,
  serviceTypeId = config.planningCenter?.serviceTypeId
) {
  if (!serviceTypeId) {
    throw new Error(
      "Planning Center serviceTypeId is missing from config.json"
    );
  }

  const endpoint =
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}` +
    `/plans?filter=future&order=sort_date&per_page=1`;

  const response = await planningCenterRequest(config, endpoint);
  const plan = response.data?.[0];

  if (!plan) {
    throw new Error("No upcoming Planning Center plan was found");
  }

  return normalizePlanningCenterPlanResource(plan);
}

/*
|--------------------------------------------------------------------------
| Planning Center plan items
|--------------------------------------------------------------------------
*/

async function getPlanningCenterPlanItems(
  config,
  planId,
  serviceTypeId = config.planningCenter?.serviceTypeId
) {
  if (!serviceTypeId) {
    throw new Error(
      "Planning Center serviceTypeId is missing from config.json"
    );
  }

  if (!planId) {
    throw new Error(
      "Planning Center planId is required to retrieve plan items"
    );
  }

  const endpoint =
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}` +
    `/plans/${encodeURIComponent(planId)}` +
    `/items?per_page=100`;

  const response = await planningCenterRequest(config, endpoint);

  return (response.data || [])
    .map((item) => {
      const attributes = item.attributes || {};

      return {
        id: item.id,
        title: attributes.title || "",
        itemType: attributes.item_type || "",
        sequence: attributes.sequence ?? 0,
        servicePosition: attributes.service_position || "",
        length: attributes.length ?? 0,
        description: attributes.description || "",
        keyName: attributes.key_name || "",
        selectedLayout: attributes.selected_layout || "",
        songId: item.relationships?.song?.data?.id || null
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
}

/*
|--------------------------------------------------------------------------
| Kingdom Builders monthly segment
|--------------------------------------------------------------------------
*/

const KINGDOM_BUILDERS_SERVICE_TYPE =
  "Crossroads Sunday Service";
const kingdomBuildersCache = new Map();

function cleanPlanningCenterText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function kingdomBuildersMonth(plan) {
  const date = new Date(
    plan?.sortDate || plan?.dates || Date.now()
  );

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString([], {
      month: "long",
      year: "numeric"
    }).toUpperCase();
  }

  return date.toLocaleDateString([], {
    month: "long",
    year: "numeric"
  }).toUpperCase();
}

function extractKingdomBuildersSegment(planItems, plan) {
  const items = Array.isArray(planItems) ? planItems : [];
  const matchIndex = items.findIndex((item) => {
    const searchable = cleanPlanningCenterText(
      `${item?.title || ""} ${item?.description || ""}`
    ).toLowerCase();

    return searchable.includes("kingdom builders");
  });

  const month = kingdomBuildersMonth(plan);

  if (matchIndex < 0) {
    return {
      available: false,
      month,
      text: "Not listed in the Sunday service plan",
      planId: plan?.id || null,
      planTitle: plan?.title || ""
    };
  }

  const matchedItem = items[matchIndex];
  const description = cleanPlanningCenterText(
    matchedItem.description
  );
  const descriptionRemainder = description
    .replace(/kingdom builders/ig, "")
    .replace(/\b(segment|monthly|month|update)\b/ig, "")
    .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, "")
    .trim();
  const descriptionValue =
    /kingdom builders/i.test(description)
      ? descriptionRemainder
      : description;
  const titleRemainder = cleanPlanningCenterText(
    matchedItem.title
  )
    .replace(/kingdom builders/ig, "")
    .replace(/\b(segment|monthly|month|update)\b/ig, "")
    .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, "")
    .trim();

  const followingTitles = [];

  for (
    let index = matchIndex + 1;
    index < items.length && followingTitles.length < 4;
    index += 1
  ) {
    const item = items[index];
    const itemType = String(item?.itemType || "")
      .trim()
      .toLowerCase();

    if (itemType === "header") {
      break;
    }

    const title = cleanPlanningCenterText(item?.title);

    if (title) {
      followingTitles.push(title);
    }
  }

  const text =
    descriptionValue ||
    titleRemainder ||
    followingTitles.join(" • ") ||
    "Kingdom Builders segment scheduled";

  return {
    available: true,
    month,
    text,
    planId: plan?.id || null,
    planTitle: plan?.title || "",
    sourceItemId: matchedItem.id || null
  };
}

async function getKingdomBuildersForMonth(
  config,
  selectedServiceTypeId,
  selectedPlan,
  selectedPlanItems
) {
  const serviceTypes =
    await getAllowedPlanningCenterServiceTypes(config);
  const sundayServiceType = serviceTypes.find(
    (serviceType) =>
      normalizeSelectorName(serviceType.name) ===
      normalizeSelectorName(KINGDOM_BUILDERS_SERVICE_TYPE)
  );

  if (!sundayServiceType) {
    throw new Error(
      "Crossroads Sunday Service was not found in Planning Center"
    );
  }

  let plan = selectedPlan;
  let planItems = selectedPlanItems;

  if (
    String(selectedServiceTypeId) !==
    String(sundayServiceType.id)
  ) {
    plan = await getUpcomingPlanningCenterPlan(
      config,
      sundayServiceType.id
    );
    planItems = null;
  }

  const cacheKey = String(plan?.id || "");
  const cached = kingdomBuildersCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  if (!Array.isArray(planItems)) {
    planItems = await getPlanningCenterPlanItems(
      config,
      plan.id,
      sundayServiceType.id
    );
  }

  const data = extractKingdomBuildersSegment(
    planItems,
    plan
  );

  kingdomBuildersCache.set(cacheKey, {
    expiresAt: Date.now() + (5 * 60 * 1000),
    data
  });

  return data;
}

/*
|--------------------------------------------------------------------------
| Planning Center Live
|--------------------------------------------------------------------------
*/

function planningCenterResourceKey(type, id) {
  return `${String(type || "").toLowerCase()}:${String(id || "")}`;
}

function buildPlanningCenterResourceLookup(resources = []) {
  return new Map(
    resources
      .filter((resource) => resource?.type && resource?.id)
      .map((resource) => [
        planningCenterResourceKey(resource.type, resource.id),
        resource
      ])
  );
}

function getPlanningCenterRelationshipResource(
  resource,
  relationshipName,
  resourceLookup
) {
  const relationship =
    resource?.relationships?.[relationshipName]?.data;

  if (!relationship?.type || !relationship?.id) {
    return null;
  }

  return (
    resourceLookup.get(
      planningCenterResourceKey(
        relationship.type,
        relationship.id
      )
    ) || null
  );
}

function normalizePlanningCenterItemResource(resource) {
  if (!resource) {
    return null;
  }

  const attributes = resource.attributes || {};

  return {
    id: resource.id,
    title: attributes.title || "",
    itemType: attributes.item_type || "",
    sequence: attributes.sequence ?? 0,
    servicePosition: attributes.service_position || "",
    length: attributes.length ?? 0,
    description: attributes.description || "",
    keyName: attributes.key_name || "",
    selectedLayout: attributes.selected_layout || "",
    songId: resource.relationships?.song?.data?.id || null
  };
}

function normalizePlanningCenterItemTime(resource) {
  if (!resource) {
    return null;
  }

  const attributes = resource.attributes || {};

  return {
    id: resource.id,
    itemId: resource.relationships?.item?.data?.id || null,
    planTimeId:
      resource.relationships?.plan_time?.data?.id || null,
    length: attributes.length ?? null,
    lengthOffset: attributes.length_offset ?? null,
    liveStartAt: attributes.live_start_at || null,
    liveEndAt: attributes.live_end_at || null,
    excluded: Boolean(attributes.exclude)
  };
}

async function getPlanningCenterLiveState(
  config,
  planId,
  planItems = [],
  serviceTypeId = config.planningCenter?.serviceTypeId
) {
  if (!serviceTypeId) {
    throw new Error(
      "Planning Center serviceTypeId is missing from config.json"
    );
  }

  if (!planId) {
    throw new Error(
      "Planning Center planId is required to retrieve Live state"
    );
  }

  const endpoint =
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}` +
    `/plans/${encodeURIComponent(planId)}` +
    `/live?include=current_item_time,next_item_time,items&per_page=1`;

  const response = await planningCenterRequest(config, endpoint);
  const liveResource = Array.isArray(response.data)
    ? response.data[0]
    : response.data;

  if (!liveResource) {
    return {
      active: false,
      connected: true,
      status: "Not started",
      liveId: null,
      currentItem: null,
      nextItem: null,
      currentItemTime: null,
      nextItemTime: null
    };
  }

  const resources = [
    liveResource,
    ...(response.included || [])
  ];

  const resourceLookup =
    buildPlanningCenterResourceLookup(resources);

  const currentItemTimeResource =
    getPlanningCenterRelationshipResource(
      liveResource,
      "current_item_time",
      resourceLookup
    );

  const nextItemTimeResource =
    getPlanningCenterRelationshipResource(
      liveResource,
      "next_item_time",
      resourceLookup
    );

  const currentItemTime =
    normalizePlanningCenterItemTime(currentItemTimeResource);

  const nextItemTime =
    normalizePlanningCenterItemTime(nextItemTimeResource);

  const planItemLookup = new Map(
    planItems.map((item) => [String(item.id), item])
  );

  for (const resource of response.included || []) {
    if (String(resource.type || "").toLowerCase() !== "item") {
      continue;
    }

    const normalized =
      normalizePlanningCenterItemResource(resource);

    if (
      normalized?.id &&
      !planItemLookup.has(String(normalized.id))
    ) {
      planItemLookup.set(String(normalized.id), normalized);
    }
  }

  const currentItem = currentItemTime?.itemId
    ? planItemLookup.get(String(currentItemTime.itemId)) || null
    : null;

  const nextItem = nextItemTime?.itemId
    ? planItemLookup.get(String(nextItemTime.itemId)) || null
    : null;

  const attributes = liveResource.attributes || {};

  return {
    active: true,
    connected: true,
    status: currentItem ? "Live" : "Waiting",
    liveId: liveResource.id,
    title: attributes.title || "",
    dates: attributes.dates || "",
    seriesTitle: attributes.series_title || "",
    canControl: Boolean(attributes.can_control),
    canTakeControl: Boolean(attributes.can_take_control),
    currentItem,
    nextItem,
    currentItemTime,
    nextItemTime
  };
}

/*
|--------------------------------------------------------------------------
| Planning Center team members
|--------------------------------------------------------------------------
*/

async function getPlanningCenterTeamMembers(
  config,
  planId,
  serviceTypeId = config.planningCenter?.serviceTypeId
) {
  if (!serviceTypeId) {
    throw new Error(
      "Planning Center serviceTypeId is missing from config.json"
    );
  }

  if (!planId) {
    throw new Error(
      "Planning Center planId is required to retrieve team members"
    );
  }

  let endpoint =
    `/services/v2/service_types/${encodeURIComponent(serviceTypeId)}` +
    `/plans/${encodeURIComponent(planId)}` +
    `/team_members?per_page=100&include=team`;

  const data = [];
  const included = [];
  let pageCount = 0;

  while (endpoint && pageCount < 20) {
    const response = await planningCenterRequest(config, endpoint);

    data.push(...(response.data || []));
    included.push(...(response.included || []));

    endpoint = response.links?.next || null;
    pageCount += 1;
  }

  const includedLookup = new Map(
    included.map((resource) => [
      `${resource.type}:${resource.id}`,
      resource
    ])
  );

  return data.map((member) => {
    const attributes = member.attributes || {};
    const teamRelationship = member.relationships?.team?.data;

    const teamResource = teamRelationship
      ? includedLookup.get(
          `${teamRelationship.type}:${teamRelationship.id}`
        )
      : null;

    const teamAttributes = teamResource?.attributes || {};

    return {
      id: member.id,
      name:
        attributes.name ||
        attributes.person_name ||
        attributes.full_name ||
        [attributes.first_name, attributes.last_name]
          .filter(Boolean)
          .join(" ") ||
        "Scheduled Person",
      firstName: attributes.first_name || "",
      lastName: attributes.last_name || "",
      teamName:
        teamAttributes.name ||
        teamAttributes.title ||
        attributes.team_name ||
        attributes.team ||
        "",
      teamPositionName:
        attributes.team_position_name ||
        attributes.position_name ||
        attributes.position ||
        attributes.role ||
        "",
      status: attributes.status || "",
      notes:
        attributes.notes ||
        attributes.note ||
        "",
      photoThumbnail:
        attributes.photo_thumbnail ||
        attributes.photo_thumbnail_url ||
        "",
      photo:
        attributes.photo ||
        attributes.photo_url ||
        attributes.photo_thumbnail ||
        attributes.photo_thumbnail_url ||
        "",
      personId:
        member.relationships?.person?.data?.id || null,
      teamId:
        member.relationships?.team?.data?.id || null,
      rawAttributes: attributes
    };
  });
}

/*
|--------------------------------------------------------------------------
| Volunteer role mapping
|--------------------------------------------------------------------------
*/

function normalizeRoleText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[_/]+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ");
}

function isVisibleTeamMember(member) {
  const status = normalizeRoleText(member.status);

  // Exchange dashboards are confirmed-only. Unconfirmed, pending, declined,
  // blank, and other statuses must not appear on any TV.
  return [
    "c",
    "confirmed",
    "accepted",
    "yes"
  ].includes(status);
}

function cleanAssignmentSource(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[–—]/g, "-")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanAssignmentValue(value) {
  return String(value || "")
    .trim()
    .replace(/^[#:\-\s]+/, "")
    .replace(/[.,;|/]+$/, "")
    .trim();
}

function firstAssignmentMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (!match) {
      continue;
    }

    const value = cleanAssignmentValue(match[1]);

    if (value) {
      return value;
    }
  }

  return "";
}

function extractMicPackAssignments(member) {
  const notes = cleanAssignmentSource(member.notes);
  const position = cleanAssignmentSource(member.teamPositionName);
  const source = [notes, position]
    .filter(Boolean)
    .join(" | ");

  const micAssignment = firstAssignmentMatch(source, [
    /\b(?:mic(?:rophone)?|wireless(?:\s+mic)?|handheld|hh)\s*(?:#|no\.?|number|:|-)?\s*([a-z0-9][a-z0-9._-]*)\b/i,
    /\bM(?:IC)?\s*#?\s*([0-9]+)\b/i
  ]);

  const packAssignment = firstAssignmentMatch(source, [
    /\b(?:iem\s*)?(?:pack|body\s*pack|bodypack|belt\s*pack|beltpack|in[- ]?ear(?:\s+pack)?|iem)\s*(?:#|no\.?|number|:|-)?\s*([a-z0-9][a-z0-9._-]*)\b/i,
    /\bP(?:ACK)?\s*#?\s*([0-9]+)\b/i
  ]);

  return {
    micAssignment,
    packAssignment
  };
}

function buildVolunteerCard(member) {
  const firstName = member.firstName || "";
  const lastName = member.lastName || "";
  const generatedName = `${firstName} ${lastName}`.trim();
  const name =
    member.name ||
    generatedName ||
    "Scheduled Person";

  const assignments = extractMicPackAssignments(member);

  return {
    id: member.id,
    personId: member.personId || null,
    name,
    firstName,
    lastName,
    team: member.teamName || "",
    teamName: member.teamName || "",
    role:
      member.teamPositionName ||
      "Team Member",
    teamPositionName:
      member.teamPositionName || "",
    status: member.status || "",
    notes: member.notes || "",
    micAssignment:
      assignments.micAssignment || "",
    packAssignment:
      assignments.packAssignment || "",
    photo:
      member.photo ||
      member.photoThumbnail ||
      "",
    photoThumbnail:
      member.photoThumbnail ||
      member.photo ||
      "",
    initials: createInitials(name)
  };
}

function createInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    parts[0][0] +
    parts[parts.length - 1][0]
  ).toUpperCase();
}

function cleanManualGuestText(value, maximumLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function normalizeManualGuestStatus(value) {
  return normalizeRoleText(value) === "c" ||
    normalizeRoleText(value) === "confirmed"
    ? "C"
    : "U";
}

function normalizeManualGuestPhoto(value) {
  const photo = cleanManualGuestText(value, 2000);

  if (!photo) {
    return "";
  }

  if (
    photo.startsWith("/") ||
    /^https?:\/\//i.test(photo)
  ) {
    return photo;
  }

  throw new Error(
    "Photo must use an http(s) URL or a public path beginning with /"
  );
}

function normalizeManualGuestInput(input = {}, existing = {}) {
  const name = cleanManualGuestText(
    input.name ?? existing.name,
    100
  );

  const serviceTypeId = cleanManualGuestText(
    input.serviceTypeId ?? existing.serviceTypeId,
    100
  );

  const planId = cleanManualGuestText(
    input.planId ?? existing.planId,
    100
  );

  if (!name) {
    throw new Error("Guest name is required");
  }

  if (!serviceTypeId || !planId) {
    throw new Error(
      "A Planning Center service and plan are required"
    );
  }

  return {
    id: existing.id || randomUUID(),
    name,
    role: "Sermon Communicator",
    photo: normalizeManualGuestPhoto(
      input.photo ?? existing.photo
    ),
    micAssignment: cleanManualGuestText(
      input.micAssignment ?? existing.micAssignment,
      30
    ),
    status: normalizeManualGuestStatus(
      input.status ?? existing.status
    ),
    serviceTypeId,
    serviceTypeName: cleanManualGuestText(
      input.serviceTypeName ?? existing.serviceTypeName,
      120
    ),
    planId,
    planLabel: cleanManualGuestText(
      input.planLabel ?? existing.planLabel,
      180
    ),
    enabled:
      input.enabled === undefined
        ? existing.enabled !== false
        : input.enabled !== false,
    createdAt:
      existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function manualGuestMatchesPlan(
  guest,
  serviceTypeId,
  planId
) {
  return (
    guest?.enabled !== false &&
    String(guest?.serviceTypeId || "") ===
      String(serviceTypeId || "") &&
    String(guest?.planId || "") ===
      String(planId || "")
  );
}

function buildManualGuestCard(guest) {
  const name = guest.name || "Special Guest";

  return {
    id: `manual-${guest.id}`,
    personId: null,
    name,
    firstName: name.split(/\s+/)[0] || "",
    lastName: name.split(/\s+/).slice(1).join(" "),
    team: "Communications",
    teamName: "Communications",
    role: "Sermon Communicator",
    teamPositionName: "Sermon Communicator",
    status: normalizeManualGuestStatus(guest.status),
    notes: "Manually added special guest",
    micAssignment: guest.micAssignment || "",
    packAssignment: "",
    photo: guest.photo || "",
    photoThumbnail: guest.photo || "",
    initials: createInitials(name),
    manualGuest: true,
    source: "manual"
  };
}

function mergeManualGuests(
  volunteers,
  serviceTypeId,
  planId
) {
  const normalizedVolunteers = volunteers || {
    vocals: [],
    worshipPastor: null,
    communications: [],
    band: [],
    unassigned: []
  };

  normalizedVolunteers.vocals = Array.isArray(
    normalizedVolunteers.vocals
  )
    ? normalizedVolunteers.vocals
    : [];

  normalizedVolunteers.communications = Array.isArray(
    normalizedVolunteers.communications
  )
    ? normalizedVolunteers.communications
    : [];

  normalizedVolunteers.band = Array.isArray(
    normalizedVolunteers.band
  )
    ? normalizedVolunteers.band
    : [];

  normalizedVolunteers.unassigned = Array.isArray(
    normalizedVolunteers.unassigned
  )
    ? normalizedVolunteers.unassigned
    : [];

  const manualCards = loadManualGuests()
    .filter((guest) =>
      manualGuestMatchesPlan(
        guest,
        serviceTypeId,
        planId
      )
    )
    .map(buildManualGuestCard);

  const manualIds = new Set(
    manualCards.map((card) => card.id)
  );

  normalizedVolunteers.communications = [
    ...manualCards,
    ...normalizedVolunteers.communications.filter(
      (card) => !manualIds.has(card.id)
    )
  ].sort((a, b) => {
    const priorityDifference =
      communicationPriority(a) -
      communicationPriority(b);

    return priorityDifference || sortVolunteers(a, b);
  });

  return normalizedVolunteers;
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function isWorshipPastorRole(positionName, searchableText) {
  return (
    positionName === "worship leader" ||
    positionName === "worship pastor" ||
    positionName === "worship arts pastor" ||
    positionName === "pastor of worship" ||
    searchableText.includes("worship leader") ||
    searchableText.includes("worship pastor") ||
    searchableText.includes("worship arts pastor")
  );
}

function isVocalRole(teamName, positionName, searchableText) {
  const exactVocalPositions = new Set([
    "vocal",
    "vocals",
    "vocalist",
    "singer",
    "lead vocal",
    "lead vocalist",
    "background vocal",
    "background vocalist",
    "song leader",
    "bgv"
  ]);

  return (
    exactVocalPositions.has(positionName) ||
    /^vocal\s*\d+$/.test(positionName) ||
    /^vocalist\s*\d+$/.test(positionName) ||
    /^background vocal\s*\d+$/.test(positionName) ||
    /^bgv\s*\d+$/.test(positionName)
  );
}

function isSermonCommunicatorRole(positionName) {
  return positionName === "sermon communicator";
}

function isServiceHostRole(positionName) {
  return positionName === "service host";
}

function isCommunicationsRole(teamName, positionName, searchableText) {
  return (
    isSermonCommunicatorRole(positionName) ||
    isServiceHostRole(positionName)
  );
}

function isBandRole(teamName, positionName) {
  return (
    containsAny(positionName, [
      "drum",
      "percussion",
      "bass",
      "guitar",
      "acoustic",
      "electric",
      "keys",
      "keyboard",
      "piano",
      "organ",
      "synth",
      "violin",
      "viola",
      "cello",
      "string",
      "horn",
      "trumpet",
      "trombone",
      "sax",
      "flute",
      "tracks",
      "playback",
      "music director",
      "musical director",
      "band leader",
      "instrument"
    ]) ||
    ["md", "band", "drums", "keys", "bass"].includes(positionName) ||
    containsAny(teamName, [
      "band",
      "instrumental",
      "instrumentalist",
      "musicians",
      "worship band",
      "house band"
    ]) ||
    teamName === "worship team" ||
    teamName === "worship"
  );
}

function communicationPriority(person) {
  const role = normalizeRoleText(
    person.role || person.teamPositionName
  );

  if (role.includes("sermon communicator")) {
    return 1;
  }

  if (role.includes("service host")) {
    return 2;
  }

  return 3;
}

function isExcludedDashboardRole(positionName) {
  return (
    positionName.includes("loop coordinator") ||
    positionName.includes("special coordinator") ||
    positionName === "music director"
  );
}

function isSameScheduledPerson(first, second) {
  const firstPersonId = String(
    first?.personId || ""
  ).trim();

  const secondPersonId = String(
    second?.personId || ""
  ).trim();

  if (firstPersonId && secondPersonId) {
    return firstPersonId === secondPersonId;
  }

  const firstName = normalizeRoleText(first?.name);
  const secondName = normalizeRoleText(second?.name);

  return Boolean(firstName && firstName === secondName);
}

function categorizeTeamMembers(teamMembers = []) {
  const volunteers = {
    vocals: [],
    worshipPastor: null,
    communications: [],
    band: [],
    unassigned: []
  };

  const worshipLeaderVocalFallbacks = [];

  for (const member of teamMembers) {
    if (!isVisibleTeamMember(member)) {
      continue;
    }

    const card = buildVolunteerCard(member);
    const teamName = normalizeRoleText(member.teamName);
    const positionName = normalizeRoleText(
      member.teamPositionName
    );
    const searchableText = normalizeRoleText(
      `${teamName} ${positionName}`
    );

    if (isExcludedDashboardRole(positionName)) {
      continue;
    }

    if (isWorshipPastorRole(positionName, searchableText)) {
      volunteers.worshipPastor = card;

      if (positionName === "worship leader") {
        worshipLeaderVocalFallbacks.push(card);
      }

      continue;
    }

    if (isVocalRole(teamName, positionName, searchableText)) {
      volunteers.vocals.push(card);
      continue;
    }

    if (
      isCommunicationsRole(
        teamName,
        positionName,
        searchableText
      )
    ) {
      volunteers.communications.push(card);
      continue;
    }

    if (isBandRole(teamName, positionName)) {
      volunteers.band.push(card);
      continue;
    }

    volunteers.unassigned.push(card);
  }

  for (const worshipLeader of worshipLeaderVocalFallbacks) {
    const alreadyListedAsVocal = volunteers.vocals.some(
      (vocal) =>
        isSameScheduledPerson(vocal, worshipLeader)
    );

    if (alreadyListedAsVocal) {
      continue;
    }

    volunteers.vocals.push({
      ...worshipLeader,
      id: `${worshipLeader.id}-vocal-fallback`,
      role: "Vocal",
      teamPositionName: "Vocal",
      derivedFromWorshipLeader: true
    });
  }

  volunteers.vocals.sort(sortVolunteers);
  volunteers.communications.sort((a, b) => {
    const priorityDifference =
      communicationPriority(a) -
      communicationPriority(b);

    return priorityDifference || sortVolunteers(a, b);
  });
  volunteers.band.sort(sortVolunteers);
  volunteers.unassigned.sort(sortVolunteers);

  return volunteers;
}

function sortVolunteers(a, b) {
  const roleComparison =
    String(a.role || "").localeCompare(
      String(b.role || "")
    );

  if (roleComparison !== 0) {
    return roleComparison;
  }

  return String(a.name || "").localeCompare(
    String(b.name || "")
  );
}

/*
|--------------------------------------------------------------------------
| Planning Center status
|--------------------------------------------------------------------------
*/

async function getPlanningCenterStatus(config) {
  const pco = config.planningCenter;

  if (!pco?.enabled) {
    return statusRecord("unknown", "PCO", "Not configured");
  }

  if (!pco.applicationId || !pco.secret) {
    return statusRecord("warning", "PCO", "Credentials missing");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const auth = createPlanningCenterAuth(config);

    const response = await fetch(
      "https://api.planningcenteronline.com/services/v2/service_types?per_page=1",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "User-Agent": "Crossroads-Exchange-Dashboard"
        },
        signal: controller.signal
      }
    );

    if (response.ok) {
      return statusRecord(
        "online",
        "PCO",
        `HTTP ${response.status}`
      );
    }

    if ([401, 403].includes(response.status)) {
      return statusRecord(
        "warning",
        "PCO",
        "Credentials rejected"
      );
    }

    return statusRecord(
      "offline",
      "PCO",
      `HTTP ${response.status}`
    );
  } catch (error) {
    return statusRecord(
      "offline",
      "PCO",
      error.name === "AbortError"
        ? "Timed out"
        : error.message
    );
  } finally {
    clearTimeout(timer);
  }
}

/*
|--------------------------------------------------------------------------
| Network checks
|--------------------------------------------------------------------------
*/

function tcpCheck(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    function finish(ok, detail) {
      if (finished) {
        return;
      }

      finished = true;
      socket.destroy();
      resolve({ ok, detail });
    }

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      finish(true, `Connected to ${host}:${port}`);
    });

    socket.once("timeout", () => {
      finish(false, `Timed out connecting to ${host}:${port}`);
    });

    socket.once("error", (error) => {
      finish(false, error.message);
    });

    socket.connect(port, host);
  });
}

function pingCheck(host, timeoutMs = 1800) {
  return new Promise((resolve) => {
    if (!host) {
      resolve({ ok: false, detail: "Host missing" });
      return;
    }

    const platform = process.platform;
    const args = platform === "win32"
      ? ["-n", "1", "-w", String(timeoutMs), host]
      : platform === "darwin"
        ? ["-c", "1", "-W", String(timeoutMs), host]
        : [
            "-c",
            "1",
            "-W",
            String(Math.max(1, Math.ceil(timeoutMs / 1000))),
            host
          ];

    execFile(
      platform === "darwin" ? "/sbin/ping" : "ping",
      args,
      { timeout: timeoutMs + 700 },
      (error) => {
        resolve({
          ok: !error,
          detail: error
            ? `No ping response from ${host}`
            : `Ping response from ${host}`
        });
      }
    );
  });
}

async function httpCheck(url, timeoutMs = 1800) {
  if (!url) {
    return {
      ok: false,
      detail: "URL missing"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    return {
      ok:
        response.ok ||
        response.status === 401 ||
        response.status === 403,
      detail: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error.name === "AbortError"
          ? "Timed out"
          : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

/*
|--------------------------------------------------------------------------
| Blackmagic streaming encoder
|--------------------------------------------------------------------------
*/

const DEFAULT_STREAM_ENCODER_HOST = "10.0.3.67";
const DEFAULT_STREAM_ENCODER_PORT = 9977;

function getStreamingEncoderConfig(config) {
  const configured =
    config.streamingEncoder ||
    config.blackmagicEncoder ||
    config.devices?.streamingEncoder ||
    config.devices?.encoder ||
    {};

  const configuredPlatforms = Array.isArray(configured.platforms)
    ? configured.platforms
        .map((platform) => String(platform || "").trim())
        .filter(Boolean)
    : [];

  const platforms = configuredPlatforms.length
    ? configuredPlatforms
    : ["YouTube", "Facebook"];

  return {
    enabled: configured.enabled !== false,
    host:
      process.env.BLACKMAGIC_ENCODER_HOST ||
      configured.host ||
      DEFAULT_STREAM_ENCODER_HOST,
    port:
      Number(
        process.env.BLACKMAGIC_ENCODER_PORT ||
        configured.port
      ) || DEFAULT_STREAM_ENCODER_PORT,
    timeoutMs:
      Number(configured.timeoutMs) || 2500,
    platforms,
    platformLabel: platforms.join(" + ")
  };
}

function parseBlackmagicSections(payload) {
  const sections = {};
  let currentSection = "ROOT";

  sections[currentSection] = {};

  for (const rawLine of String(payload || "").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const sectionMatch = line.match(
      /^([A-Z][A-Z0-9 _\-/&]+):$/
    );

    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections[currentSection] = sections[currentSection] || {};
      continue;
    }

    const fieldMatch = line.match(/^([^:]+):\s*(.*)$/);

    if (!fieldMatch) {
      continue;
    }

    const key = fieldMatch[1].trim();
    const value = fieldMatch[2].trim();

    sections[currentSection][key] = value;
  }

  return sections;
}

function firstBlackmagicValue(sections, candidates) {
  for (const [sectionName, fieldNames] of candidates) {
    const section = sections[sectionName] || {};

    for (const fieldName of fieldNames) {
      const value = section[fieldName];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return String(value).trim();
      }
    }
  }

  return "";
}

function parseEncoderNumber(value) {
  const match = String(value ?? "").match(
    /-?\d+(?:\.\d+)?/
  );

  if (!match) {
    return null;
  }

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function formatEncoderDuration(value) {
  const text = String(value || "").trim();
  const parts = text.split(":");

  if (parts.length === 4) {
    return parts.slice(0, 3).join(":");
  }

  return text;
}

function encoderStateLabel(status, connected) {
  if (!connected) {
    return "ENCODER OFFLINE";
  }

  const normalized = String(status || "")
    .trim()
    .toLowerCase();

  if (["streaming", "on air", "on-air"].includes(normalized)) {
    return "ON AIR";
  }

  if (["connecting", "starting"].includes(normalized)) {
    return "CONNECTING";
  }

  if (["interrupted", "error", "failed"].includes(normalized)) {
    return "STREAM ISSUE";
  }

  if (
    ["idle", "stopped", "off air", "off-air"].includes(
      normalized
    )
  ) {
    return "OFF AIR";
  }

  return normalized ? String(status).toUpperCase() : "STANDBY";
}

function streamDisplayState(status, connected) {
  if (!connected) {
    return "offline";
  }

  const normalized = String(status || "")
    .trim()
    .toLowerCase();

  if (["streaming", "on air", "on-air"].includes(normalized)) {
    return "live";
  }

  if (["interrupted", "error", "failed"].includes(normalized)) {
    return "offline";
  }

  return "ready";
}

function normalizeBlackmagicStream(payload, connection) {
  const sections = parseBlackmagicSections(payload);

  const rawStatus = firstBlackmagicValue(sections, [
    ["STREAM STATE", ["Status"]]
  ]) || "Unknown";

  const bitrate = parseEncoderNumber(
    firstBlackmagicValue(sections, [
      ["STREAM STATE", ["Bitrate"]]
    ])
  );

  const durationRaw = firstBlackmagicValue(sections, [
    ["STREAM STATE", ["Duration"]]
  ]);

  const cacheUsed = parseEncoderNumber(
    firstBlackmagicValue(sections, [
      ["STREAM STATE", ["Cache Used"]]
    ])
  );

  const encoderPlatform = firstBlackmagicValue(sections, [
    ["STREAM SETTINGS", ["Platform", "Service"]],
    ["STREAMING SETTINGS", ["Platform", "Service"]],
    ["ROOT", ["Platform", "Service"]]
  ]);

  const destination = firstBlackmagicValue(sections, [
    ["STREAM SETTINGS", ["Server", "Destination"]],
    ["STREAMING SETTINGS", ["Server", "Destination"]],
    ["ROOT", ["Server", "Destination"]]
  ]);

  const quality = firstBlackmagicValue(sections, [
    ["STREAM SETTINGS", ["Quality Level", "Quality"]],
    ["STREAMING SETTINGS", ["Quality Level", "Quality"]],
    ["ROOT", ["Quality Level", "Quality"]]
  ]);

  const model = firstBlackmagicValue(sections, [
    ["IDENTITY", ["Model", "Product"]],
    ["ROOT", ["Model", "Product"]]
  ]) || "Blackmagic Streaming Encoder";

  const displayState = streamDisplayState(rawStatus, true);
  const live = displayState === "live";

  const bitrateMbps =
    bitrate === null
      ? null
      : Number((bitrate / 1_000_000).toFixed(2));

  const duration = formatEncoderDuration(durationRaw);
  const details = [];

  if (bitrateMbps !== null) {
    details.push(`${bitrateMbps.toFixed(2)} Mbps`);
  }

  if (duration) {
    details.push(`Duration ${duration}`);
  }

  if (cacheUsed !== null) {
    details.push(`Cache ${cacheUsed}%`);
  }

  if (!details.length && displayState === "ready") {
    details.push(`${model} connected and ready`);
  }

  return {
    connected: true,
    live,
    isLive: live,
    active: live,
    status: rawStatus,
    displayState,
    state: encoderStateLabel(rawStatus, true),
    label: encoderStateLabel(rawStatus, true),
    platforms: connection.platforms,
    platformLabel: connection.platformLabel,
    platform: connection.platformLabel,
    encoderPlatform,
    destination,
    quality,
    model,
    bitrate,
    bitrateMbps,
    duration,
    durationRaw,
    cacheUsed,
    health:
      displayState === "offline"
        ? "Issue"
        : live
          ? "Good"
          : "Ready",
    title: details.join(" • "),
    host: connection.host,
    port: connection.port,
    checkedAt: new Date().toISOString()
  };
}

function readBlackmagicEncoder(config) {
  const connection = getStreamingEncoderConfig(config);

  if (!connection.enabled) {
    return Promise.resolve({
      connected: false,
      live: false,
      isLive: false,
      active: false,
      status: "Disabled",
      displayState: "offline",
      state: "OFFLINE",
      label: "OFFLINE",
      platforms: connection.platforms,
      platformLabel: connection.platformLabel,
      platform: connection.platformLabel,
      title: "Streaming encoder integration is disabled",
      host: connection.host,
      port: connection.port,
      checkedAt: new Date().toISOString()
    });
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = "";
    let finished = false;

    function finish(result) {
      if (finished) {
        return;
      }

      finished = true;
      socket.destroy();
      resolve(result);
    }

    function finishOffline(detail) {
      finish({
        connected: false,
        live: false,
        isLive: false,
        active: false,
        status: "Offline",
        displayState: "offline",
        state: "OFFLINE",
        label: "OFFLINE",
        platforms: connection.platforms,
        platformLabel: connection.platformLabel,
        platform: connection.platformLabel,
        title: detail || "Encoder is not reachable",
        host: connection.host,
        port: connection.port,
        checkedAt: new Date().toISOString()
      });
    }

    socket.setEncoding("utf8");
    socket.setTimeout(connection.timeoutMs);

    socket.on("data", (chunk) => {
      buffer += chunk;

      if (buffer.includes("END PRELUDE:")) {
        finish(normalizeBlackmagicStream(buffer, connection));
      }
    });

    socket.once("timeout", () => {
      if (buffer.trim()) {
        finish(normalizeBlackmagicStream(buffer, connection));
        return;
      }

      finishOffline(
        `Timed out connecting to ${connection.host}:${connection.port}`
      );
    });

    socket.once("error", (error) => {
      finishOffline(error.message);
    });

    socket.once("end", () => {
      if (buffer.trim()) {
        finish(normalizeBlackmagicStream(buffer, connection));
      } else {
        finishOffline("Encoder closed the connection without data");
      }
    });

    socket.connect(connection.port, connection.host);
  });
}

function getBlackmagicLiveStatus(stream) {
  if (!stream?.connected) {
    return statusRecord(
      "offline",
      "LIVESTREAM",
      stream?.title || "Encoder is not reachable"
    );
  }

  if (stream.displayState === "live") {
    return statusRecord(
      "live",
      "LIVESTREAM",
      stream?.title || "On air"
    );
  }

  if (stream.displayState === "ready") {
    return statusRecord(
      "warning",
      "LIVESTREAM",
      stream?.title || "Encoder ready"
    );
  }

  return statusRecord(
    "offline",
    "LIVESTREAM",
    stream?.title || "Encoder is not reachable"
  );
}

/*
|--------------------------------------------------------------------------
| ProPresenter
|--------------------------------------------------------------------------
*/

function getProPresenterBaseUrl(config) {
  const configuredUrl =
    config.proPresenter?.baseUrl || "";

  return String(configuredUrl)
    .trim()
    .replace(/\/+$/, "");
}

async function proPresenterRequest(config, endpoint) {
  const baseUrl = getProPresenterBaseUrl(config);

  if (!config.proPresenter?.enabled) {
    throw new Error("ProPresenter is disabled");
  }

  if (!baseUrl) {
    throw new Error("ProPresenter baseUrl is not configured");
  }

  const timeoutMs =
    Number(config.proPresenter.timeoutMs) || 2500;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(
      `${baseUrl}${endpoint}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `ProPresenter returned HTTP ${response.status} for ${endpoint}`
      );
    }

    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `ProPresenter request timed out after ${timeoutMs} ms`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProPresenterText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeProPresenterText)
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof value === "object") {
    const directValue =
      value.text ??
      value.plainText ??
      value.plain_text ??
      value.content ??
      value.body ??
      value.value ??
      value.name ??
      value.title ??
      "";

    return normalizeProPresenterText(directValue);
  }

  return "";
}

function normalizeProPresenterSlide(
  slide,
  label,
  fallback
) {
  const text = normalizeProPresenterText(
    slide?.text ??
    slide?.plainText ??
    slide?.plain_text ??
    slide?.content ??
    slide?.body ??
    slide?.value ??
    slide
  );

  const imageUuid =
    slide?.image?.uuid ||
    slide?.image_uuid ||
    slide?.imageUuid ||
    slide?.uuid ||
    "";

  return {
    label,
    text: text || fallback,
    imageUuid
  };
}

function normalizeProPresenterSlides(payload) {
  const current =
    payload?.current ??
    payload?.currentSlide ??
    payload?.current_slide ??
    payload?.slide ??
    null;

  const next =
    payload?.next ??
    payload?.nextSlide ??
    payload?.next_slide ??
    null;

  return {
    current: normalizeProPresenterSlide(
      current,
      "CURRENT SLIDE",
      "No current slide"
    ),
    next: normalizeProPresenterSlide(
      next,
      "NEXT SLIDE",
      "No next slide"
    )
  };
}

function parseTimerSeconds(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const negative = normalized.startsWith("-");
  const clean = normalized.replace(/^-/, "");
  const parts = clean.split(":").map(Number);

  if (
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }

  let seconds = null;

  if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    seconds =
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2];
  }

  if (seconds === null) {
    return null;
  }

  return negative ? -seconds : seconds;
}

function getTimerSeconds(timer) {
  const candidates = [
    timer?.remaining,
    timer?.remainingSeconds,
    timer?.remaining_seconds,
    timer?.seconds,
    timer?.current,
    timer?.time
  ];

  for (const candidate of candidates) {
    const parsed = parseTimerSeconds(candidate);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function formatTimerSeconds(totalSeconds) {
  const number = Number(totalSeconds);

  if (!Number.isFinite(number)) {
    return "--:--";
  }

  const negative = number < 0;
  const absolute = Math.abs(Math.floor(number));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const seconds = absolute % 60;
  const prefix = negative ? "-" : "";

  if (hours > 0) {
    return (
      `${prefix}${hours}:` +
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`
    );
  }

  return (
    `${prefix}${minutes}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}

function getTimerDisplay(timer) {
  const explicit =
    timer?.display ??
    timer?.formatted ??
    timer?.text ??
    timer?.timeString ??
    timer?.time_string;

  if (
    explicit !== null &&
    explicit !== undefined &&
    String(explicit).trim()
  ) {
    return String(explicit).trim();
  }

  return formatTimerSeconds(getTimerSeconds(timer));
}

function normalizeProPresenterTimers(payload) {
  const source = Array.isArray(payload)
    ? payload
    : (
        payload?.timers ||
        payload?.data ||
        payload?.items ||
        payload?.current ||
        []
      );

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((timer, index) => ({
    id:
      timer?.id ||
      timer?.uuid ||
      `propresenter-timer-${index + 1}`,
    label:
      timer?.name ||
      timer?.label ||
      timer?.title ||
      `Timer ${index + 1}`,
    value: getTimerDisplay(timer),
    active: true,
    running: true
  }));
}

async function getProPresenterData(config) {
  if (!config.proPresenter?.enabled) {
    return {
      online: false,
      slides: {
        current: {
          label: "CURRENT SLIDE",
          text: "ProPresenter is disabled"
        },
        next: {
          label: "NEXT SLIDE",
          text: "ProPresenter is disabled"
        }
      },
      timers: [],
      detail: "Not configured"
    };
  }

  const [slideResult, timerResult] =
    await Promise.allSettled([
      proPresenterRequest(
        config,
        "/v1/status/slide"
      ),
      proPresenterRequest(
        config,
        "/v1/timers/current"
      )
    ]);

  const slideOnline =
    slideResult.status === "fulfilled";

  const timerOnline =
    timerResult.status === "fulfilled";

  const slides = slideOnline
    ? normalizeProPresenterSlides(slideResult.value)
    : {
        current: {
          label: "CURRENT SLIDE",
          text: "ProPresenter unavailable"
        },
        next: {
          label: "NEXT SLIDE",
          text: "ProPresenter unavailable"
        }
      };

  const timers = timerOnline
    ? normalizeProPresenterTimers(timerResult.value)
    : [];

  const errors = [];

  if (!slideOnline) {
    errors.push(
      `slides: ${slideResult.reason?.message || "request failed"}`
    );
  }

  if (!timerOnline) {
    errors.push(
      `timers: ${timerResult.reason?.message || "request failed"}`
    );
  }

  return {
    online: slideOnline || timerOnline,
    slides,
    timers,
    detail:
      errors.length
        ? errors.join("; ")
        : "Slides and timers connected"
  };
}

async function getProPresenterStatus(
  config,
  proPresenterData = null
) {
  const data =
    proPresenterData ||
    await getProPresenterData(config);

  return statusRecord(
    data.online
      ? "online"
      : (
          config.proPresenter?.enabled
            ? "offline"
            : "unknown"
        ),
    "ONLINE PP",
    data.detail
  );
}

/*
|--------------------------------------------------------------------------
| Other device status
|--------------------------------------------------------------------------
*/

async function getDeviceStatus(label, device) {
  if (!device?.enabled) {
    return statusRecord(
      "unknown",
      label,
      "Not configured"
    );
  }

  if (device.checkType === "manual") {
    return statusRecord(
      "unknown",
      label,
      "Manual status only"
    );
  }

  if (device.checkType === "tcp") {
    if (!device.host || !device.port) {
      return statusRecord(
        "warning",
        label,
        "Host or port missing"
      );
    }

    const result = await tcpCheck(
      device.host,
      device.port
    );

    return statusRecord(
      result.ok ? "online" : "offline",
      label,
      result.detail
    );
  }

  if (device.checkType === "ping") {
    if (!device.host) {
      return statusRecord(
        "warning",
        label,
        "Host missing"
      );
    }

    const result = await pingCheck(
      device.host,
      Number(device.timeoutMs) || 1800
    );

    return statusRecord(
      result.ok ? "online" : "offline",
      label,
      result.detail
    );
  }

  if (device.checkType === "http") {
    if (!device.url) {
      return statusRecord(
        "warning",
        label,
        "URL missing"
      );
    }

    const result = await httpCheck(device.url);

    return statusRecord(
      result.ok ? "online" : "offline",
      label,
      result.detail
    );
  }

  return statusRecord(
    "unknown",
    label,
    "Unsupported check type"
  );
}

async function buildStatuses(
  config,
  proPresenterData = null,
  streamData = null
) {
  const [planningCenter, proPresenter] =
    await Promise.all([
      getPlanningCenterStatus(config),
      getProPresenterStatus(
        config,
        proPresenterData
      )
    ]);

  const result = {
    planningCenter: applyOverride(
      "planningCenter",
      planningCenter
    ),
    proPresenter: applyOverride(
      "proPresenter",
      proPresenter
    )
  };

  const configuredAtemDevice =
    config.devices?.atem ||
    config.atem ||
    {};

  const atemDevice = {
    ...configuredAtemDevice,
    enabled: configuredAtemDevice.enabled !== false,
    checkType: configuredAtemDevice.checkType || "ping",
    host:
      configuredAtemDevice.host ||
      DEFAULT_ATEM_IP_ADDRESS
  };

  if (
    atemDevice?.host &&
    atemDevice.enabled !== false
  ) {
    const status = await getDeviceStatus(
      "ATEM",
      {
        ...atemDevice,
        enabled: true
      }
    );

    result.atem = applyOverride("atem", status);
  } else {
    result.atem = applyOverride(
      "atem",
      statusRecord(
        "warning",
        "ATEM",
        `ATEM status disabled for ${atemDevice.host}`
      )
    );
  }

  const optionalDevices = [
    ["audio", "AUDIO", config.devices?.audio],
    ["streamDeck", "STREAM DECK", config.devices?.streamDeck],
    ["etcIon", "ETC ION", config.devices?.etcIon]
  ];

  for (const [key, label, device] of optionalDevices) {
    if (!device?.enabled) {
      continue;
    }

    const status = await getDeviceStatus(label, device);
    result[key] = applyOverride(key, status);
  }

  const liveAutomaticStatus = config.demoMode
    ? statusRecord(
        "live",
        "LIVESTREAM",
        "Demo mode"
      )
    : getBlackmagicLiveStatus(
        streamData ||
        await readBlackmagicEncoder(config)
      );

  result.live = applyOverride(
    "live",
    liveAutomaticStatus
  );

  return result;
}

/*
|--------------------------------------------------------------------------
| SERVICE_PLAN_SELECTOR_PATCH_V1
| Planning Center service type + plan selector
|--------------------------------------------------------------------------
*/

const SERVICE_PLAN_SELECTOR_ALLOWED_TYPES = Object.freeze([
  "Events",
  "Crossroads Sunday Service"
]);

function isExchangeServiceTypeName(value) {
  return normalizeSelectorName(value).includes("exchange");
}

const planningCenterServiceTypeCache = {
  expiresAt: 0,
  serviceTypes: []
};

function normalizeSelectorName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePlanningCenterPlanResource(plan) {
  const attributes = plan?.attributes || {};

  return {
    id: String(plan?.id || ""),
    title:
      attributes.title ||
      attributes.series_title ||
      "Untitled Plan",
    seriesTitle: attributes.series_title || "",
    dates: attributes.dates || "",
    shortDates: attributes.short_dates || "",
    sortDate: attributes.sort_date || ""
  };
}

async function getAllowedPlanningCenterServiceTypes(
  config,
  forceRefresh = false
) {
  const now = Date.now();

  if (
    !forceRefresh &&
    planningCenterServiceTypeCache.expiresAt > now &&
    planningCenterServiceTypeCache.serviceTypes.length
  ) {
    return planningCenterServiceTypeCache.serviceTypes;
  }

  const response = await planningCenterRequest(
    config,
    "/services/v2/service_types?per_page=100"
  );

  const allowedOrder = new Map(
    SERVICE_PLAN_SELECTOR_ALLOWED_TYPES.map(
      (name, index) => [
        normalizeSelectorName(name),
        index
      ]
    )
  );

  const serviceTypes = (response.data || [])
    .map((serviceType) => ({
      id: String(serviceType.id || ""),
      name: String(
        serviceType.attributes?.name || ""
      ).trim()
    }))
    .filter((serviceType) => {
      const normalizedName = normalizeSelectorName(serviceType.name);
      return (
        allowedOrder.has(normalizedName) ||
        isExchangeServiceTypeName(serviceType.name)
      );
    });

  // The Exchange dashboard must always expose its configured Planning Center
  // service type even if the service-types listing is renamed, filtered, or
  // briefly inconsistent. The configured ID is the authoritative Exchange ID.
  const configuredExchangeServiceTypeId = String(
    config.planningCenter?.serviceTypeId || ""
  ).trim();
  const configuredExchangeServiceTypeName = String(
    config.planningCenter?.serviceTypeName || "Exchange Wednesday Service"
  ).trim() || "Exchange Wednesday Service";

  if (
    configuredExchangeServiceTypeId &&
    !serviceTypes.some((serviceType) =>
      String(serviceType.id) === configuredExchangeServiceTypeId
    )
  ) {
    serviceTypes.push({
      id: configuredExchangeServiceTypeId,
      name: configuredExchangeServiceTypeName
    });
  }

  serviceTypes.sort((a, b) => {
    const aOrder = allowedOrder.has(normalizeSelectorName(a.name))
      ? allowedOrder.get(normalizeSelectorName(a.name))
      : Number.MAX_SAFE_INTEGER;
    const bOrder = allowedOrder.has(normalizeSelectorName(b.name))
      ? allowedOrder.get(normalizeSelectorName(b.name))
      : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.name.localeCompare(b.name);
  });

  planningCenterServiceTypeCache.serviceTypes = serviceTypes;
  planningCenterServiceTypeCache.expiresAt =
    now + (5 * 60 * 1000);

  return serviceTypes;
}

async function assertAllowedPlanningCenterServiceType(
  config,
  serviceTypeId
) {
  const requestedId = String(serviceTypeId || "").trim();

  if (!requestedId) {
    throw new Error("A serviceTypeId is required");
  }

  const serviceTypes =
    await getAllowedPlanningCenterServiceTypes(config);

  const serviceType = serviceTypes.find(
    (entry) => String(entry.id) === requestedId
  );

  if (!serviceType) {
    throw new Error(
      "That Planning Center service type is not allowed on this dashboard"
    );
  }

  return serviceType;
}

async function getPlanningCenterCollection(
  config,
  endpoint,
  maxPages = 10
) {
  const resources = [];
  let nextEndpoint = endpoint;
  let pages = 0;

  while (nextEndpoint && pages < maxPages) {
    const response = await planningCenterRequest(
      config,
      nextEndpoint
    );

    resources.push(...(response.data || []));
    nextEndpoint = response.links?.next || null;
    pages += 1;
  }

  return resources;
}

async function getPlanningCenterPlansForServiceType(
  config,
  serviceTypeId
) {
  await assertAllowedPlanningCenterServiceType(
    config,
    serviceTypeId
  );

  const endpoint =
    "/services/v2/service_types/" +
    encodeURIComponent(serviceTypeId) +
    "/plans?filter=future&order=sort_date&per_page=100";

  const resources = await getPlanningCenterCollection(
    config,
    endpoint
  );

  const plans = resources
    .map(normalizePlanningCenterPlanResource)
    .filter((plan) => plan.id);

  const deduped = Array.from(
    new Map(
      plans.map((plan) => [String(plan.id), plan])
    ).values()
  );

  deduped.sort((a, b) => {
    const aTime = Date.parse(a.sortDate || "") || 0;
    const bTime = Date.parse(b.sortDate || "") || 0;
    return aTime - bTime || String(a.id).localeCompare(String(b.id));
  });

  return deduped;
}

async function getPlanningCenterPlan(
  config,
  serviceTypeId,
  planId
) {
  if (!serviceTypeId) {
    throw new Error(
      "Planning Center serviceTypeId is required to retrieve a plan"
    );
  }

  if (!planId) {
    throw new Error(
      "Planning Center planId is required to retrieve a plan"
    );
  }

  const endpoint =
    "/services/v2/service_types/" +
    encodeURIComponent(serviceTypeId) +
    "/plans/" +
    encodeURIComponent(planId);

  const response = await planningCenterRequest(
    config,
    endpoint
  );

  const plan = Array.isArray(response.data)
    ? response.data[0]
    : response.data;

  if (!plan) {
    throw new Error(
      "The selected Planning Center plan was not found"
    );
  }

  return normalizePlanningCenterPlanResource(plan);
}

app.get(
  "/api/planning-center/service-types",
  async (req, res) => {
    try {
      const config = loadConfig();
      const serviceTypes =
        await getAllowedPlanningCenterServiceTypes(config);

      const configuredDefault = String(
        config.planningCenter?.serviceTypeId || ""
      );

      const defaultServiceTypeId = serviceTypes.some(
        (serviceType) =>
          String(serviceType.id) === configuredDefault
      )
        ? configuredDefault
        : "";

      res.json({
        serviceTypes,
        defaultServiceTypeId
      });
    } catch (error) {
      res.status(500).json({
        error:
          "Planning Center service types could not be loaded",
        detail: error.message
      });
    }
  }
);

app.get(
  "/api/planning-center/plans",
  async (req, res) => {
    try {
      const config = loadConfig();
      const serviceType =
        await assertAllowedPlanningCenterServiceType(
          config,
          req.query.serviceTypeId
        );

      const plans =
        await getPlanningCenterPlansForServiceType(
          config,
          serviceType.id
        );

      res.json({
        serviceType,
        plans
      });
    } catch (error) {
      res.status(400).json({
        error: "Planning Center plans could not be loaded",
        detail: error.message
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Dedicated Exchange input management API
|--------------------------------------------------------------------------
*/

app.get("/api/exchange-input-context", async (req, res) => {
  try {
    const config = loadConfig();
    const allServiceTypes =
      await getAllowedPlanningCenterServiceTypes(config, true);
    const control = loadExchangeControl();

    const configuredServiceTypeId = String(
      config.planningCenter?.serviceTypeId || ""
    ).trim();

    const serviceTypes = allServiceTypes.filter((entry) =>
      isExchangeServiceTypeName(entry.name) ||
      String(entry.id) === configuredServiceTypeId
    );

    const requestedServiceTypeId = String(
      req.query.serviceTypeId ||
      control.serviceTypeId ||
      configuredServiceTypeId ||
      ""
    ).trim();

    if (!requestedServiceTypeId) {
      throw new Error(
        "The Exchange Planning Center serviceTypeId is missing from config.json"
      );
    }

    const serviceType =
      await assertAllowedPlanningCenterServiceType(
        config,
        requestedServiceTypeId
      );

    const plans =
      await getPlanningCenterPlansForServiceType(
        config,
        serviceType.id
      );

    const selectedPlanId = String(control.planId || "").trim();

    if (
      selectedPlanId &&
      String(control.serviceTypeId || serviceType.id) === String(serviceType.id) &&
      !plans.some((plan) => String(plan.id) === selectedPlanId)
    ) {
      try {
        const selectedPlan = await getPlanningCenterPlan(
          config,
          serviceType.id,
          selectedPlanId
        );
        if (selectedPlan?.id) plans.unshift(selectedPlan);
      } catch (error) {
        console.warn(
          "Saved Exchange plan could not be added to the input selector:",
          error.message
        );
      }
    }

    res.json({
      serviceTypes,
      defaultServiceTypeId: configuredServiceTypeId,
      serviceType,
      plans,
      control: {
        serviceTypeId: String(
          control.serviceTypeId || configuredServiceTypeId
        ),
        planId: selectedPlanId
      }
    });
  } catch (error) {
    res.status(500).json({
      error: "The Exchange input manager could not load Planning Center plans",
      detail: error.message
    });
  }
});

app.post(
  "/api/exchange-control",
  requireDashboardManager,
  async (req, res) => {
    try {
      const config = loadConfig();
      const requestedServiceTypeId = String(
        req.body?.serviceTypeId ||
        config.planningCenter?.serviceTypeId ||
        ""
      ).trim();
      const planId = String(req.body?.planId || "").trim();

      if (!requestedServiceTypeId) {
        throw new Error(
          "The Exchange Planning Center serviceTypeId is missing from config.json"
        );
      }

      const serviceType =
        await assertAllowedPlanningCenterServiceType(
          config,
          requestedServiceTypeId
        );

      let plan = null;
      if (planId) {
        plan = await getPlanningCenterPlan(
          config,
          serviceType.id,
          planId
        );
      }

      saveExchangeControl(serviceType.id, planId);

      res.json({
        ok: true,
        serviceType,
        serviceTypeId: serviceType.id,
        planId,
        plan
      });
    } catch (error) {
      res.status(400).json({
        error: "The Exchange service plan could not be selected",
        detail: error.message
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Dashboard API
|--------------------------------------------------------------------------
*/

app.get("/api/dashboard", async (req, res) => {
  try {
    const config = loadConfig();
    const dashboard = loadDemo();
    const now = new Date();

    const proPresenterData =
      await getProPresenterData(config);

    dashboard.slides = proPresenterData.slides;
    dashboard.timers = proPresenterData.timers;

    if (!dashboard.header) {
      dashboard.header = {};
    }

    dashboard.header.time = now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });

    dashboard.header.date = now
      .toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      })
      .toUpperCase();

    dashboard.kingdomBuilders = {
      available: false,
      month: now.toLocaleDateString([], {
        month: "long",
        year: "numeric"
      }).toUpperCase(),
      text: "Not listed in the Sunday service plan"
    };

    if (config.planningCenter?.enabled) {
      try {
        const control = loadExchangeControl();

        const requestedServiceTypeId = String(
          req.query.serviceTypeId ||
          control.serviceTypeId ||
          config.planningCenter?.serviceTypeId ||
          ""
        ).trim();

        const requestedPlanId = String(
          req.query.planId ||
          control.planId ||
          ""
        ).trim();

        let selectedServiceType = null;

        if (requestedServiceTypeId) {
          selectedServiceType =
            await assertAllowedPlanningCenterServiceType(
              config,
              requestedServiceTypeId
            );
        } else if (config.planningCenter?.serviceTypeId) {
          selectedServiceType =
            await assertAllowedPlanningCenterServiceType(
              config,
              config.planningCenter.serviceTypeId
            );
        }

        const serviceTypeId = String(
          selectedServiceType?.id || ""
        ).trim();

        if (!serviceTypeId) {
          throw new Error(
            "Planning Center serviceTypeId is missing"
          );
        }

        const planningCenterCore =
          await getPlanningCenterCoreData(
            config,
            serviceTypeId,
            requestedPlanId
          );

        const {
          plan,
          planItems,
          teamMembers
        } = planningCenterCore;

        if (planningCenterCore.kingdomBuilders) {
          dashboard.kingdomBuilders =
            planningCenterCore.kingdomBuilders;
        } else if (
          planningCenterCore.kingdomBuildersError
        ) {
          dashboard.kingdomBuilders = {
            ...dashboard.kingdomBuilders,
            error:
              planningCenterCore.kingdomBuildersError
          };
        }

        const volunteers =
          categorizeTeamMembers(teamMembers);

        const displayItems = planItems.filter((item) => {
          return (
            item.title &&
            String(item.itemType || "").toLowerCase() !== "header"
          );
        });

        let planningCenterLive;

        try {
          planningCenterLive =
            await getCachedPlanningCenterLiveState(
              config,
              plan.id,
              planItems,
              serviceTypeId
            );
        } catch (liveError) {
          console.warn(
            "Planning Center Live data error:",
            liveError.message
          );

          planningCenterLive = {
            active: false,
            connected: false,
            status: "Unavailable",
            error: liveError.message,
            liveId: null,
            currentItem: null,
            nextItem: null,
            currentItemTime: null,
            nextItemTime: null
          };
        }

        const currentItem =
          planningCenterLive.currentItem ||
          displayItems[0] ||
          null;

        const nextItem =
          planningCenterLive.nextItem ||
          displayItems[1] ||
          null;

        const currentDisplayIndex = currentItem
          ? displayItems.findIndex(
              (item) =>
                String(item.id) === String(currentItem.id)
            )
          : -1;

        const nextDisplayIndex = nextItem
          ? displayItems.findIndex(
              (item) =>
                String(item.id) === String(nextItem.id)
            )
          : -1;

        dashboard.header.plan =
          plan.title && plan.shortDates
            ? `${plan.title} — ${plan.shortDates}`
            : plan.title;

        if (!dashboard.service) {
          dashboard.service = {};
        }

        if (currentItem) {
          dashboard.service.current = {
            title: currentItem.title,
            type:
              currentItem.itemType ||
              "SERVICE ITEM",
            number:
              currentDisplayIndex >= 0
                ? currentDisplayIndex + 1
                : 1,
            count: displayItems.length,
            source:
              planningCenterLive.active
                ? "planning-center-live"
                : "plan-preview",
            liveStartAt:
              planningCenterLive.currentItemTime?.liveStartAt ||
              null,
            liveEndAt:
              planningCenterLive.currentItemTime?.liveEndAt ||
              null
          };
        } else {
          dashboard.service.current = {
            title: "No current item",
            type: "SERVICE ITEM",
            number: 0,
            count: displayItems.length
          };
        }

        if (nextItem) {
          dashboard.service.next = {
            title: nextItem.title,
            type:
              nextItem.itemType ||
              "SERVICE ITEM",
            number:
              nextDisplayIndex >= 0
                ? nextDisplayIndex + 1
                : 2,
            count: displayItems.length,
            source:
              planningCenterLive.active
                ? "planning-center-live"
                : "plan-preview",
            liveStartAt:
              planningCenterLive.nextItemTime?.liveStartAt ||
              null,
            liveEndAt:
              planningCenterLive.nextItemTime?.liveEndAt ||
              null
          };
        } else {
          dashboard.service.next = {
            title: "No next item",
            type: "SERVICE ITEM",
            number: 0,
            count: displayItems.length
          };
        }

        dashboard.volunteers = volunteers;

        dashboard.planningCenter = {
          connected: true,
          cached: Boolean(planningCenterCore.cached),
          stale: Boolean(planningCenterCore.stale),
          cacheError:
            planningCenterCore.cacheError || "",
          lastUpdatedAt:
            planningCenterCore.lastUpdatedAt || null,
          serviceTypeId,
          planId: plan.id,
          planTitle: plan.title,
          seriesTitle: plan.seriesTitle || "",
          serviceTypeName: selectedServiceType?.name || config.planningCenter?.serviceTypeName || "Exchange Wednesday Service",
          planDate: plan.dates,
          shortDates: plan.shortDates,
          sortDate: plan.sortDate,
          live: planningCenterLive,
          itemCount: planItems.length,
          displayItemCount: displayItems.length,
          teamMemberCount: teamMembers.length,
          volunteerCounts: {
            vocals: volunteers.vocals.length,
            communications:
              volunteers.communications.length,
            band: volunteers.band.length,
            unassigned:
              volunteers.unassigned.length
          },
          items: planItems,
          teamMembers
        };
      } catch (error) {
        console.error(
          "Planning Center data error:",
          error.message
        );

        dashboard.planningCenter = {
          connected: false,
          error: error.message
        };
      }
    } else {
      dashboard.planningCenter = {
        connected: false,
        error: "Planning Center is disabled"
      };
    }

    const manualGuestServiceTypeId =
      dashboard.planningCenter?.serviceTypeId ||
      String(req.query.serviceTypeId || "").trim();

    const manualGuestPlanId =
      dashboard.planningCenter?.planId ||
      String(req.query.planId || "").trim();

    if (manualGuestServiceTypeId && manualGuestPlanId) {
      dashboard.volunteers = mergeManualGuests(
        dashboard.volunteers,
        manualGuestServiceTypeId,
        manualGuestPlanId
      );

      if (dashboard.planningCenter?.volunteerCounts) {
        dashboard.planningCenter.volunteerCounts = {
          ...dashboard.planningCenter.volunteerCounts,
          vocals:
            dashboard.volunteers.vocals.length,
          communications:
            dashboard.volunteers.communications.length,
          band:
            dashboard.volunteers.band.length,
          unassigned:
            dashboard.volunteers.unassigned.length
        };
      }
    }

    dashboard.manualBoardContent =
      manualBoardContentForPlan(
        manualGuestServiceTypeId,
        manualGuestPlanId
      ) || {
        serviceTypeId: manualGuestServiceTypeId || "",
        planId: manualGuestPlanId || "",
        announcements: "",
        verseOfDay: "",
        worshipNotes: ""
      };

    const streamData = config.demoMode
      ? (dashboard.stream || {
          connected: true,
          live: true,
          isLive: true,
          active: true,
          status: "Streaming",
          displayState: "live",
          state: "LIVE",
          label: "LIVE",
          platforms: ["YouTube", "Facebook"],
          platformLabel: "YouTube + Facebook",
          platform: "YouTube + Facebook",
          title: "Demo mode"
        })
      : await readBlackmagicEncoder(config);

    dashboard.stream = streamData;

    const statuses = await buildStatuses(
      config,
      proPresenterData,
      streamData
    );

    dashboard.display = {
      ...(dashboard.display || {}),
      compactLiveBox: true,
      compactSlides: true,
      activeTimersOnly: true
    };

    res.json({
      mode: config.demoMode ? "demo" : "live",
      refreshSeconds: config.refreshSeconds || 5,
      dashboard,
      statuses
    });
  } catch (error) {
    console.error("Dashboard API error:", error);

    res.status(500).json({
      error: "Dashboard data could not be loaded",
      detail: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Safe configuration API
|--------------------------------------------------------------------------
*/

app.get("/api/config", (req, res) => {
  try {
    const config = loadConfig();
    const safe = JSON.parse(JSON.stringify(config));

    if (safe.planningCenter) {
      safe.planningCenter.applicationId =
        safe.planningCenter.applicationId
          ? "********"
          : "";

      safe.planningCenter.secret =
        safe.planningCenter.secret
          ? "********"
          : "";
    }

    res.json({
      config: safe,
      overrides
    });
  } catch (error) {
    res.status(500).json({
      error: "Configuration could not be loaded",
      detail: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Manual Communication TV content API
|--------------------------------------------------------------------------
*/

app.get("/api/manual-board-content", (req, res) => {
  try {
    const serviceTypeId = String(req.query.serviceTypeId || "").trim();
    const planId = String(req.query.planId || "").trim();

    if (!serviceTypeId || !planId) {
      return res.status(400).json({
        error: "serviceTypeId and planId are required"
      });
    }

    res.json({
      content: manualBoardContentForPlan(serviceTypeId, planId) || {
        serviceTypeId,
        planId,
        announcements: "",
        verseOfDay: "",
        worshipNotes: ""
      }
    });
  } catch (error) {
    res.status(500).json({
      error: "Manual board content could not be loaded",
      detail: error.message
    });
  }
});

app.post(
  "/api/manual-board-content",
  requireDashboardManager,
  (req, res) => {
    try {
      const content = upsertManualBoardContent(req.body || {});
      res.json({ ok: true, content });
    } catch (error) {
      res.status(400).json({
        error: "Manual board content could not be saved",
        detail: error.message
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Manual sermon communicator API
|--------------------------------------------------------------------------
*/

app.get("/api/manual-guests", (req, res) => {
  try {
    const guests = loadManualGuests().sort((a, b) => {
      const planComparison = String(
        a.planLabel || ""
      ).localeCompare(String(b.planLabel || ""));

      return (
        planComparison ||
        String(a.name || "").localeCompare(
          String(b.name || "")
        )
      );
    });

    res.json({ guests });
  } catch (error) {
    res.status(500).json({
      error: "Manual guests could not be loaded",
      detail: error.message
    });
  }
});

app.post("/api/manual-guests", requireServerComputer, (req, res) => {
  try {
    const guests = loadManualGuests();
    const guest = normalizeManualGuestInput(
      req.body || {}
    );

    guests.push(guest);
    saveManualGuests(guests);

    res.status(201).json({ ok: true, guest });
  } catch (error) {
    res.status(400).json({
      error: "Manual guest could not be added",
      detail: error.message
    });
  }
});

app.put("/api/manual-guests/:id", requireServerComputer, (req, res) => {
  try {
    const guests = loadManualGuests();
    const guestIndex = guests.findIndex(
      (guest) =>
        String(guest.id) === String(req.params.id)
    );

    if (guestIndex < 0) {
      return res.status(404).json({
        error: "Manual guest was not found"
      });
    }

    const guest = normalizeManualGuestInput(
      req.body || {},
      guests[guestIndex]
    );

    guests[guestIndex] = guest;
    saveManualGuests(guests);

    return res.json({ ok: true, guest });
  } catch (error) {
    return res.status(400).json({
      error: "Manual guest could not be updated",
      detail: error.message
    });
  }
});

app.delete("/api/manual-guests/:id", requireServerComputer, (req, res) => {
  try {
    const guests = loadManualGuests();
    const nextGuests = guests.filter(
      (guest) =>
        String(guest.id) !== String(req.params.id)
    );

    if (nextGuests.length === guests.length) {
      return res.status(404).json({
        error: "Manual guest was not found"
      });
    }

    saveManualGuests(nextGuests);

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: "Manual guest could not be removed",
      detail: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Manual override API
|--------------------------------------------------------------------------
*/

app.post("/api/override", requireServerComputer, (req, res) => {
  const { key, value } = req.body || {};

  const allowedKeys = Object.keys(overrides);
  const allowedValues = [
    "auto",
    "online",
    "offline",
    "warning",
    "unknown",
    "live"
  ];

  if (
    !allowedKeys.includes(key) ||
    !allowedValues.includes(value)
  ) {
    return res.status(400).json({
      error: "Invalid override"
    });
  }

  overrides[key] = value;

  return res.json({
    ok: true,
    overrides
  });
});

/*
|--------------------------------------------------------------------------
| Demo production message
|--------------------------------------------------------------------------
*/

app.post("/api/demo-message", requireServerComputer, (req, res) => {
  try {
    const data = loadDemo();

    data.message = String(
      req.body?.message || ""
    ).slice(0, 180);

    fs.writeFileSync(
      DEMO_PATH,
      JSON.stringify(data, null, 2)
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: "Production message could not be updated",
      detail: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Streaming encoder diagnostics
|--------------------------------------------------------------------------
*/

app.get("/api/stream", async (req, res) => {
  try {
    const config = loadConfig();
    const stream = await readBlackmagicEncoder(config);

    res.json({ stream });
  } catch (error) {
    res.status(500).json({
      error: "Streaming encoder status could not be loaded",
      detail: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString()
  });
});

/*
|--------------------------------------------------------------------------
| Browser fallback
|--------------------------------------------------------------------------
*/

app.get("*", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

let config;

try {
  config = loadConfig();
} catch (error) {
  console.error(
    "Could not load configuration:",
    error.message
  );

  process.exit(1);
}

const HOST = "0.0.0.0";
const PORT = Number(
  process.env.PORT ||
  config.port ||
  3001
);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(
    `Invalid server port: ${process.env.PORT || config.port}`
  );
  process.exit(1);
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal
      ) {
        addresses.add(entry.address);
      }
    }
  }

  return [...addresses];
}

app.listen(PORT, HOST, () => {
  const networkAddresses = getNetworkAddresses();

  console.log("");
  console.log("The Exchange Dashboard");
  console.log(`Project folder: ${ROOT_DIR}`);
  console.log(`Local dashboard: http://localhost:${PORT}`);

  for (const address of networkAddresses) {
    console.log(
      `Network dashboard: http://${address}:${PORT}`
    );
  }

  console.log(
    `Exchange Input Manager: http://localhost:${PORT}/exchange-input.html`
  );
  console.log(
    `Dashboard data: http://localhost:${PORT}/api/dashboard`
  );
  console.log("");
});
