/**
 * The whole client-side logic of the view, as a string that gets inlined into the
 * HTML document.
 *
 * Deliberately written with no build step, no framework and no MCP Apps SDK: the
 * view talks raw JSON-RPC over `postMessage`. The point of this server is to
 * measure host behaviour, so the view itself must not add variables of its own.
 *
 * Constraints while editing this string:
 * - no backticks and no `${` (it lives inside a String.raw template)
 * - the `securitypolicyviolation` listener must stay the first statement
 */
export const DIAGNOSTICS_SCRIPT = String.raw`
(function () {
  "use strict";

  var VIOLATIONS = [];
  document.addEventListener("securitypolicyviolation", function (e) {
    VIOLATIONS.push({
      blockedURI: e.blockedURI,
      violatedDirective: e.violatedDirective,
      effectiveDirective: e.effectiveDirective,
      originalPolicy: e.originalPolicy,
      at: new Date().toISOString()
    });
    renderViolations();
  });

  var CFG = window.__PROBE_CONFIG__;
  var CSP_KEYS = ["frameDomains", "resourceDomains", "connectDomains", "baseUriDomains"];

  // ---------------------------------------------------------------- DOM utils

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** verdict: "" | "ok" | "ng" | "warn" */
  function row(label, value, verdict) {
    var td = el("td", { class: "v " + (verdict || "") });
    if (value instanceof Node) td.appendChild(value);
    else td.textContent = String(value);
    return el("tr", null, [el("th", { text: label }), td]);
  }

  function table(id) {
    return el("table", { class: "kv", id: id }, [el("tbody")]);
  }

  function fill(tableEl, rows) {
    var body = tableEl.querySelector("tbody");
    clear(body);
    rows.forEach(function (r) {
      body.appendChild(r);
    });
  }

  function json(value) {
    if (value === undefined) return "(未宣言)";
    return JSON.stringify(value, null, 2);
  }

  function pre(textValue) {
    return el("pre", { text: textValue });
  }

  function sameList(a, b) {
    var x = (a || []).slice().sort();
    var y = (b || []).slice().sort();
    return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
  }

  // ------------------------------------------------------------- page skeleton

  function buildSkeleton() {
    var root = el("div", { class: "root" });

    root.appendChild(el("header", null, [
      el("h1", { text: "MCP Apps iframe probe — " + CFG.title }),
      el("p", { class: "sub", text: "probe " + CFG.probeId + " / " + CFG.resourceUri })
    ]));

    function section(id, heading, note) {
      var s = el("section", null, [el("h2", { text: heading })]);
      if (note) s.appendChild(el("p", { class: "note", text: note }));
      s.appendChild(table(id));
      return s;
    }

    root.appendChild(section("t-host", "A. ホスト情報", "ui/initialize のレスポンスから取得。"));
    root.appendChild(section("t-csp", "B. CSP 承認結果（最重要）", "宣言と承認の差分がすべて。"));
    root.appendChild(section("t-sandbox", "C. sandbox 実測", "iframe の sandbox フラグは入れ子に継承される。"));
    root.appendChild(section("t-embed", "D. 埋め込み結果", CFG.expectation));
    root.appendChild(section("t-violation", "E. CSP 違反ログ", null));

    var embedWrap = el("section", { class: "embed-section" }, [
      el("h2", { text: "埋め込み領域" }),
      el("div", { class: "embed", id: "embed-host" })
    ]);
    root.appendChild(embedWrap);

    document.body.appendChild(root);
  }

  // -------------------------------------------------------------- C. sandbox

  function attempt(fn) {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      return { ok: false, value: String((err && err.message) || err) };
    }
  }

  function renderSandbox() {
    var origin = attempt(function () { return window.origin; });
    var opaque = origin.ok && String(origin.value) === "null";

    var storage = function (name) {
      return attempt(function () {
        var store = window[name];
        if (!store) throw new Error(name + " is undefined");
        store.setItem("__probe__", "1");
        var read = store.getItem("__probe__");
        store.removeItem("__probe__");
        return "読み書き成功 (read back: " + read + ")";
      });
    };

    var cookie = attempt(function () {
      document.cookie = "__probe__=1; SameSite=None; Secure";
      return document.cookie.indexOf("__probe__") >= 0
        ? "書き込み成功"
        : "例外は出ないが書き込まれていない";
    });

    var rows = [
      row(
        "window.origin",
        opaque ? String(origin.value) + " — opaque origin" : String(origin.value),
        opaque ? "ng" : origin.ok ? "ok" : "ng"
      ),
      row("document.domain", attemptText(attempt(function () { return document.domain || "(空文字)"; })), null),
      row("localStorage", attemptText(storage("localStorage")), null),
      row("sessionStorage", attemptText(storage("sessionStorage")), null),
      row("document.cookie", attemptText(cookie), null),
      row("crossOriginIsolated", attemptText(attempt(function () { return String(window.crossOriginIsolated); })), null),
      row("navigator.userAgent", attemptText(attempt(function () { return navigator.userAgent; })), null)
    ];

    if (opaque) {
      rows.unshift(row(
        "判定",
        "allow-same-origin なし。Cookie / localStorage / same-origin fetch が使えないため、" +
          "frame-src が開いても Tableau は正常に動作しない。",
        "ng"
      ));
    }

    fill(byId("t-sandbox"), rows);
  }

  function attemptText(result) {
    return result.ok ? String(result.value) : "取得不可 (" + result.value + ")";
  }

  // ----------------------------------------------------------------- B. CSP

  function renderCsp(approved, note) {
    var declared = CFG.declaredCsp;
    var rows = [
      row("宣言した csp", pre(json(declared === null ? undefined : declared)), null),
      row(
        "承認された csp",
        approved === undefined ? "取得不可 (" + (note || "レスポンスが空") + ")" : pre(json(approved)),
        approved === undefined ? "ng" : null
      )
    ];

    if (approved !== undefined) {
      CSP_KEYS.forEach(function (key) {
        var want = (declared && declared[key]) || [];
        var got = (approved && approved[key]) || [];
        if (want.length === 0 && got.length === 0) return;

        var verdict;
        var text;
        if (want.length > 0 && got.length === 0) {
          verdict = "ng";
          text = "ホストが拒否: 宣言 " + JSON.stringify(want) + " → 承認 なし";
        } else if (sameList(want, got)) {
          verdict = "ok";
          text = "そのまま承認: " + JSON.stringify(got);
        } else if (want.length === 0) {
          verdict = "warn";
          text = "宣言していないのに承認されている: " + JSON.stringify(got) + "（仕様の MUST NOT 違反の疑い）";
        } else {
          verdict = "warn";
          text = "一部のみ承認: 宣言 " + JSON.stringify(want) + " → 承認 " + JSON.stringify(got);
        }
        rows.push(row(key + " 差分", text, verdict));
      });

      if (declared === null) {
        var anyApproved = CSP_KEYS.some(function (k) {
          return ((approved && approved[k]) || []).length > 0;
        });
        rows.push(row(
          "既定 CSP 判定",
          anyApproved
            ? "csp を宣言していないのにドメインが承認されている。既定 CSP が効いていない可能性が高い。"
            : "csp 未宣言 → 承認ドメインなし。既定 CSP が効いている（期待どおり）。",
          anyApproved ? "warn" : "ok"
        ));
      }
    }

    fill(byId("t-csp"), rows);
  }

  // ---------------------------------------------------------------- A. host

  function renderHost(result, note) {
    if (!result) {
      fill(byId("t-host"), [row(
        "ui/initialize",
        "取得不可 (" + (note || "レスポンスが空") + ")。" +
          "ホストが ui/initialize に応答しない = MCP Apps 非対応の可能性。",
        "ng"
      )]);
      return;
    }

    var info = result.hostInfo || {};
    var ctx = result.hostContext || {};
    fill(byId("t-host"), [
      row("hostInfo.name", info.name === undefined ? "取得不可 (レスポンスに含まれない)" : info.name),
      row("hostInfo.version", info.version === undefined ? "取得不可 (レスポンスに含まれない)" : info.version),
      row("protocolVersion", result.protocolVersion === undefined ? "取得不可 (レスポンスに含まれない)" : result.protocolVersion),
      row("hostContext.displayMode", ctx.displayMode === undefined ? "取得不可 (レスポンスに含まれない)" : ctx.displayMode),
      row("hostContext.availableDisplayModes", ctx.availableDisplayModes === undefined ? "取得不可 (レスポンスに含まれない)" : JSON.stringify(ctx.availableDisplayModes)),
      row("hostContext.platform", ctx.platform === undefined ? "取得不可 (レスポンスに含まれない)" : ctx.platform),
      row("hostContext.theme", ctx.theme === undefined ? "取得不可 (レスポンスに含まれない)" : ctx.theme)
    ]);
  }

  // ----------------------------------------------------------- E. violations

  function renderViolations() {
    var target = byId("t-violation");
    if (!target) return;

    if (VIOLATIONS.length === 0) {
      fill(target, [row("違反", "違反なし（このイベントを捕捉できていないだけの可能性もある）", "ok")]);
      return;
    }

    fill(target, VIOLATIONS.map(function (v, i) {
      return row(
        "#" + (i + 1) + " " + v.effectiveDirective,
        "blocked: " + v.blockedURI + "\nviolated: " + v.violatedDirective + "\npolicy: " + v.originalPolicy,
        "ng"
      );
    }));
  }

  // ------------------------------------------------------------- D. embedding

  var embedState = {
    load: "未発生",
    error: "未発生",
    timedOut: false,
    url: CFG.defaultEmbedUrl,
    source: "既定 viz",
    buildError: null,
    toolInput: "計測前"
  };

  function renderEmbed() {
    var verdict = null;
    var summary;
    if (embedState.buildError) {
      summary = "生成失敗: " + embedState.buildError;
      verdict = "ng";
    } else if (embedState.error !== "未発生") {
      summary = "onerror 発火";
      verdict = "ng";
    } else if (embedState.load !== "未発生") {
      summary = embedState.timedOut ? "読込完了だが描画未確認" : "onload 発火";
      verdict = embedState.timedOut ? "warn" : "ok";
    } else if (embedState.timedOut) {
      summary = "5秒経過しても onload / onerror のどちらも発火しない";
      verdict = "ng";
    } else {
      summary = "計測中";
    }

    fill(byId("t-embed"), [
      row("埋め込み方式", CFG.embedMode, null),
      row("対象 URL", embedState.url + "（" + embedState.source + "）", null),
      row("判定", summary, verdict),
      row("onload", embedState.load, null),
      row("onerror", embedState.error, null),
      row(
        "ui/notifications/tool-input",
        embedState.toolInput,
        embedState.toolInput === "未受信（ホストが送っていない）" ? "warn" : null
      ),
      row("目視確認（人間が記入）",
        "1. viz が描画されているか / 2. ツールチップが出るか / 3. フィルタ・クリックが効くか", null)
    ]);
  }

  function normalizeVizUrl(raw) {
    var parsed = new URL(raw);
    if (parsed.origin !== CFG.allowedOrigin) {
      throw new Error("vizUrl must be on " + CFG.allowedOrigin + " (got " + parsed.origin + ")");
    }
    parsed.search = "";
    if (/^#\d+$/.test(parsed.hash)) parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }

  function embedUrlFor(vizUrl) {
    if (CFG.embedMode === "image") return vizUrl + ".png?:showVizHome=no";
    if (CFG.embedMode === "embedapi") return vizUrl;
    return vizUrl + "?:embed=true&:showVizHome=no";
  }

  function armTimeout() {
    setTimeout(function () {
      embedState.timedOut = true;
      renderEmbed();
    }, 5000);
  }

  function buildEmbed(vizUrl, source) {
    var host = byId("embed-host");
    try {
      if (vizUrl) {
        embedState.url = embedUrlFor(normalizeVizUrl(vizUrl));
        embedState.source = source;
      }

      if (CFG.embedMode === "image") {
        var img = el("img", { src: embedState.url, alt: "Tableau Public viz snapshot" });
        img.onload = function () { embedState.load = "発火"; renderEmbed(); };
        img.onerror = function () { embedState.error = "発火"; renderEmbed(); };
        host.appendChild(img);
      } else if (CFG.embedMode === "embedapi") {
        var viz = document.createElement("tableau-viz");
        viz.setAttribute("src", embedState.url);
        host.appendChild(viz);

        var script = el("script", { type: "module", src: CFG.embedApiScriptUrl });
        script.onload = function () { embedState.load = "発火 (script)"; renderEmbed(); };
        script.onerror = function () { embedState.error = "発火 (script)"; renderEmbed(); };
        document.head.appendChild(script);
      } else {
        var frame = el("iframe", {
          src: embedState.url,
          title: "Tableau Public viz",
          loading: "eager",
          referrerpolicy: "no-referrer-when-downgrade"
        });
        frame.onload = function () { embedState.load = "発火"; renderEmbed(); };
        frame.onerror = function () { embedState.error = "発火"; renderEmbed(); };
        host.appendChild(frame);
      }
    } catch (err) {
      embedState.buildError = String((err && err.message) || err);
    }
    armTimeout();
    renderEmbed();
  }

  // --------------------------------------------------- host RPC (postMessage)

  var nextId = 1;
  var pending = {};
  var toolInputVizUrl = null;
  var toolInputSeen = false;

  function send(message) {
    try {
      window.parent.postMessage(message, "*");
      return true;
    } catch (err) {
      return false;
    }
  }

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = "probe-" + nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      var ok = send({ jsonrpc: "2.0", id: id, method: method, params: params });
      if (!ok) {
        delete pending[id];
        reject(new Error("window.parent.postMessage が失敗した"));
      }
    });
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    // A message carrying "method" is a request/notification, never a response —
    // this matters when window.parent === window (standalone preview).
    if (msg.method === undefined && msg.id !== undefined && pending[msg.id]) {
      var entry = pending[msg.id];
      delete pending[msg.id];
      if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
      return;
    }

    if (msg.method === "ui/notifications/tool-input") {
      toolInputSeen = true;
      var args = (msg.params && msg.params.arguments) || {};
      if (typeof args.vizUrl === "string" && args.vizUrl.trim() !== "") {
        toolInputVizUrl = args.vizUrl.trim();
      }
    }
  });

  function observeSize() {
    if (typeof ResizeObserver === "undefined") return;
    try {
      var observer = new ResizeObserver(function () {
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/size-changed",
          params: {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight
          }
        });
      });
      observer.observe(document.documentElement);
    } catch (err) {
      /* size reporting is optional; never block the diagnostics on it */
    }
  }

  // ------------------------------------------------------------------- boot

  buildSkeleton();
  renderSandbox();
  renderCsp(undefined, "ui/initialize 応答待ち");
  renderViolations();
  renderEmbed();

  var settled = false;
  function afterInitialize(result, note) {
    if (settled) return;
    settled = true;

    renderHost(result, note);
    if (result) {
      var sandbox = (result.hostCapabilities && result.hostCapabilities.sandbox) || {};
      renderCsp(sandbox.csp || {}, null);
      send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    } else {
      renderCsp(undefined, note);
    }

    // Give the host a moment to deliver tool-input, which may carry a custom vizUrl.
    setTimeout(function () {
      embedState.toolInput = toolInputSeen
        ? "受信" + (toolInputVizUrl ? "（vizUrl あり）" : "（vizUrl なし）")
        : "未受信（ホストが送っていない）";
      buildEmbed(toolInputVizUrl, "tool-input の vizUrl");
    }, 2000);

    observeSize();
  }

  setTimeout(function () {
    afterInitialize(null, "3秒以内に応答なし");
  }, 3000);

  request("ui/initialize", {
    appInfo: { name: "mcp-apps-iframe-probe", version: CFG.serverVersion },
    appCapabilities: {},
    protocolVersion: CFG.protocolVersion
  }).then(function (result) {
    afterInitialize(result, null);
  }, function (err) {
    afterInitialize(null, String((err && err.message) || err));
  });
})();
`;
