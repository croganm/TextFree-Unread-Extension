const STORAGE_KEY = "localUnreadDigits";
const RECON_SRC = "textfree-unread-reconcile";

function digitsFromContactText(text) {
  return String(text || "").replace(/\D/g, "");
}

function findConversationRow(el) {
  return el && el.closest && el.closest("ion-item-sliding");
}

/** @type {Set<string>} */
let localUnreadDigits = new Set();

/** Row whose ⋮ menu is open (set on capture click). */
let lastRowForPopover = null;

function loadStorage(cb) {
  chrome.storage.local.get([STORAGE_KEY], (data) => {
    const arr = data[STORAGE_KEY];
    localUnreadDigits = new Set(
      Array.isArray(arr) ? arr.map((d) => String(d).replace(/\D/g, "")).filter(Boolean) : []
    );
    cb();
  });
}

function persistStorage() {
  chrome.storage.local.set({
    [STORAGE_KEY]: [...localUnreadDigits],
  });
}

function applyRowUnreadState(row) {
  if (!row) return;
  const contact = row.querySelector(".contact");
  const digits = digitsFromContactText(contact && contact.textContent);
  if (!digits) return;
  const on = localUnreadDigits.has(digits);
  row.classList.toggle("textfree-local-unread", on);
}

function applyLocalUnreadToAllRows() {
  document.querySelectorAll("ion-item-sliding:has(.contact)").forEach(applyRowUnreadState);
}

async function copyDigitsToClipboard(digits) {
  const text = String(digits).replace(/\D/g, "");
  if (!text) {
    showToast("Nothing to copy", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Number copied");
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("Number copied");
    } catch (e2) {
      showToast("Could not copy", true);
    }
  }
}

async function copyPlainTextToClipboard(text, okMessage) {
  const t = String(text || "");
  if (!t) {
    showToast("Nothing to copy", true);
    return;
  }
  const msg = okMessage || "Copied";
  try {
    await navigator.clipboard.writeText(t);
    showToast(msg);
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast(msg);
    } catch (e2) {
      showToast("Could not copy", true);
    }
  }
}

function isActiveConversationRoute() {
  const m = location.pathname.match(/\/conversation\/([^/]+)/);
  return !!(m && m[1] && m[1] !== "empty");
}

/**
 * Angular can keep multiple `.address-header` nodes (e.g. outlets). `querySelector` always
 * returns the first, which may be stale; the visible thread often uses a later sibling.
 * Prefer the header whose phone matches the current route, then the last visible one.
 */
function getAddressHeaderHost() {
  const nodes = document.querySelectorAll(".address-header");
  if (!nodes.length) return null;
  const pathDigits = getConversationPathDigits();
  if (pathDigits) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const h = nodes[i];
      if (!h.isConnected) continue;
      const r = h.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const lab = getAddressHeaderPhoneLabelForHost(h);
      const d = digitsFromContactText(lab && lab.textContent);
      if (d && pathDigitsMatchStored(pathDigits, d)) return h;
    }
  }
  const visible = [];
  for (const h of nodes) {
    if (!h.isConnected) continue;
    const r = h.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) visible.push(h);
  }
  if (visible.length) return visible[visible.length - 1];
  return nodes[nodes.length - 1];
}

/** Label resolution for a specific header host (no global lookup). */
function getAddressHeaderPhoneLabelForHost(host) {
  if (!host) return null;
  const scope =
    host.querySelector("sc-address-bar, #recentContactsContainer") || host;
  const labels = scope.querySelectorAll(
    "ion-label.phone-name, .address-selected ion-label"
  );
  if (!labels.length) return null;
  for (const l of labels) {
    const r = l.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return l;
  }
  return labels[labels.length - 1];
}

/**
 * Prefer the visible phone label in the address toolbar. `querySelector` alone can match a
 * stale/hidden node after SPA navigation, which made us skip injecting the copy controls.
 */
function getAddressHeaderPhoneLabel(host) {
  return getAddressHeaderPhoneLabelForHost(host);
}

/** @type {number | null} */
let headerEnsureTimer = null;

function scheduleHeaderEnsureDebounced() {
  if (headerEnsureTimer != null) clearTimeout(headerEnsureTimer);
  headerEnsureTimer = window.setTimeout(() => {
    headerEnsureTimer = null;
    ensureAddressHeaderCopyButton();
    ensureCopyConversationBar();
  }, 80);
}

function scheduleHeaderEnsure() {
  const delays = [0, 50, 100, 250, 500, 1000, 2000];
  for (const d of delays) {
    setTimeout(() => {
      ensureAddressHeaderCopyButton();
      ensureCopyConversationBar();
    }, d);
  }
}

function mutationTouchesAddressHeader(m) {
  const t = m.target;
  if (t.nodeType === 1 && t.closest && t.closest(".address-header")) return true;
  if (t.nodeType === 3 && t.parentElement && t.parentElement.closest(".address-header"))
    return true;
  if (m.type === "childList" && m.addedNodes && m.addedNodes.length) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches && (n.matches(".address-header") || n.matches("address-bar") || n.matches("sc-address-bar")))
        return true;
      if (n.closest && n.closest(".address-header")) return true;
      if (n.querySelector && n.querySelector(".address-header")) return true;
    }
  }
  return false;
}

function isChatBubble(el) {
  return !!(el && el.tagName && el.tagName.toLowerCase() === "sc-chat-bubble");
}

/**
 * Same issue as `.address-header`: multiple threads leave multiple `.messages-container` nodes.
 * Prefer the list under the same layout subtree as the visible address header, then fall back.
 */
function getVisibleMessagesContainer() {
  const sel =
    "communications-list .messages-container, .chat-window-container .messages-container";

  function lastVisibleMessagesIn(el) {
    const roots = el.querySelectorAll(sel);
    let found = null;
    for (let i = roots.length - 1; i >= 0; i--) {
      const root = roots[i];
      if (!root.isConnected) continue;
      const r = root.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) found = root;
    }
    return found;
  }

  const header = getAddressHeaderHost();
  if (header) {
    let el = header;
    for (let depth = 0; el && depth < 48; depth++, el = el.parentElement) {
      const found = lastVisibleMessagesIn(el);
      if (found) return found;
    }
  }

  const contents = document.querySelectorAll("ion-content.conversation-container");
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i];
    if (!content.isConnected) continue;
    const r = content.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const root = content.querySelector(sel);
    if (root && root.isConnected) return root;
  }

  const candidates = document.querySelectorAll(sel);
  if (!candidates.length) return null;
  const visible = [];
  for (const el of candidates) {
    if (!el.isConnected) continue;
    const cr = el.getBoundingClientRect();
    if (cr.width > 1 && cr.height > 1) visible.push(el);
  }
  if (visible.length) return visible[visible.length - 1];
  return candidates[candidates.length - 1];
}

/**
 * Plain-text export of visible thread: date lines + [Sent|Received] time + body (DOM order).
 */
function buildConversationExportText() {
  const root = getVisibleMessagesContainer();
  if (!root) return "";
  const parts = [];
  for (const el of root.children) {
    if (el.nodeType !== 1) continue;
    if (el.classList && el.classList.contains("communication-date")) {
      const d = el.textContent.trim();
      if (d) parts.push("", d, "");
      continue;
    }
    if (isChatBubble(el)) {
      const timeEl = el.querySelector('[data-testid="message-time-element"], .message-time');
      const textEl = el.querySelector(".text-item");
      const time = timeEl ? timeEl.textContent.trim() : "";
      let text = textEl ? textEl.innerText.trim() : "";
      if (!text) {
        const alt = el.querySelector(".bubble-content__message");
        text = alt ? alt.innerText.trim() : "";
      }
      const isUser = el.querySelector(".user-bubble");
      const role = isUser ? "Sent" : "Received";
      if (!time && !text) continue;
      parts.push(`[${role}] ${time}`.trim());
      if (text) parts.push(text);
      parts.push("");
    }
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function showToast(message, isError) {
  const t = document.createElement("div");
  t.className = "textfree-unread-toast" + (isError ? " textfree-unread-toast--err" : "");
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("textfree-unread-toast--show"));
  setTimeout(() => {
    t.classList.remove("textfree-unread-toast--show");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

function removeDigitsFromLocal(digitsList) {
  let changed = false;
  for (const d of digitsList) {
    const clean = String(d).replace(/\D/g, "");
    if (clean && localUnreadDigits.delete(clean)) changed = true;
  }
  if (changed) {
    persistStorage();
    applyLocalUnreadToAllRows();
  }
}

/** Digits from /conversation/:id (e.g. 16462472484). Ignores /conversation/empty. */
function getConversationPathDigits() {
  const m = location.pathname.match(/\/conversation\/([^/]+)/);
  if (!m) return null;
  const seg = m[1];
  if (!seg || seg === "empty") return null;
  const digits = seg.replace(/\D/g, "");
  return digits.length ? digits : null;
}

function pathDigitsMatchStored(pathDigits, stored) {
  const p = String(pathDigits).replace(/\D/g, "");
  const s = String(stored).replace(/\D/g, "");
  if (!p || !s) return false;
  if (p === s) return true;
  if (p.length >= 10 && s.length >= 10 && p.slice(-10) === s.slice(-10)) return true;
  if (p.length >= 7 && (s.endsWith(p) || p.endsWith(s))) return true;
  return false;
}

/** Clear local reminder when viewing that thread (URL id matches stored recipient). */
function clearLocalUnreadIfUrlMatchesConversation() {
  const pathDigits = getConversationPathDigits();
  if (!pathDigits) return;
  const toRemove = [];
  for (const stored of localUnreadDigits) {
    if (pathDigitsMatchStored(pathDigits, stored)) toRemove.push(stored);
  }
  if (toRemove.length) removeDigitsFromLocal(toRemove);
}

let lastPathname = "";

function onLocationMaybeChanged() {
  if (location.pathname === lastPathname) return;
  lastPathname = location.pathname;
  clearLocalUnreadIfUrlMatchesConversation();
  scheduleHeaderEnsure();
}

function setupUrlListener() {
  lastPathname = location.pathname;
  clearLocalUnreadIfUrlMatchesConversation();

  window.addEventListener("popstate", onLocationMaybeChanged);
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    queueMicrotask(onLocationMaybeChanged);
    return r;
  };
  history.replaceState = function () {
    const r = origReplace.apply(this, arguments);
    queueMicrotask(onLocationMaybeChanged);
    return r;
  };
  setInterval(function () {
    if (location.pathname !== lastPathname) onLocationMaybeChanged();
  }, 400);
}

function findContactDropdownList() {
  return document.querySelector(
    "ion-popover.contact-popover ion-list.dropdown-list, ion-popover ion-list.dropdown-list"
  );
}

/**
 * Ionic `dismiss()` must run in the page JS world — inject-main listens for postMessage + event.
 * See: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#host-page-communication
 */
function dismissContactPopover() {
  try {
    window.postMessage(
      { source: "textfree-ext", type: "DISMISS_CONTACT_POPOVER" },
      "*"
    );
  } catch (_) {}
  try {
    document.dispatchEvent(
      new CustomEvent("textfree-dismiss-contact-popover", {
        bubbles: true,
        composed: true,
      })
    );
  } catch (_) {}
}

/**
 * Inserts "Mark unread (local)" as the first item in the contact ⋮ popover list.
 */
function injectDropdownUnreadItem(row) {
  if (!row) return;
  const list = findContactDropdownList();
  if (!list || list.querySelector("[data-textfree-unread-item]")) return;

  const item = document.createElement("ion-item");
  item.setAttribute("data-textfree-unread-item", "1");
  item.setAttribute("button", "");
  item.setAttribute("lines", "none");
  item.setAttribute("role", "listitem");
  item.className =
    "item md item-lines-none in-list ion-activatable ion-focusable hydrated item-label";

  const label = document.createElement("ion-label");
  label.className = "sc-ion-label-md-h md sc-ion-label-md sc-ion-label-md-s hydrated";
  label.textContent = "Mark unread (local)";
  item.appendChild(label);

  item.addEventListener("click", (e) => {
    const contact = row.querySelector(".contact");
    const digits = digitsFromContactText(contact && contact.textContent);
    if (!digits) {
      showToast("Could not read phone number for this row.", true);
      dismissContactPopover(item);
      return;
    }
    localUnreadDigits.add(digits);
    persistStorage();
    applyRowUnreadState(row);
    showToast("Reminder saved locally. Clears when the inbox shows this thread as read.");
    requestAnimationFrame(() => dismissContactPopover(item));
  });

  list.insertBefore(item, list.firstChild);
}

function schedulePopoverInject(row) {
  lastRowForPopover = row;
  const run = () => injectDropdownUnreadItem(row);
  requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 0);
  setTimeout(run, 50);
  setTimeout(run, 120);
  setTimeout(run, 250);
}

function onMoreMenuClickCapture(e) {
  const t = e.target && e.target.closest && e.target.closest('[data-testid="contact-detail-options-btn"]');
  if (!t) return;
  const row = findConversationRow(t);
  if (!row || !row.querySelector(".contact")) return;
  schedulePopoverInject(row);
}

function ensureListCopyButton(row) {
  const contact = row.querySelector(".contact");
  if (!contact) return;
  if (row.querySelector(".textfree-copy-phone-wrap")) return;
  const topRow = contact.closest(".row");
  if (topRow) {
    topRow.querySelectorAll(":scope > .textfree-copy-btn").forEach((b) => b.remove());
  }
  const wrap = document.createElement("span");
  wrap.className = "textfree-copy-phone-wrap";
  contact.parentNode.insertBefore(wrap, contact);
  wrap.appendChild(contact);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "textfree-copy-btn";
  btn.setAttribute("aria-label", "Copy phone number");
  btn.title = "Copy number";
  btn.textContent = "⎘";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const c = row.querySelector(".contact");
    copyDigitsToClipboard(digitsFromContactText(c && c.textContent));
  });
  wrap.appendChild(btn);
}

function ensureAddressHeaderCopyButton() {
  const host = getAddressHeaderHost();
  if (!host) return;
  const label = getAddressHeaderPhoneLabel(host);
  if (!label || !String(label.textContent).trim()) return;

  const inWrap = label.closest(".textfree-copy-phone-wrap--header");
  if (inWrap && inWrap.isConnected) return;

  for (const w of host.querySelectorAll(".textfree-copy-phone-wrap--header")) {
    if (!w.isConnected || !w.contains(label)) w.remove();
  }
  if (label.closest(".textfree-copy-phone-wrap--header")) return;

  const topRow = label.closest(".items-added") || label.parentElement;
  if (topRow) {
    topRow.querySelectorAll(":scope > .textfree-copy-btn--header").forEach((b) => b.remove());
  }

  const wrap = document.createElement("span");
  wrap.className = "textfree-copy-phone-wrap textfree-copy-phone-wrap--header";
  label.parentNode.insertBefore(wrap, label);
  wrap.appendChild(label);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "textfree-copy-btn textfree-copy-btn--header";
  btn.setAttribute("aria-label", "Copy phone number");
  btn.title = "Copy number";
  btn.textContent = "⎘";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const lab = getAddressHeaderPhoneLabel(getAddressHeaderHost());
    copyDigitsToClipboard(lab && lab.textContent);
  });
  wrap.appendChild(btn);
}

function ensureCopyConversationBar() {
  const host = getAddressHeaderHost();
  if (!host) return;
  const label = getAddressHeaderPhoneLabel(host);
  const numberSpam = label && label.closest(".number-and-spam");

  function removeAllConversationCopy() {
    document
      .querySelectorAll("[data-textfree-copy-conversation-bar]")
      .forEach((el) => el.remove());
  }

  if (!isActiveConversationRoute()) {
    removeAllConversationCopy();
    return;
  }
  if (!numberSpam) {
    host.querySelectorAll("[data-textfree-copy-conversation-bar]").forEach((el) => el.remove());
    return;
  }

  document.querySelectorAll("[data-textfree-copy-conversation-bar]").forEach((el) => {
    if (!numberSpam.contains(el)) el.remove();
  });

  let bar = numberSpam.querySelector("[data-textfree-copy-conversation-bar]");
  if (bar && !bar.isConnected) bar = null;
  if (bar) {
    const itemsAdded = numberSpam.querySelector(".items-added");
    if (itemsAdded && bar.previousElementSibling !== itemsAdded) {
      itemsAdded.insertAdjacentElement("afterend", bar);
    }
    return;
  }

  bar = document.createElement("div");
  bar.className = "textfree-copy-conversation-inline";
  bar.setAttribute("data-textfree-copy-conversation-bar", "1");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "textfree-copy-conversation-btn";
  btn.textContent = "Copy conversation";
  btn.setAttribute("aria-label", "Copy conversation with timestamps");
  btn.title = "Copy all visible messages with dates and times";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = buildConversationExportText();
    if (!text) {
      showToast("No messages to copy yet", true);
      return;
    }
    copyPlainTextToClipboard(text, "Conversation copied");
  });
  bar.appendChild(btn);
  const itemsAdded = numberSpam.querySelector(".items-added");
  if (itemsAdded) {
    itemsAdded.insertAdjacentElement("afterend", bar);
  } else {
    numberSpam.appendChild(bar);
  }
}

function scanRows(root) {
  const rootEl = root || document;
  rootEl.querySelectorAll("ion-item-sliding:has(.contact)").forEach((row) => {
    applyRowUnreadState(row);
    ensureListCopyButton(row);
  });
  ensureAddressHeaderCopyButton();
  ensureCopyConversationBar();
}

function setupObserver() {
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (mutationTouchesAddressHeader(m)) {
        scheduleHeaderEnsureDebounced();
        break;
      }
    }
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches("ion-item-sliding") && n.querySelector(".contact")) {
          applyRowUnreadState(n);
          ensureListCopyButton(n);
        }
        if (n.querySelectorAll) scanRows(n);
        if (
          (n.matches && n.matches("sc-chat-bubble")) ||
          (n.querySelector && n.querySelector("sc-chat-bubble"))
        ) {
          ensureCopyConversationBar();
        }
        if (
          n.matches &&
          (n.matches(".address-header") ||
            n.matches("sc-address-bar") ||
            n.matches("address-bar") ||
            n.matches("communications-list"))
        ) {
          scheduleHeaderEnsureDebounced();
        }
        if (
          lastRowForPopover &&
          (n.matches?.("ion-popover") ||
            (n.querySelector && n.querySelector("ion-list.dropdown-list")))
        ) {
          schedulePopoverInject(lastRowForPopover);
        }
      }
    }
  });
  obs.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.source !== RECON_SRC) return;
  if (event.data.type === "REMOVE_DIGITS" && Array.isArray(event.data.digits)) {
    removeDigitsFromLocal(event.data.digits);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  const next = changes[STORAGE_KEY].newValue;
  localUnreadDigits = new Set(
    Array.isArray(next) ? next.map((d) => String(d).replace(/\D/g, "")).filter(Boolean) : []
  );
  applyLocalUnreadToAllRows();
});

chrome.runtime.sendMessage({ type: "inject-main" }, (res) => {
  if (chrome.runtime.lastError || !res || !res.ok) {
    console.warn("TextFree Unread: inject-main failed", chrome.runtime.lastError || res);
  }
  document.addEventListener("click", onMoreMenuClickCapture, true);
  loadStorage(() => {
    scanRows(document);
    scheduleHeaderEnsure();
    setupObserver();
    setupUrlListener();
    setInterval(() => {
      ensureAddressHeaderCopyButton();
      ensureCopyConversationBar();
    }, 1500);
  });
});
