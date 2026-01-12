import iziToast from "izitoast";

let parentUid = undefined;

// DOM / listeners
let menuObserver = null;
let hashChangeHandler = null;
let menuBuilding = false;
let navObserver = null;
let navTimer = null;
let lastKnownPageUid = null;
let navPollTimer = null;
let lastKnownPageHasTocOpen = false;
let lastNavPollTs = 0;

// Auto-open guard
let autoOpenInFlight = false;
let autoOpenPending = false;

// Page props update queue (avoid clobbering concurrent writes)
const pagePropsQueue = new Map();

// Page filter polling
let filterPollTimer = null;
let lastFilterSnapshot = "";

// Pull watch
const PULL_PATTERN = "[:block/children :block/heading :block/string {:block/children ...}]";
let watchActive = false;
let watchUid = null;

// TOC state
let tocShowing = false;
let building = false;

// Debounce timers
let rebuildTimer = null;
let menuTimer = null;

// Heading tags from Augmented Headings extension (if installed)
let h4Tag, h5Tag, h6Tag;

// Active heading highlighting
let activeIO = null;
let activeTocId = null;
let activeLockUntil = 0;
let scrollPersistLockUntil = 0;
let lastScrollPersistSource = "observer";
let userScrollUntil = 0;

// Scroll persistence
let scrollPersistTimer = null;
let lastPersistedScrollUid = null;
let excludeHeadingsTimer = null;

// ----------------------------------------------
// Settings
// ----------------------------------------------

const SETTING_FILTER = "filter_enabled";
const SETTING_AUTO_REFRESH = "auto_refresh_enabled";
const SETTING_RESOLVE_BLOCKREFS = "resolve_blockrefs";
const SETTING_MAX_WIDTH = "toc_max_width"; // e.g. 250px
const SETTING_MAX_HEIGHT = "toc_max_height"; // e.g. calc(100vh - 90px)
const SETTING_PERSIST_TOC_OPEN = "persist_toc_open";
const SETTING_PERSIST_SCROLL = "persist_scroll_position";
const SETTING_EXCLUDE_HEADINGS = "exclude_headings";
const SETTING_RESPECT_PAGE_FILTERS = "respect_page_filters";

const TOC_SCROLL_UID_KEY = "toc_scroll_uid";
const TOC_PROP_KEY = "toc_open";

const MIN_TOC_WIDTH_PX = 140;
const MAX_TOC_WIDTH_PX = 600;
const MIN_TOC_HEIGHT_PX = 140;
const MAX_TOC_HEIGHT_PX = 1200;

const DEFAULTS = {
    [SETTING_FILTER]: true,
    [SETTING_AUTO_REFRESH]: true,
    [SETTING_RESOLVE_BLOCKREFS]: false,
    [SETTING_MAX_WIDTH]: "250px",
    [SETTING_MAX_HEIGHT]: "calc(100vh - 90px)",
    [SETTING_PERSIST_TOC_OPEN]: true,
    [SETTING_PERSIST_SCROLL]: false,
    [SETTING_EXCLUDE_HEADINGS]: "",
    [SETTING_RESPECT_PAGE_FILTERS]: false,
};

let tocSettings = { ...DEFAULTS };
let userIgnoreHeadings = new Set();

const ENABLE_ACTIVE_HIGHLIGHT = true;
const REBUILD_DEBOUNCE_MS = 250;
const MENU_DEBOUNCE_MS = 150;

// ----------------------------------------------
// Widget subtree ignore
// ----------------------------------------------

const DEFAULT_IGNORE_SUBTREES = [
    /^Better Tasks\s*-\s*Today$/i,
    /^Better Tasks\s*-\s*Overdue$/i,
    /^Better Tasks\s*-\s*Upcoming$/i,
    /^Better Tasks\s*-\s*Inbox$/i,
];

// Cache: embedUid -> shouldIgnoreRoot?
const embedIgnoreCache = new Map();

// ----------------------------------------------
// Extension lifecycle
// ----------------------------------------------

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.ui.commandPalette.addCommand({
            label: "Create a Table of Contents (toc)",
            callback: () => createTOC({ silent: false, persist: true }),
        });

        initSettings(extensionAPI);

        initiateUserScrollTracking();
        initiateTopbarObserver();
        initiateNavObserver();
        initiateNavPoll();
        initiateFilterPoll();
        scheduleMenuDivBuild(); // initial
        scheduleAutoOpenFromProps();
    },

    onunload: async () => {
        cleanupTOC();
        cleanupMenu();
        cleanupUserScrollTracking();
        cleanupNavObserver();
        cleanupNavPoll();
        cleanupFilterPoll();
        await removeWatchSafe();
        if (scrollPersistTimer) {
            clearTimeout(scrollPersistTimer);
            scrollPersistTimer = null;
        }
    },
};

// ----------------------------------------------
// Settings init + handlers
// ----------------------------------------------

function initSettings(extensionAPI) {
    // ensure defaults exist
    for (const [k, v] of Object.entries(DEFAULTS)) {
        const cur = extensionAPI.settings.get(k);
        if (cur === null || cur === undefined) extensionAPI.settings.set(k, v);
    }

    tocSettings = readSettings(extensionAPI);

    // Settings UI
    extensionAPI.settings.panel.create({
        tabTitle: "TOC",
        settings: [
            {
                id: SETTING_FILTER,
                name: "Enable filter box in TOC",
                description: "Shows a search/filter box at the top of the TOC.",
                action: {
                    type: "switch",
                    onChange: async (value) => {
                        handleSettingChange(extensionAPI, SETTING_FILTER, value, { rebuild: true, deferRead: true });
                    },
                },
            },
            {
                id: SETTING_AUTO_REFRESH,
                name: "Auto-refresh TOC while editing",
                description: "Rebuild the TOC automatically when headings change.",
                action: {
                    type: "switch",
                    onChange: (value) => {
                        handleSettingChange(extensionAPI, SETTING_AUTO_REFRESH, value, { deferRead: true });
                    },
                },
            },
            {
                id: SETTING_RESOLVE_BLOCKREFS,
                name: "Resolve ((block refs)) in TOC headings",
                description: "Slower on very large pages. Off by default.",
                action: {
                    type: "switch",
                    onChange: (value) => {
                        handleSettingChange(extensionAPI, SETTING_RESOLVE_BLOCKREFS, value, { rebuild: true, deferRead: true });
                    },
                },
            },
            {
                id: SETTING_MAX_WIDTH,
                name: "TOC max width",
                description: 'Any CSS width value, e.g. "250px" or "20rem". (140–600px)',
                action: {
                    type: "input",
                    onChange: (value) => {
                        const v = value?.target?.value ?? value;
                        tocSettings[SETTING_MAX_WIDTH] = sanitizeSizeSetting(v, {
                            minPx: MIN_TOC_WIDTH_PX,
                            maxPx: MAX_TOC_WIDTH_PX,
                            fallback: DEFAULTS[SETTING_MAX_WIDTH],
                        });
                        applyTOCStyleSettings();
                    },
                },
            },
            {
                id: SETTING_MAX_HEIGHT,
                name: "TOC max height",
                description: 'Any CSS height value, e.g. "calc(100vh - 90px)". (140–1200px)',
                action: {
                    type: "input",
                    onChange: (value) => {
                        const v = value?.target?.value ?? value;
                        tocSettings[SETTING_MAX_HEIGHT] = sanitizeSizeSetting(v, {
                            minPx: MIN_TOC_HEIGHT_PX,
                            maxPx: MAX_TOC_HEIGHT_PX,
                            fallback: DEFAULTS[SETTING_MAX_HEIGHT],
                        });
                        applyTOCStyleSettings();
                    },
                },
            },
            {
                id: SETTING_PERSIST_TOC_OPEN,
                name: "Remember TOC open/closed per page",
                description: "Stores open/closed state in page props.",
                action: {
                    type: "switch",
                    onChange: (value) => {
                        handleSettingChange(extensionAPI, SETTING_PERSIST_TOC_OPEN, value, { deferRead: true });
                    },
                },
            },
            {
                id: SETTING_PERSIST_SCROLL,
                name: "Remember scroll position per page",
                description: "Stores the last visible heading uid in page props and restores it on reopen. Off by default.",
                action: {
                    type: "switch",
                    onChange: (value) => {
                        handleSettingChange(extensionAPI, SETTING_PERSIST_SCROLL, value, { deferRead: true });
                    },
                },
            },
            {
                id: SETTING_EXCLUDE_HEADINGS,
                name: "Exclude headings",
                description: "Comma-separated list of heading text to exclude (case-insensitive 'contains' match).",
                action: {
                    type: "input",
                    onChange: (value) => {
                        const v = String(value?.target?.value ?? value ?? "").trim();

                        if (excludeHeadingsTimer) clearTimeout(excludeHeadingsTimer);
                        excludeHeadingsTimer = setTimeout(() => {
                            tocSettings[SETTING_EXCLUDE_HEADINGS] = v;
                            userIgnoreHeadings = parseIgnoreHeadings(v);

                            if (tocShowing) createTOC({ silent: true, persist: false });
                        }, 300);
                    },
                },
            },
            {
                id: SETTING_RESPECT_PAGE_FILTERS,
                name: "Respect page filters",
                description: "Exclude headings that match the page's filter rules (includes/removes).",
                action: {
                    type: "switch",
                    onChange: (value) => {
                        handleSettingChange(extensionAPI, SETTING_RESPECT_PAGE_FILTERS, value, { deferRead: true });
                        if (tocShowing) createTOC({ silent: true, persist: false });
                    },
                },
            },
        ],
    });

    applyTOCStyleSettings();
}

function coerceSettingValue(value) {
    if (value && value.target) {
        if (typeof value.target.checked === "boolean") return value.target.checked;
        return value.target.value;
    }
    return value;
}

function handleSettingChange(
    extensionAPI,
    key,
    value,
    { rebuild = false, applyStyle = false, immediateValue = false, deferRead = false } = {}
) {
    const v = coerceSettingValue(value);

    if (immediateValue && v !== undefined) {
        tocSettings[key] = String(v);
        if (applyStyle) applyTOCStyleSettings();
    }

    const sync = () => {
        tocSettings = readSettings(extensionAPI);
        if (applyStyle) applyTOCStyleSettings();
        if (rebuild && tocShowing) createTOC({ silent: true, persist: false });
    };

    if (deferRead) {
        setTimeout(sync, 30);
    } else {
        sync();
    }
}

function readSettings(extensionAPI) {
    const s = {};
    for (const [k, def] of Object.entries(DEFAULTS)) {
        const v = extensionAPI.settings.get(k);
        s[k] = v === null || v === undefined ? def : v;
    }

    // Normalize booleans
    s[SETTING_FILTER] = normalizeBoolean(s[SETTING_FILTER], DEFAULTS[SETTING_FILTER]);
    s[SETTING_AUTO_REFRESH] = normalizeBoolean(s[SETTING_AUTO_REFRESH], DEFAULTS[SETTING_AUTO_REFRESH]);
    s[SETTING_RESOLVE_BLOCKREFS] = normalizeBoolean(s[SETTING_RESOLVE_BLOCKREFS], DEFAULTS[SETTING_RESOLVE_BLOCKREFS]);
    s[SETTING_PERSIST_TOC_OPEN] = normalizeBoolean(s[SETTING_PERSIST_TOC_OPEN], DEFAULTS[SETTING_PERSIST_TOC_OPEN]);
    s[SETTING_PERSIST_SCROLL] = normalizeBoolean(s[SETTING_PERSIST_SCROLL], DEFAULTS[SETTING_PERSIST_SCROLL]);
    s[SETTING_RESPECT_PAGE_FILTERS] = normalizeBoolean(
        s[SETTING_RESPECT_PAGE_FILTERS],
        DEFAULTS[SETTING_RESPECT_PAGE_FILTERS]
    );

    // Normalize strings
    s[SETTING_MAX_WIDTH] = String(s[SETTING_MAX_WIDTH] || DEFAULTS[SETTING_MAX_WIDTH]).trim();
    s[SETTING_MAX_HEIGHT] = String(s[SETTING_MAX_HEIGHT] || DEFAULTS[SETTING_MAX_HEIGHT]).trim();
    s[SETTING_EXCLUDE_HEADINGS] = String(s[SETTING_EXCLUDE_HEADINGS] || DEFAULTS[SETTING_EXCLUDE_HEADINGS]).trim();

    userIgnoreHeadings = parseIgnoreHeadings(s[SETTING_EXCLUDE_HEADINGS]);

    return s;
}

function normalizeBoolean(v, fallback) {
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
    return fallback;
}

function applyTOCStyleSettings() {
    const toc = document.getElementById("toc");
    if (!toc) return;

    toc.style.maxWidth = sanitizeSizeSetting(tocSettings[SETTING_MAX_WIDTH], {
        minPx: MIN_TOC_WIDTH_PX,
        maxPx: MAX_TOC_WIDTH_PX,
        fallback: DEFAULTS[SETTING_MAX_WIDTH],
    });
    toc.style.maxHeight = sanitizeSizeSetting(tocSettings[SETTING_MAX_HEIGHT], {
        minPx: MIN_TOC_HEIGHT_PX,
        maxPx: MAX_TOC_HEIGHT_PX,
        fallback: DEFAULTS[SETTING_MAX_HEIGHT],
    });
}

function sanitizeSizeSetting(value, { minPx, maxPx, fallback }) {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;

    const m = raw.match(/^(\d+(?:\.\d+)?)(px)?$/);
    if (m) {
        const num = Number(m[1]);
        if (!Number.isFinite(num)) return fallback;
        const clamped = Math.min(maxPx, Math.max(minPx, num));
        return `${Math.round(clamped)}px`;
    }

    if (raw.length > 64) return fallback;
    return raw;
}

// ----------------------------------------------
// Page props helpers
// ----------------------------------------------

async function getPageProps(pageUid) {
    try {
        const res = await window.roamAlphaAPI.q(
            `[:find ?p :where [?b :block/uid "${pageUid}"] [?b :block/props ?p]]`
        );
        return res?.[0]?.[0] || {};
    } catch {
        return {};
    }
}

function queuePagePropsUpdate(pageUid, updater) {
    if (!pageUid) return Promise.resolve();
    const prev = pagePropsQueue.get(pageUid) || Promise.resolve();
    const next = prev
        .catch(() => { })
        .then(() => updater())
        .catch(() => { });
    pagePropsQueue.set(pageUid, next);
    next.finally(() => {
        if (pagePropsQueue.get(pageUid) === next) pagePropsQueue.delete(pageUid);
    });
    return next;
}

async function setPageProp(pageUid, key, value) {
    return queuePagePropsUpdate(pageUid, async () => {
        const props = await getPageProps(pageUid);
        const next = { ...props, [key]: value };
        try {
            await window.roamAlphaAPI.updateBlock({ block: { uid: pageUid, props: next } });
        } catch { }
    });
}

async function getPageProp(pageUid, key) {
    try {
        const props = await getPageProps(pageUid);
        return props ? props[key] : undefined;
    } catch {
        return undefined;
    }
}

async function getPageFiltersForUid(uid) {
    if (!uid) return null;
    try {
        const pageUid = await resolvePageUid(uid);
        const res = await window.roamAlphaAPI?.ui?.filters?.getPageFilters({
            page: { uid: pageUid },
        });
        const includes = Array.isArray(res?.includes) ? res.includes : [];
        const removes = Array.isArray(res?.removes) ? res.removes : [];
        return { includes, removes };
    } catch {
        return null;
    }
}

// ----------------------------------------------
// TOC open state + scroll restore
// ----------------------------------------------

function scheduleAutoOpenFromProps() {
    if (autoOpenInFlight) {
        autoOpenPending = true;
        return;
    }
    autoOpenInFlight = true;

    let tries = 0;

    const finalize = () => {
        autoOpenInFlight = false;
        if (autoOpenPending) {
            autoOpenPending = false;
            scheduleAutoOpenFromProps();
        }
    };

    const attempt = async () => {
        try {
            let uid = await getOpenPageUidSafe();

            if (!uid && isProbablyDnpRoute()) {
                uid = await getTodayDnpUidSafe();
            }

            if (!uid) {
                tries++;
                if (tries < 5) {
                    setTimeout(attempt, 200);
                    return;
                }
                // terminal failure
                finalize();
                return;
            }

            const pageUid = await resolvePageUid(uid);

            // Open state (optional)
            let shouldOpen = false;
            if (tocSettings[SETTING_PERSIST_TOC_OPEN]) {
                shouldOpen = await getTocOpenProp(pageUid);
            }
            lastKnownPageHasTocOpen = !!shouldOpen;

            if (shouldOpen) {
                await createTOC({ silent: true, persist: false, forcedUid: pageUid });
                setTimeout(() => {
                    if (!tocShowing) {
                        createTOC({ silent: true, persist: false, forcedUid: pageUid });
                    }
                }, 600);
                setTimeout(() => {
                    if (!tocShowing) {
                        createTOC({ silent: true, persist: false, forcedUid: pageUid });
                    }
                }, 1400);
            }

            // Scroll restore (optional)
            if (tocSettings[SETTING_PERSIST_SCROLL]) {
                const anchorUid = await getPageProp(pageUid, TOC_SCROLL_UID_KEY);
                if (anchorUid) {
                    // let the page layout settle
                    setTimeout(() => {
                        setActiveTocByUid(anchorUid);
                        activeLockUntil = Date.now() + 800;
                        scrollPersistLockUntil = Date.now() + 3000;
                        lastScrollPersistSource = "restore";
                        setTimeout(() => {
                            if (lastScrollPersistSource === "restore") lastScrollPersistSource = "observer";
                        }, 3200);
                        scrollTo({ shiftKey: false }, anchorUid);
                    }, 250);
                }
            }

            finalize(); // success
        } catch {
            finalize();
        }
    };

    setTimeout(attempt, 200);
}

async function getOpenPageUidSafe() {
    try {
        const uid = await window.roamAlphaAPI?.ui?.mainWindow?.getOpenPageOrBlockUid();
        if (!uid) return null;
        return await resolvePageUid(uid);
    } catch {
        return null;
    }
}

async function resolvePageUid(uid) {
    try {
        const isPage = await window.roamAlphaAPI.q(
            `[:find ?e :where [?e :node/title _] [?e :block/uid "${uid}"]]`
        );
        if (isPage?.length) return uid;
    } catch { }

    try {
        const res = await window.roamAlphaAPI.q(
            `[:find ?puid :where [?b :block/uid "${uid}"] [?b :block/page ?p] [?p :block/uid ?puid]]`
        );
        return res?.[0]?.[0] || uid;
    } catch {
        return uid;
    }
}

async function getTocOpenProp(uid) {
    try {
        const res = await window.roamAlphaAPI.q(
            `[:find ?p :where [?b :block/uid "${uid}"] [?b :block/props ?p]]`
        );
        const props = res?.[0]?.[0];
        if (!props) return false;
        return normalizeBoolean(props[TOC_PROP_KEY], false);
    } catch {
        return false;
    }
}

async function setTocOpenProp(uid, open) {
    return queuePagePropsUpdate(uid, async () => {
        const props = await getPageProps(uid);
        const next = { ...props, [TOC_PROP_KEY]: !!open };
        try {
            await window.roamAlphaAPI.updateBlock({ block: { uid, props: next } });
        } catch {
            // ignore
        }
    });
}

// ----------------------------------------------
// User scroll tracking (gate scroll persistence)
// ----------------------------------------------

function initiateUserScrollTracking() {
    const mark = () => {
        userScrollUntil = Date.now() + 2000;
    };

    const keydownHandler = (e) => {
        const keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"];
        if (keys.includes(e.key)) mark();
    };

    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchstart", mark, { passive: true });
    window.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("keydown", keydownHandler);

    initiateUserScrollTracking._cleanup = () => {
        window.removeEventListener("wheel", mark);
        window.removeEventListener("touchstart", mark);
        window.removeEventListener("scroll", mark);
        window.removeEventListener("keydown", keydownHandler);
    };
}

function cleanupUserScrollTracking() {
    if (typeof initiateUserScrollTracking._cleanup === "function") {
        initiateUserScrollTracking._cleanup();
        initiateUserScrollTracking._cleanup = null;
    }
}

// ----------------------------------------------
// Page filter polling (only when TOC visible + setting enabled)
// ----------------------------------------------

function initiateFilterPoll() {
    if (filterPollTimer) clearInterval(filterPollTimer);
    filterPollTimer = setInterval(async () => {
        if (!tocShowing) return;
        if (!tocSettings[SETTING_RESPECT_PAGE_FILTERS]) return;
        if (document.visibilityState === "hidden") return;

        const uid = await getOpenPageUidSafe();
        if (!uid) return;

        const filters = await getPageFiltersForUid(uid);
        const snapshot = JSON.stringify(filters || {});
        if (snapshot !== lastFilterSnapshot) {
            lastFilterSnapshot = snapshot;
            createTOC({ silent: true, persist: false });
        }
    }, 3000);
}

function cleanupFilterPoll() {
    if (filterPollTimer) {
        clearInterval(filterPollTimer);
        filterPollTimer = null;
    }
    lastFilterSnapshot = "";
}

// ----------------------------------------------
// Menu button + observer (topbar changes / sidebar toggles)
// ----------------------------------------------

function initiateTopbarObserver() {
    const topbar = document.getElementsByClassName("rm-topbar")[0];
    if (!topbar) return;

    const isMenuNode = (node) => {
        if (!node || node.nodeType !== 1) return false;
        if (node.id === "tableOfContents") return true;
        if (typeof node.closest === "function" && node.closest("#tableOfContents")) return true;
        return false;
    };

    const isOnlyMenuMutation = (nodes) => {
        if (!nodes || !nodes.length) return false;
        for (const n of nodes) {
            if (!isMenuNode(n)) return false;
        }
        return true;
    };

    const config = { attributes: false, childList: true, subtree: true };

    const callback = (mutationsList) => {
        for (const mutation of mutationsList) {
            if (isOnlyMenuMutation(mutation.addedNodes) || isOnlyMenuMutation(mutation.removedNodes)) continue;
            if (mutation.addedNodes?.length || mutation.removedNodes?.length) {
                scheduleMenuDivBuild();
                break;
            }
        }
    };

    try {
        menuObserver = new MutationObserver(callback);
        menuObserver.observe(topbar, config);
    } catch {
        // fail silently
    }
}

// ----------------------------------------------
// Navigation observer
// ----------------------------------------------

function initiateNavObserver() {
    const target =
        document.querySelector("div.roam-body-main") ||
        document.querySelector("div.roam-main") ||
        document.body;

    if (!target) return;

    const callback = () => {
        scheduleNavCheck();
    };

    try {
        navObserver = new MutationObserver(callback);
        navObserver.observe(target, { childList: true, subtree: true });
    } catch {
        navObserver = null;
    }

    updateCurrentPageUid({ initial: true });
}

function cleanupNavObserver() {
    if (navObserver) {
        try {
            navObserver.disconnect();
        } catch { }
        navObserver = null;
    }
    if (navTimer) {
        clearTimeout(navTimer);
        navTimer = null;
    }
}

function initiateNavPoll() {
    if (navPollTimer) clearInterval(navPollTimer);
    navPollTimer = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        const now = Date.now();
        const minInterval =
            lastKnownPageUid === null || tocShowing || lastKnownPageHasTocOpen ? 500 : 2000;
        if (now - lastNavPollTs < minInterval) return;
        lastNavPollTs = now;
        updateCurrentPageUid({ initial: false });
    }, 500);
}

function cleanupNavPoll() {
    if (navPollTimer) {
        clearInterval(navPollTimer);
        navPollTimer = null;
    }
}

function cleanupMenu() {
    if (menuObserver) {
        try {
            menuObserver.disconnect();
        } catch { }
        menuObserver = null;
    }
    if (menuTimer) {
        clearTimeout(menuTimer);
        menuTimer = null;
    }

    const btn = document.getElementById("tableOfContents");
    if (btn) btn.remove();
}

function scheduleNavCheck() {
    if (navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(() => {
        updateCurrentPageUid({ initial: false });
    }, 200);
}

async function updateCurrentPageUid({ initial = false } = {}) {
    const uid = await getOpenPageUidSafe();
    if (!uid) {
        if (lastKnownPageUid !== null) {
            lastKnownPageUid = null;
            lastKnownPageHasTocOpen = false;
            if (!initial) {
                cleanupTOC();
                await removeWatchSafe();
                tocShowing = false;
            }
        }
        return;
    }
    if (uid !== lastKnownPageUid) {
        lastKnownPageUid = uid;
        lastKnownPageHasTocOpen = false;
        lastFilterSnapshot = "";
        if (!initial) {
            cleanupTOC();
            await removeWatchSafe();
            tocShowing = false;
        }
        scheduleAutoOpenFromProps();
    }
}

function scheduleMenuDivBuild() {
    if (menuTimer) clearTimeout(menuTimer);
    menuTimer = setTimeout(() => createMenuDiv(), MENU_DEBOUNCE_MS);
}

async function createMenuDiv() {
    if (menuBuilding) return;
    menuBuilding = true;

    try {
        const existing = document.getElementById("tableOfContents");
        if (existing) existing.remove();

        const div = document.createElement("div");
        div.classList.add("flex-items");
        div.id = "tableOfContents";
        div.style.cursor = "pointer";
        div.style.webkitAppRegion = "no-drag";
        div.style.pointerEvents = "auto";
        div.setAttribute("role", "button");
        div.setAttribute("tabindex", "0");
        div.addEventListener("click", toggleTOC);
        div.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleTOC();
            }
        });

        const span = document.createElement("span");
        span.classList.add("bp3-button", "bp3-minimal", "bp3-small", "bp3-icon-properties");
        span.style.pointerEvents = "none";
        div.prepend(span);

        const place = () => {
            const ws = document.querySelector("#workspaces");
            if (ws) {
                ws.after(div);
                return true;
            }
            const tt = document.querySelector("#todayTomorrow");
            if (tt) {
                tt.after(div);
                return true;
            }
            const electronForward = document.getElementsByClassName("rm-electron-nav-forward-btn")[0];
            if (electronForward) {
                electronForward.after(div);
                return true;
            }
            const sidebarBtn = document.querySelector(".rm-open-left-sidebar-btn");
            if (sidebarBtn) {
                sidebarBtn.after(div);
                return true;
            }
            const topBarContent = document.querySelector(
                "#app > div > div > div.flex-h-box > div.roam-main > div.rm-files-dropzone > div"
            );
            if (topBarContent?.childNodes?.[1]) {
                const topBarRow = topBarContent.childNodes[1];
                topBarRow.parentNode.insertBefore(div, topBarRow);
                return true;
            }
            return false;
        };

        let tries = 0;
        while (!place() && tries < 6) {
            await raf();
            tries++;
        }

        if (tocShowing) setButtonActive();
    } finally {
        menuBuilding = false;
    }
}

// ----------------------------------------------
// TOC build + teardown
// ----------------------------------------------

async function createTOC({
    silent = true,
    persist = true,
    attempt = 0,
    forcedUid = null,
    notifyOnEmpty = false,
} = {}) {
    if (building) return;
    building = true;

    try {
        if (forcedUid) {
            parentUid = forcedUid;
        } else {
            parentUid = await getOpenPageUidSafe();
        }

        if (!parentUid && isProbablyDnpRoute()) {
            parentUid = await getTodayDnpUidSafe();
        }

        if (!parentUid) {
            if (attempt < 3) {
                setTimeout(() => {
                    createTOC({
                        silent,
                        persist,
                        attempt: attempt + 1,
                        forcedUid,
                        notifyOnEmpty,
                    });
                }, 200);
                return;
            }
            if (!silent) notify("No open page/block detected.");
            return;
        }

        if (tocSettings[SETTING_AUTO_REFRESH]) {
            await ensureWatchForUid(parentUid);
        } else {
            await removeWatchSafe();
        }

        const blocks = await getTreeByParentUid(parentUid);

        removeTOCContainerOnly();

        if (!blocks) {
            unsetButtonActive();
            if (notifyOnEmpty || !silent) notify("There are no eligible headings on this page!");
            tocShowing = false;
            return;
        }

        // Track augmented heading tags (if installed)
        h4Tag = localStorage.getItem("augmented_headings:h4") || undefined;
        h5Tag = localStorage.getItem("augmented_headings:h5") || undefined;
        h6Tag = localStorage.getItem("augmented_headings:h6") || undefined;

        const pageFilters = tocSettings[SETTING_RESPECT_PAGE_FILTERS]
            ? await getPageFiltersForUid(parentUid)
            : null;
        let headings = await collectHeadings(blocks, pageFilters);
        headings = await filterHeadingsForIgnore(headings);

        if (!headings.length) {
            unsetButtonActive();
            await removeWatchSafe();
            if (notifyOnEmpty || !silent) notify("There are no eligible headings on this page!");
            tocShowing = false;
            return;
        }

        injectHeadingStyleCSS();

        const tocEl = await buildTOCElement(headings);
        const inserted = insertTOCIntoDOM(tocEl);
        if (!inserted) {
            if (attempt < 3) {
                setTimeout(() => {
                    createTOC({
                        silent: true,
                        persist: false,
                        attempt: attempt + 1,
                        forcedUid: parentUid,
                    });
                }, 200);
            }
            return;
        }

        applyTOCStyleSettings();

        setButtonActive();
        await ensureButtonActive();
        tocShowing = true;
        attachHashchangeTeardown();

        if (persist && tocSettings[SETTING_PERSIST_TOC_OPEN]) {
            const pageUid = await resolvePageUid(parentUid);
            await setTocOpenProp(pageUid, true);
        }

        if (ENABLE_ACTIVE_HIGHLIGHT) {
            setupActiveHeadingObserver(headings);
        }
    } catch {
        unsetButtonActive();
        tocShowing = false;
        if (!silent) notify("TOC failed to build (see console for details).");
    } finally {
        building = false;
    }
}

async function buildTOCElement(headings) {
    const container = document.createElement("div");
    container.classList.add("toc-container");
    container.id = "toc";

    if (tocSettings[SETTING_FILTER]) {
        const input = document.createElement("input");
        input.className = "toc-filter";
        input.type = "text";
        input.placeholder = "Filter…";
        input.autocomplete = "off";
        input.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            for (const el of container.querySelectorAll("[data-toc-item='1']")) {
                const text = (el.textContent || "").toLowerCase();
                el.style.display = !q || text.includes(q) ? "" : "none";
            }
        });
        container.appendChild(input);
    }

    for (let i = 0; i < headings.length; i++) {
        const h = headings[i];
        if (typeof h.text === "string" && h.text.startsWith("${{calc")) continue;

        const item = document.createElement("div");
        item.dataset.tocItem = "1";
        item.dataset.uid = h.uid;
        item.id = `toc${i}`;

        const tocLevel = `toc-${h.heading}`;
        item.classList.add(tocLevel);

        let text = stripHeadingMarkup(h.text);

        if (tocSettings[SETTING_RESOLVE_BLOCKREFS]) {
            text = await resolveBlockRefsInText(text);
        }

        // Defensive: prevent huge multi-line items
        text = String(text ?? "").split("\n")[0].trim();

        item.textContent = text;
        item.onclick = (e) => {
            setActiveTocByUid(h.uid);
            activeLockUntil = Date.now() + 800;
            lastScrollPersistSource = "click";
            setTimeout(() => {
                if (lastScrollPersistSource === "click") lastScrollPersistSource = "observer";
            }, 900);
            if (tocSettings[SETTING_PERSIST_SCROLL] && parentUid) {
                if (scrollPersistTimer) clearTimeout(scrollPersistTimer);
                lastPersistedScrollUid = h.uid;
                Promise.resolve(resolvePageUid(parentUid)).then((pageUid) => {
                    setPageProp(pageUid, TOC_SCROLL_UID_KEY, h.uid);
                });
            }
            scrollTo(e, h.uid);
        };

        container.appendChild(item);
    }

    return container;
}

function insertTOCIntoDOM(divParent) {
    const mainRoam = document.querySelector("div.roam-body-main");
    if (!mainRoam?.childNodes?.[0]) return false;
    const position = mainRoam.childNodes[0];
    position.after(divParent);
    return true;
}

function attachHashchangeTeardown() {
    if (hashChangeHandler) {
        window.removeEventListener("hashchange", hashChangeHandler);
        hashChangeHandler = null;
    }

    hashChangeHandler = async () => {
        cleanupTOC();
        await removeWatchSafe();
        tocShowing = false;

        window.removeEventListener("hashchange", hashChangeHandler);
        hashChangeHandler = null;

        scheduleAutoOpenFromProps();
    };

    window.addEventListener("hashchange", hashChangeHandler);
}

function cleanupTOC() {
    if (rebuildTimer) {
        clearTimeout(rebuildTimer);
        rebuildTimer = null;
    }
    teardownActiveHeadingObserver();
    removeTOCContainerOnly();
    unsetButtonActive();
    if (excludeHeadingsTimer) {
        clearTimeout(excludeHeadingsTimer);
        excludeHeadingsTimer = null;
    }

    if (hashChangeHandler) {
        window.removeEventListener("hashchange", hashChangeHandler);
        hashChangeHandler = null;
    }
}

function removeTOCContainerOnly() {
    const toc = document.getElementById("toc");
    if (toc) toc.remove();
}

function setButtonActive() {
    const button = document.getElementById("tableOfContents");
    if (!button) return;
    button.style.backgroundColor = "#15e891";
    button.style.borderRadius = "5px";
}

function unsetButtonActive() {
    const button = document.getElementById("tableOfContents");
    if (!button) return;
    button.style.backgroundColor = "";
    button.style.borderRadius = "";
}

async function ensureButtonActive() {
    for (let i = 0; i < 6; i++) {
        const button = document.getElementById("tableOfContents");
        if (button) {
            button.style.backgroundColor = "#15e891";
            button.style.borderRadius = "5px";
            return;
        }
        await raf();
    }
}

// ----------------------------------------------
// Pull watch management + debounced rebuild
// ----------------------------------------------

async function ensureWatchForUid(uid) {
    if (watchActive && watchUid && watchUid !== uid) {
        await removeWatchSafe();
    }

    if (watchActive && watchUid === uid) return;

    try {
        await window.roamAlphaAPI.data.addPullWatch(PULL_PATTERN, `[:block/uid "${uid}"]`, pullFunction);
        watchActive = true;
        watchUid = uid;
    } catch {
        watchActive = false;
        watchUid = null;
    }
}

async function removeWatchSafe() {
    if (!watchActive || !watchUid) return;

    try {
        await window.roamAlphaAPI.data.removePullWatch(PULL_PATTERN, `[:block/uid "${watchUid}"]`, pullFunction);
    } catch {
        // ignore
    } finally {
        watchActive = false;
        watchUid = null;
    }
}

async function pullFunction(before, after) {
    if (!tocShowing) return;
    if (!tocSettings[SETTING_AUTO_REFRESH]) return;

    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
        createTOC({ silent: true, persist: false });
    }, REBUILD_DEBOUNCE_MS);
}

// ----------------------------------------------
// Toggle
// ----------------------------------------------

async function toggleTOC() {
    if (tocShowing) {
        cleanupTOC();
        await removeWatchSafe();
        tocShowing = false;

        if (parentUid && tocSettings[SETTING_PERSIST_TOC_OPEN]) {
            const pageUid = await resolvePageUid(parentUid);
            await setTocOpenProp(pageUid, false);
        }
    } else {
        await createTOC({ silent: true, persist: true, notifyOnEmpty: true });
    }
}

// ----------------------------------------------
// Headings collection (filters out widgets/embeds)
// ----------------------------------------------

function normalizeRootTextForMatch(s) {
    const t = stripHeadingMarkup(String(s ?? "")).split("\n")[0].trim();
    return t;
}

function shouldIgnoreSubtreeRootText(blockString) {
    const t = normalizeRootTextForMatch(blockString);
    if (!t) return false;
    const lower = t.toLowerCase();
    if (DEFAULT_IGNORE_SUBTREES.some((re) => re.test(t))) return true;
    for (const s of userIgnoreHeadings) {
        if (lower.includes(s)) return true;
    }
    return false;
}

function parseIgnoreHeadings(value) {
    const raw = String(value ?? "");
    return new Set(
        raw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
    );
}

function normalizeHeadingForIgnore(text) {
    return stripHeadingMarkup(String(text ?? "")).split("\n")[0].trim().toLowerCase();
}

async function filterHeadingsForIgnore(headings) {
    if (!userIgnoreHeadings.size) return headings;
    const out = [];
    const hasBlockRef = (s) => /\(\(([A-Za-z0-9_-]{9,10})\)\)/.test(String(s ?? ""));

    for (const h of headings) {
        let checkText = h.text || "";
        if (tocSettings[SETTING_RESOLVE_BLOCKREFS] && hasBlockRef(checkText)) {
            try {
                checkText = await resolveBlockRefsInText(checkText);
            } catch {
                // ignore resolution errors; fall back to raw text
            }
        }

        const norm = normalizeHeadingForIgnore(checkText);
        let skip = false;
        for (const s of userIgnoreHeadings) {
            if (norm.includes(s)) {
                skip = true;
                break;
            }
        }
        if (skip) continue;
        out.push(h);
    }

    return out;
}

function extractEmbedUid(s) {
    const str = String(s ?? "");

    const m =
        str.match(/\{\{\s*\[\[embed\]\]\s*:\s*\(\(([A-Za-z0-9_-]{9,10})\)\)\s*\}\}/i) ||
        str.match(/\{\{\s*embed\s*:\s*\(\(([A-Za-z0-9_-]{9,10})\)\)\s*\}\}/i);
    return m?.[1] || null;
}

async function shouldIgnoreNode(x) {
    const s = x?.string || "";
    if (shouldIgnoreSubtreeRootText(s)) return true;

    const embedUid = extractEmbedUid(s);
    if (!embedUid) return false;

    if (embedIgnoreCache.has(embedUid)) return embedIgnoreCache.get(embedUid);

    let embeddedString = "";
    try {
        const pulled = await window.roamAlphaAPI.pull("[:block/string]", [":block/uid", embedUid]);
        embeddedString = pulled?.[":block/string"] || "";
    } catch {
        embeddedString = "";
    }

    const ignore = shouldIgnoreSubtreeRootText(embeddedString);
    embedIgnoreCache.set(embedUid, ignore);
    if (embedIgnoreCache.size > 500) embedIgnoreCache.clear();
    return ignore;
}

async function collectHeadings(blocks, pageFilters = null) {
    const headings = [];
    const flagsMap = new WeakMap();
    const ignoreMap = new WeakMap();

    await computeSubtreeFlags(blocks);
    await traverseCollect(blocks, headings, false);
    return headings;

    async function isIgnored(node) {
        if (!node) return false;
        if (ignoreMap.has(node)) return ignoreMap.get(node);
        const ignore = await shouldIgnoreNode(node);
        ignoreMap.set(node, ignore);
        return ignore;
    }

    async function computeSubtreeFlags(nodes) {
        sortObjectsByOrder(nodes);
        let anyHasInclude = false;

        for (const x of nodes) {
            if (!x) continue;
            if (await isIgnored(x)) continue;

            const s = x.string || "";
            const nodeHasInclude = pageFilters?.includes?.some((t) => s.includes(t)) || false;
            const nodeHasRemove = pageFilters?.removes?.some((t) => s.includes(t)) || false;

            const children = Array.isArray(x.children) ? x.children : [];
            let childHasInclude = false;
            if (children.length) {
                const res = await computeSubtreeFlags(children);
                childHasInclude = res.hasInclude;
            }

            const subtreeHasInclude = nodeHasInclude || childHasInclude;
            flagsMap.set(x, { hasInclude: subtreeHasInclude, hasRemove: nodeHasRemove });

            anyHasInclude = anyHasInclude || subtreeHasInclude;
        }

        return { hasInclude: anyHasInclude, hasRemove: false };
    }

    async function traverseCollect(nodes, out, ancestorHasInclude) {
        sortObjectsByOrder(nodes);

        for (const x of nodes) {
            if (!x) continue;
            if (await isIgnored(x)) continue;

            const s = x.string || "";
            const nodeHasInclude = pageFilters?.includes?.some((t) => s.includes(t)) || false;
            const nodeHasRemove = pageFilters?.removes?.some((t) => s.includes(t)) || false;
            const children = Array.isArray(x.children) ? x.children : [];
            const flags = flagsMap.get(x) || { hasInclude: nodeHasInclude, hasRemove: nodeHasRemove };
            const includeActive = !!pageFilters?.includes?.length;
            const removeActive = !!pageFilters?.removes?.length;
            const subtreeHasInclude = flags.hasInclude || nodeHasInclude;

            if (includeActive && !(ancestorHasInclude || subtreeHasInclude)) {
                continue; // prune subtree
            }
            if (removeActive && nodeHasRemove) {
                continue; // prune subtree
            }

            if (Object.prototype.hasOwnProperty.call(x, "heading") && x.heading && x.heading !== 0) {
                out.push({ text: s || "", heading: x.heading, uid: x.uid });
            } else {
                if (h4Tag && s.includes(h4Tag)) {
                    out.push({ text: cleanAugmentedHeading(s, h4Tag), heading: 4, uid: x.uid });
                } else if (h5Tag && s.includes(h5Tag)) {
                    out.push({ text: cleanAugmentedHeading(s, h5Tag), heading: 5, uid: x.uid });
                } else if (h6Tag && s.includes(h6Tag)) {
                    out.push({ text: cleanAugmentedHeading(s, h6Tag), heading: 6, uid: x.uid });
                }
            }

            if (children.length) {
                await traverseCollect(
                    children,
                    out,
                    ancestorHasInclude || nodeHasInclude
                );
            }
        }
    }
}

function cleanAugmentedHeading(str, tag) {
    let s = str.replace(`#${tag}`, "");
    s = s.replaceAll("^^", "");
    return s.trim();
}

function stripHeadingMarkup(text) {
    let headingText = String(text ?? "");

    headingText = headingText.replaceAll("**", "");
    headingText = headingText.replaceAll("__", "");
    headingText = headingText.replaceAll("::", "");
    headingText = headingText.replaceAll("[[", "");
    headingText = headingText.replaceAll("]]", "");

    const regex1 = /^#(h\d)\^\^(.+)\^\^$/;
    if (regex1.test(headingText)) {
        const m = headingText.match(regex1);
        if (m?.[2]) headingText = m[2];
    }

    return headingText.trim();
}

async function resolveBlockRefsInText(text) {
    const s = String(text ?? "");
    const re = /\(\(([A-Za-z0-9_-]{9,10})\)\)/g;

    const uids = new Set();
    let m;
    while ((m = re.exec(s)) !== null) {
        if (m[1]) uids.add(m[1]);
    }
    if (!uids.size) return s;

    const map = new Map();
    for (const uid of uids) {
        try {
            const pulled = await window.roamAlphaAPI.pull("[:block/string]", [":block/uid", uid]);
            const blockString = pulled?.[":block/string"];
            if (blockString) map.set(uid, blockString);
        } catch { }
    }

    return s.replace(re, (_, uid) => map.get(uid) || `((${uid}))`);
}

// ----------------------------------------------
// Heading CSS injection (font sizes/colors)
// ----------------------------------------------

function injectHeadingStyleCSS() {
    let cssString = "";

    const h1El = document.querySelector(".rm-heading-level-1>.rm-block__self .rm-block__input");
    const h2El = document.querySelector(".rm-heading-level-2>.rm-block__self .rm-block__input");
    const h3El = document.querySelector(".rm-heading-level-3>.rm-block__self .rm-block__input");

    if (h1El) cssString += mkHeadingCSS(".toc-1", h1El);
    if (h2El) cssString += mkHeadingCSS(".toc-2", h2El);
    if (h3El) cssString += mkHeadingCSS(".toc-3", h3El);

    // Augmented headings: infer styles from highlighted tag spans if present
    if (h4Tag) {
        const h4 = document.querySelector(`[data-tag^='${cssEscape(h4Tag)}'] + .rm-highlight`);
        if (h4) cssString += mkHeadingCSS(".toc-4", h4, true);
    }
    if (h5Tag) {
        const h5 = document.querySelector(`[data-tag^='${cssEscape(h5Tag)}'] + .rm-highlight`);
        if (h5) cssString += mkHeadingCSS(".toc-5", h5, true);
    }
    if (h6Tag) {
        const h6 = document.querySelector(`[data-tag^='${cssEscape(h6Tag)}'] + .rm-highlight`);
        if (h6) cssString += mkHeadingCSS(".toc-6", h6, true);
    }

    const head = document.getElementsByTagName("head")[0];
    if (!head) return;

    const existing = document.getElementById("toc-css");
    if (existing) existing.remove();

    if (!cssString) return;

    const style = document.createElement("style");
    style.id = "toc-css";
    style.textContent = cssString;
    head.appendChild(style);
}

function mkHeadingCSS(selector, el, includeFontStyle = false) {
    const comp = window.getComputedStyle(el);
    const size = comp.fontSize;
    const weight = comp.fontWeight;
    const color = comp.color;

    let css = `${selector}{font-size:${size} !important;font-weight:${weight} !important;color:${color} !important;}`;

    if (includeFontStyle) {
        const fontStyle = comp.fontStyle;
        const fontVariant = comp.fontVariant;
        css = `${selector}{font-size:${size} !important;font-weight:${weight} !important;color:${color} !important;font-style:${fontStyle} !important;font-variant:${fontVariant} !important;}`;
    }

    return css + " ";
}

function cssEscape(s) {
    return String(s).replace(/['\\]/g, "\\$&");
}

// ----------------------------------------------
// Active heading highlighting (+ scroll persistence)
// ----------------------------------------------

function teardownActiveHeadingObserver() {
    if (activeIO) {
        try {
            activeIO.disconnect();
        } catch { }
        activeIO = null;
    }
    activeTocId = null;
}

function schedulePersistScrollUid(pageUid, headingUid) {
    if (!pageUid || !headingUid) return;
    if (!tocSettings[SETTING_PERSIST_SCROLL]) return;

    if (headingUid === lastPersistedScrollUid) return;

    if (scrollPersistTimer) clearTimeout(scrollPersistTimer);
    scrollPersistTimer = setTimeout(async () => {
        try {
            lastPersistedScrollUid = headingUid;
            await setPageProp(pageUid, TOC_SCROLL_UID_KEY, headingUid);
        } catch { }
    }, 800);
}

function setupActiveHeadingObserver(headings) {
    teardownActiveHeadingObserver();

    const uidToTocEl = new Map();
    const toc = document.getElementById("toc");
    if (!toc) return;

    for (const el of toc.querySelectorAll("[data-toc-item='1']")) {
        const uid = el.dataset.uid;
        if (uid) uidToTocEl.set(uid, el);
    }

    const targets = [];
    for (const h of headings) {
        const el = findBlockElementForUid(h.uid);
        if (!el) continue;

        const isInput = el.classList?.contains("rm-block__input");
        const targetEl = isInput
            ? el
            : el?.closest?.(".rm-block__input") ||
            el?.closest?.(".roam-block-container") ||
            el?.closest?.(".rm-block") ||
            el;

        if (targetEl) targets.push({ uid: h.uid, el: targetEl });
    }

    if (!targets.length) return;

    activeIO = new IntersectionObserver(
        (entries) => {
            if (Date.now() < activeLockUntil) return;
            const visible = entries
                .filter((e) => e.isIntersecting)
                .map((e) => ({ uid: e.target.getAttribute("data-uid"), top: e.boundingClientRect.top }))
                .filter((x) => x.uid);

            if (!visible.length) return;

            visible.sort((a, b) => a.top - b.top);
            const chosen = visible[0].uid;
            if (!chosen) return;

            if (activeTocId && uidToTocEl.get(activeTocId)) {
                uidToTocEl.get(activeTocId).classList.remove("toc-active");
            }
            activeTocId = chosen;
            if (uidToTocEl.get(chosen)) {
                uidToTocEl.get(chosen).classList.add("toc-active");
            }

            if (tocSettings[SETTING_PERSIST_SCROLL] && parentUid) {
                if (
                    Date.now() >= scrollPersistLockUntil &&
                    lastScrollPersistSource === "observer" &&
                    Date.now() < userScrollUntil
                ) {
                    Promise.resolve(resolvePageUid(parentUid)).then((pageUid) => {
                        schedulePersistScrollUid(pageUid, chosen);
                    });
                }
            }
        },
        { root: null, threshold: 0.01, rootMargin: "-80px 0px -70% 0px" }
    );

    for (const t of targets) {
        try {
            t.el.setAttribute("data-uid", t.uid);
            activeIO.observe(t.el);
        } catch { }
    }
}

function setActiveTocByUid(uid) {
    const toc = document.getElementById("toc");
    if (!toc || !uid) return;

    if (activeTocId) {
        const prev = toc.querySelector(`[data-uid="${cssEscapeAttr(activeTocId)}"]`);
        if (prev) prev.classList.remove("toc-active");
    }

    const next = toc.querySelector(`[data-uid="${cssEscapeAttr(uid)}"]`);
    if (next) next.classList.add("toc-active");
    activeTocId = uid;
}

function findBlockElementForUid(uid) {
    if (!uid) return null;

    const safeUid = cssEscapeAttr(uid);

    let el =
        document.querySelector(`.rm-block__input[id$="-${safeUid}"]`) ||
        document.querySelector(`.rm-block__input[id*="-${safeUid}"]`);
    if (el) return el;

    el =
        document.querySelector(`[id$="-${safeUid}"]`) ||
        document.querySelector(`[id*="-${safeUid}"]`);
    return el || null;
}

function cssEscapeAttr(s) {
    return String(s).replace(/["\\\]]/g, "\\$&");
}

// ----------------------------------------------
// Scroll to heading (click)
// ----------------------------------------------

function pullUid(x) {
    return x?.uid ?? x?.[":block/uid"] ?? x?.[":node/uid"] ?? undefined;
}
function pullOpen(x) {
    return x?.open ?? x?.[":block/open"] ?? undefined;
}
function pullParents(x) {
    return x?.parents ?? x?.[":block/parents"] ?? [];
}

async function scrollTo(e, uid) {
    const openInSidebar = !!(e.shiftKey);

    if (openInSidebar) {
        await window.roamAlphaAPI.ui.rightSidebar.open();
        await window.roamAlphaAPI.ui.rightSidebar.addWindow({ window: { type: "outline", "block-uid": uid } });
        return;
    }

    // Open closed parents so target exists in DOM
    try {
        const q = `[:find (pull ?page [:block/uid :block/open {:block/parents ...}])
               :where [?page :block/uid "${uid}"]]`;
        const results = await window.roamAlphaAPI.q(q);
        const pulled = results?.[0]?.[0];

        const parents = pullParents(pulled) || [];
        for (const p of parents) {
            const isOpen = pullOpen(p);
            const puid = pullUid(p);
            if (isOpen === false && puid) {
                window.roamAlphaAPI.updateBlock({ block: { uid: puid, open: true } });
            }
        }
    } catch {
        // ignore; still try scroll
    }

    let target = null;
    for (let i = 0; i < 6; i++) {
        target = findBlockElementForUid(uid);
        if (target) break;
        await raf();
    }

    if (target) {
        const container =
            target?.closest?.(".roam-block-container") ||
            target?.closest?.(".rm-block") ||
            target;

        if (container) container.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
        notify("Couldn't find that heading on screen (it may be inside a collapsed region).");
    }
}

// ----------------------------------------------
// Data: get block tree
// ----------------------------------------------

async function getTreeByParentUid(uid) {
    const res = await window.roamAlphaAPI.q(
        `[:find (pull ?b [
        :block/string
        :block/uid
        :block/order
        :block/heading
        {:block/children ...}
      ])
      :where [?b :block/uid "${uid}"]]`
    );

    const children = res?.[0]?.[0]?.children;
    if (!children) return undefined;

    sortObjectsByOrder(children);
    return children;
}

function sortObjectsByOrder(o) {
    if (!Array.isArray(o)) return o;
    return o.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// ----------------------------------------------
// Utilities
// ----------------------------------------------

function raf() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function notify(message) {
    try {
        iziToast.show({
            message: String(message ?? ""),
            position: "bottomRight",
            timeout: 2200,
            close: false,
            displayMode: 1,
        });
    } catch {
        alert(message);
    }
}

function isProbablyDnpRoute() {
    try {
        const hash = String(window.location.hash || "");
        const isAppRoot = /^#\/app\/[^/]+(?:\?.*)?$/.test(hash);
        const isExplicitPage = /^#\/app\/[^/]+\/page\/.+/.test(hash);
        const isExplicitBlock = /^#\/app\/[^/]+\/(?:page|block)\/.+/.test(hash);

        return isAppRoot && !isExplicitPage && !isExplicitBlock;
    } catch {
        return false;
    }
}

async function getTodayDnpUidSafe() {
    try {
        const date = new Date();
        const uid = await window.roamAlphaAPI?.util?.dateToPageUid?.(date);
        if (uid) return uid;
    } catch { }
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}-${dd}-${yyyy}`;
}
