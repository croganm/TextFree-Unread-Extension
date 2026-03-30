/**
 * Page (MAIN) world: popover dismiss bridge + api.pinger.com hooks to clear local "unread" reminders.
 */
(function () {
  if (window.__textfreeUnreadInjected) return;
  window.__textfreeUnreadInjected = true;

  const EXT_MSG = { source: "textfree-ext", type: "DISMISS_CONTACT_POPOVER" };
  const DISMISS_POPOVER_EV = "textfree-dismiss-contact-popover";

  function runDismissContactPopover() {
    function tryDismiss(p) {
      if (!p || typeof p.dismiss !== "function") return false;
      try {
        p.dismiss();
        return true;
      } catch (_) {
        return false;
      }
    }
    function run() {
      var i;
      var pops = document.querySelectorAll("ion-popover.contact-popover");
      for (i = 0; i < pops.length; i++) {
        if (tryDismiss(pops[i])) return;
      }
      var withItem = document.querySelector(
        "ion-popover:has([data-textfree-unread-item])"
      );
      if (tryDismiss(withItem)) return;
      pops = document.querySelectorAll('ion-popover[id^="ion-overlay-"]');
      for (i = 0; i < pops.length; i++) {
        if (
          pops[i].classList &&
          pops[i].classList.contains("contact-popover") &&
          tryDismiss(pops[i])
        ) {
          return;
        }
      }
      try {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            bubbles: true,
            composed: true,
          })
        );
      } catch (_) {}
    }
    run();
    setTimeout(run, 0);
    setTimeout(run, 50);
  }

  window.addEventListener("message", function (ev) {
    if (!ev.data || ev.data.source !== EXT_MSG.source || ev.data.type !== EXT_MSG.type) {
      return;
    }
    runDismissContactPopover();
  });

  document.addEventListener(
    DISMISS_POPOVER_EV,
    function () {
      runDismissContactPopover();
    },
    true
  );

  const STATUS_PATH = "/2.0/conversation/communications/status";
  const RECON_SRC = "textfree-unread-reconcile";

  function isCommunicationsListUrl(u) {
    if (!u || u.includes("communications/status")) return false;
    return u.includes("/conversation/communications");
  }

  function recipientsFromCommunicationsQuery(u) {
    try {
      const full =
        u.indexOf("http") === 0
          ? u
          : "https://api.pinger.com" + (u.charAt(0) === "/" ? u : "/" + u);
      const parsed = new URL(full);
      const out = [];
      ["recipients[]", "recipients"].forEach(function (key) {
        parsed.searchParams.getAll(key).forEach(function (v) {
          const d = String(v).replace(/\D/g, "");
          if (d) out.push(d);
        });
      });
      return out;
    } catch (_) {
      return [];
    }
  }

  function maybeClearOnCommunicationsGet(url) {
    const digits = recipientsFromCommunicationsQuery(url);
    if (digits.length) postRemoveDigits(digits);
  }

  function postRemoveDigits(digitsArr) {
    if (!digitsArr || !digitsArr.length) return;
    window.postMessage(
      { source: RECON_SRC, type: "REMOVE_DIGITS", digits: digitsArr },
      "*"
    );
  }

  function collectServerReadDigits(obj, out) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const x of obj) collectServerReadDigits(x, out);
      return;
    }
    if (obj.hasUnreadCommunications === false && Array.isArray(obj.recipientIds)) {
      for (const id of obj.recipientIds) {
        const d = String(id).replace(/\D/g, "");
        if (d) out.add(d);
      }
    }
    for (const k of Object.keys(obj)) {
      if (k === "parent" || k === "constructor") continue;
      collectServerReadDigits(obj[k], out);
    }
  }

  function reconcileFromJson(data) {
    const out = new Set();
    collectServerReadDigits(data, out);
    postRemoveDigits([...out]);
  }

  function maybeReconcileResponse(url, response, requestInit) {
    if (!url || !response.ok) return;

    if (isCommunicationsListUrl(url)) {
      const method = (requestInit && requestInit.method) || "GET";
      if (method.toUpperCase() === "GET") {
        maybeClearOnCommunicationsGet(url);
      }
    }

    if (!url.includes("api.pinger.com")) return;

    if (url.includes(STATUS_PATH) && requestInit && requestInit.body) {
      try {
        const raw =
          typeof requestInit.body === "string" ? requestInit.body : null;
        if (raw) {
          const body = JSON.parse(raw);
          if (body.action === "READ" && Array.isArray(body.recipients)) {
            postRemoveDigits(body.recipients.map((r) => String(r).replace(/\D/g, "")));
            return;
          }
        }
      } catch (_) {}
    }

    const ct = response.headers && response.headers.get("content-type");
    if (!ct || !ct.includes("json")) return;
    const clone = response.clone();
    clone.json().then(reconcileFromJson).catch(function () {});
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    return origFetch(input, init).then(function (response) {
      try {
        maybeReconcileResponse(url, response, init);
      } catch (_) {}
      return response;
    });
  };

  (function patchXhr() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._tfwMethod = method;
      this._tfwUrl = typeof url === "string" ? url : "";
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      this._tfwBody = body;
      const xhr = this;
      xhr.addEventListener("load", function () {
        try {
          if (xhr.status < 200 || xhr.status >= 300) return;
          const u = xhr._tfwUrl || "";
          const method = (xhr._tfwMethod || "GET").toUpperCase();

          if (method === "GET" && isCommunicationsListUrl(u)) {
            maybeClearOnCommunicationsGet(u);
          }

          if (u.includes(STATUS_PATH) && typeof xhr._tfwBody === "string") {
            try {
              const parsed = JSON.parse(xhr._tfwBody);
              if (parsed.action === "READ" && Array.isArray(parsed.recipients)) {
                postRemoveDigits(
                  parsed.recipients.map((r) => String(r).replace(/\D/g, ""))
                );
              }
            } catch (_) {}
          }

          if (!u.includes("api.pinger.com")) return;
          const rt = xhr.responseText;
          if (!rt || rt.length > 2e6) return;
          const ch = rt.charAt(0);
          if (ch !== "{" && ch !== "[") return;
          try {
            reconcileFromJson(JSON.parse(rt));
          } catch (_) {}
        } catch (_) {}
      });
      return origSend.apply(this, arguments);
    };
  })();
})();
