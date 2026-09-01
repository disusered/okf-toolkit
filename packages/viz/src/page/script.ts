/**
 * The generated page's behavior, as text.
 *
 * Marked parses stored Markdown and DOMPurify sanitizes it before insertion into the document.
 * The script uses ES5 syntax because it is embedded in a TypeScript template literal. String.raw
 * preserves the regular-expression backslashes.
 */
export const PAGE_SCRIPT = String.raw`
(function () {
  "use strict";

  var payload = JSON.parse(document.getElementById("okf-graph").textContent);
  var graph = payload.graph;

  var nodeById = Object.create(null);
  var linksBySource = Object.create(null);
  var backlinks = Object.create(null);

  graph.nodes.forEach(function (node) {
    nodeById[node.id] = node;
    var map = Object.create(null);
    node.links.forEach(function (link) {
      map[link.href] = link.pending ? "pending:" + link.target : link.target;
    });
    linksBySource[node.id] = map;
  });

  graph.edges.forEach(function (edge) {
    (backlinks[edge.target] = backlinks[edge.target] || []).push(edge.source);
  });

  var detailEl = document.getElementById("detail");
  var emptyEl = document.getElementById("detail-empty");
  var contentEl = document.getElementById("detail-content");
  var typeEl = document.getElementById("detail-type");
  var titleEl = document.getElementById("detail-title");
  var pathEl = document.getElementById("detail-path");
  var descriptionEl = document.getElementById("detail-description");
  var statusEl = document.getElementById("detail-status");
  var sourcesEl = document.getElementById("detail-sources");
  var bodyEl = document.getElementById("detail-body");
  var outSection = document.getElementById("detail-out");
  var outList = document.getElementById("links-out");
  var backSection = document.getElementById("detail-back");
  var backList = document.getElementById("links-back");
  var searchInput = document.getElementById("search");
  var typeSelect = document.getElementById("type");
  var trustSelect = document.getElementById("trust");
  var statusSelect = document.getElementById("status");
  var staleOnly = document.getElementById("stale-only");
  var staleOnlyLabel = document.getElementById("stale-only-label");
  var layoutSelect = document.getElementById("layout");
  var orientationSelect = document.getElementById("orientation");
  var verifiedEl = document.getElementById("detail-verified");
  var generatedTerm = document.getElementById("dt-generated");
  var generatedEl = document.getElementById("detail-generated");
  var resourceTerm = document.getElementById("dt-resource");
  var resourceEl = document.getElementById("detail-resource");
  var computationSection = document.getElementById("detail-computation");
  var staleTerm = document.getElementById("dt-stale");
  var staleEl = document.getElementById("detail-stale");
  var tagsTerm = document.getElementById("dt-tags");
  var tagsEl = document.getElementById("detail-tags");
  var flagEl = document.getElementById("detail-flag");
  var mainEl = document.querySelector("main");
  var splitEl = document.getElementById("split");

  var TRUST_LABEL = {
    "human-reviewed": "reviewed by a person",
    "machine-confirmed": "confirmed by a machine only",
    "unverified": "unverified"
  };

  var authored = graph.nodes.filter(function (node) { return !node.pending; });
  var pendingCount = graph.nodes.length - authored.length;

  document.getElementById("bundle").textContent = payload.bundle;
  var counts = authored.length + " pages, " + graph.edges.length + " relationships";
  if (pendingCount) { counts += ", " + pendingCount + " not written yet"; }
  // Say it outright when the whole bundle shares one trust tier. A filter with one option is
  // noise, but silence would let a reader infer a verification nobody performed.
  if (graph.trustTiers.length === 1) { counts += ", all " + graph.trustTiers[0]; }
  document.getElementById("counts").textContent = counts;

  document.getElementById("evaluated").textContent =
    payload.evaluatedAt ? "freshness evaluated " + payload.evaluatedAt : "";

  function fillSelect(select, values, labeler) {
    values.forEach(function (value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = labeler ? labeler(value) : value;
      select.appendChild(option);
    });
  }

  fillSelect(typeSelect, graph.types);
  fillSelect(trustSelect, graph.trustTiers, function (t) { return TRUST_LABEL[t] || t; });
  fillSelect(statusSelect, graph.statuses);

  // Hiding a control is only ever about filtering. Every node draws its own trust tier
  // regardless, so a uniform bundle still shows what that tier is.
  trustSelect.hidden = graph.trustTiers.length < 2;
  statusSelect.hidden = graph.statuses.length < 2;
  var anyStale = graph.nodes.some(function (node) { return node.stale === true; });
  staleOnlyLabel.hidden = !anyStale;

  // Ring colours are chosen at view time, not build time: a near-black ring is invisible on a
  // dark background, and the human-reviewed ring is the one signal that must always read.
  function runLayout(name) {
    cy.layout({
      name: name,
      animate: false,
      padding: 36,
      nodeRepulsion: 6000,
      idealEdgeLength: 100,
      componentSpacing: 80,
      nodeOverlap: 20,
      // Fit once the layout settles, or a graph larger than its pane is silently clipped.
      stop: function () { fitGraph(); }
    }).run();
  }

  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var MUTED = dark ? "#94a3b8" : "#64748b";

  var cy = cytoscape({
    container: document.getElementById("graph"),
    elements: graph.nodes.map(function (node) {
      // The graph carries structure and type. Trust, freshness and lifecycle are read from
      // the reader's metadata table, where they are legible without a key.
      var classes = node.pending ? "pending" : "";
      return {
        data: { id: node.id, label: node.title, color: node.color, size: node.size },
        classes: classes
      };
    }).concat(graph.edges.map(function (edge) {
      return { data: { id: edge.id, source: edge.source, target: edge.target, relation: edge.relation } };
    })),
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "label": "data(label)",
          "color": MUTED,
          "font-size": 10,
          "text-valign": "bottom",
          "text-margin-y": 5,
          "text-wrap": "wrap",
          "text-max-width": 110,
          "text-overflow-wrap": "anywhere",
          "text-background-color": dark ? "#0b1120" : "#f8fafc",
          "text-background-opacity": 0.85,
          "text-background-padding": 2,
          "width": "data(size)",
          "height": "data(size)"
        }
      },
      { selector: "node.pending", style: { "opacity": 0.5, "border-width": 1, "border-style": "dotted", "border-color": "#94a3b8" } },
      { selector: "node:selected", style: { "border-width": 4, "border-color": "#b45309" } },
      {
        selector: "edge",
        style: {
          "width": 1.4,
          "line-color": "#cbd5e1",
          "target-arrow-color": "#cbd5e1",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "arrow-scale": 0.8
        }
      },
      { selector: 'edge[relation = "source"]', style: { "line-style": "dashed" } },
      { selector: 'edge[relation = "pending"]', style: { "line-style": "dotted", "opacity": 0.6 } },
      { selector: "edge:selected", style: { "line-color": "#b45309", "target-arrow-color": "#b45309", "width": 2.4 } },
      { selector: ".dim", style: { "opacity": 0.12 } }
    ],
    // Labels sit below their node, so the default packing overlaps them. Give the layout room.
    layout: {
      name: "cose",
      animate: false,
      padding: 36,
      nodeRepulsion: 6000,
      idealEdgeLength: 100,
      componentSpacing: 80,
      nodeOverlap: 20
      // No stop hook here: it would fire during construction, before the cy variable is
      // assigned, and the throw would abort the rest of this script. cose fits on its own.
    }
  });

  // Layout preferences live in localStorage, keyed generically so the page carries no origin.
  // Every access is guarded: a file:// page throws SecurityError on storage in some browsers.
  var PREFS_KEY = "okf.viz.prefs.v1";

  function readPrefs() {
    try {
      var all = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}");
      return (all && all[payload.bundle]) || {};
    } catch (error) { return {}; }
  }

  function writePrefs(patch) {
    try {
      var all = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}");
      if (!all || typeof all !== "object") { all = {}; }
      var current = all[payload.bundle] || {};
      for (var key in patch) { current[key] = patch[key]; }
      all[payload.bundle] = current;
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(all));
    } catch (error) { /* storage is a convenience; never let it break the page */ }
  }

  function setSplit(percent) {
    var clamped = Math.max(20, Math.min(85, percent));
    mainEl.style.setProperty("--split", clamped + "%");
    splitEl.setAttribute("aria-valuenow", String(Math.round(clamped)));
    return clamped;
  }

  function setOrientation(value) {
    // Columns is the default and carries no attribute; rows is the opt-in.
    if (value === "rows") { mainEl.setAttribute("data-orientation", "rows"); }
    else { mainEl.removeAttribute("data-orientation"); }
    orientationSelect.value = value;
    splitEl.setAttribute("aria-orientation", value === "rows" ? "horizontal" : "vertical");
  }

  var prefs = readPrefs();
  setOrientation(prefs.orientation === "rows" ? "rows" : "columns");
  setSplit(typeof prefs.split === "number" ? prefs.split : 60);
  if (prefs.layout && prefs.layout !== layoutSelect.value) {
    layoutSelect.value = prefs.layout;
    runLayout(prefs.layout);
  }

  orientationSelect.addEventListener("change", function () {
    setOrientation(orientationSelect.value);
    writePrefs({ orientation: orientationSelect.value });
    cy.resize();
  });

  var dragging = false;

  splitEl.addEventListener("pointerdown", function (event) {
    dragging = true;
    splitEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  splitEl.addEventListener("pointermove", function (event) {
    if (!dragging) { return; }
    var box = mainEl.getBoundingClientRect();
    var columns = mainEl.getAttribute("data-orientation") === "columns";
    var percent = columns
      ? ((event.clientX - box.left) / box.width) * 100
      : ((event.clientY - box.top) / box.height) * 100;
    setSplit(percent);
  });

  splitEl.addEventListener("pointerup", function (event) {
    if (!dragging) { return; }
    dragging = false;
    splitEl.releasePointerCapture(event.pointerId);
    writePrefs({ split: Number(splitEl.getAttribute("aria-valuenow")) });
  });

  splitEl.addEventListener("keydown", function (event) {
    var now = Number(splitEl.getAttribute("aria-valuenow"));
    var next = event.key === "ArrowUp" || event.key === "ArrowLeft" ? now - 2
      : event.key === "ArrowDown" || event.key === "ArrowRight" ? now + 2
      : event.key === "Home" ? 20
      : event.key === "End" ? 85
      : null;
    if (next === null) { return; }
    event.preventDefault();
    writePrefs({ split: setSplit(next) });
  });

  // Resize the canvas, but never re-fit: dragging the splitter must not throw away the
  // reader's pan and zoom.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () {
      cy.resize();
      // The first real size may only arrive here, after the frame loop above gave up waiting.
      if (!fitted) {
        var box = document.getElementById("graph").getBoundingClientRect();
        if (box.width >= 1 && box.height >= 1) { fitted = true; fitGraph(); }
      }
    }).observe(document.getElementById("graph"));
  }

  // Fit after a frame, not now: the flex container has not been laid out yet, so cytoscape
  // would measure a zero or stale viewport and compute a zoom that leaves nodes off-screen.
  // The padding is generous because fit measures nodes, not the labels drawn beneath them.
  function fitGraph() {
    cy.resize();
    cy.fit(undefined, 60);
    // fit measures node bounds; labels are drawn beneath and outside them, so ease off the
    // zoom a little or the outermost captions sit past the edge of the pane.
    cy.zoom(cy.zoom() * 0.82);
    cy.center();
  }

  // One frame is not reliably enough: the flex container may still measure zero, and a fit
  // against a zero viewport leaves every node off-screen. Wait until it has real dimensions.
  var fitted = false;
  function fitWhenSized() {
    var box = document.getElementById("graph").getBoundingClientRect();
    if (box.width < 1 || box.height < 1) { requestAnimationFrame(fitWhenSized); return; }
    fitted = true;
    fitGraph();
  }
  requestAnimationFrame(fitWhenSized);

  cy.on("tap", "node", function (event) { showNode(event.target.id()); });
  cy.on("tap", function (event) { if (event.target === cy) { clearSelection(); } });

  layoutSelect.addEventListener("change", function () {
    runLayout(layoutSelect.value);
    writePrefs({ layout: layoutSelect.value });
  });

  document.getElementById("reset").addEventListener("click", function () {
    searchInput.value = "";
    typeSelect.value = "";
    trustSelect.value = "";
    statusSelect.value = "";
    staleOnly.checked = false;
    setOrientation("columns");
    setSplit(60);
    applyFilters();
    fitGraph();
    clearSelection();
  });

  searchInput.addEventListener("input", applyFilters);
  typeSelect.addEventListener("change", applyFilters);
  trustSelect.addEventListener("change", applyFilters);
  statusSelect.addEventListener("change", applyFilters);
  staleOnly.addEventListener("change", applyFilters);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { clearSelection(); }
  });

  function applyFilters() {
    var query = searchInput.value.trim().toLowerCase();
    var type = typeSelect.value;
    var trust = trustSelect.value;
    var status = statusSelect.value;
    var onlyStale = staleOnly.checked;
    cy.nodes().forEach(function (element) {
      var node = nodeById[element.id()];
      var matches = !type || node.type === type;
      if (matches && trust) { matches = node.trustTier === trust; }
      if (matches && status) { matches = node.status === status; }
      if (matches && onlyStale) { matches = node.stale === true; }
      if (matches && query) {
        var haystack = (
          node.title + " " + node.path + " " + node.description + " " + node.tags.join(" ")
        ).toLowerCase();
        matches = haystack.indexOf(query) !== -1;
      }
      element.toggleClass("dim", !matches);
    });
    cy.edges().forEach(function (element) {
      element.toggleClass("dim", element.source().hasClass("dim") || element.target().hasClass("dim"));
    });
  }

  /** Show a definition row only when it has a value, keeping term and value in step. */
  function setRow(termSuffix, valueId, value) {
    var term = document.getElementById("dt-" + termSuffix);
    var element = document.getElementById(valueId);
    var shown = value !== null && value !== undefined && value !== "";
    term.hidden = !shown;
    element.hidden = !shown;
    element.textContent = shown ? value : "";
  }

  function clearSelection() {
    cy.elements().unselect();
    emptyEl.hidden = false;
    contentEl.hidden = true;
  }

  function showNode(id, keepCamera) {
    var node = nodeById[id];
    if (!node) { return; }

    cy.elements().unselect();
    var element = cy.getElementById(id);
    if (element && element.length) { element.select(); }

    emptyEl.hidden = true;
    contentEl.hidden = false;

    typeEl.textContent = node.type;
    typeEl.style.background = node.color;
    titleEl.textContent = node.title;
    pathEl.textContent = node.path;
    descriptionEl.textContent = node.description || "—";
    statusEl.textContent = node.status || (node.pending ? "not written yet" : "—");

    // Show the checks themselves, newest first, with the derived rating underneath as the
    // conclusion drawn from them. The row is never hidden: silence must not read as approval.
    verifiedEl.replaceChildren();
    if (node.verified.length) {
      var events = node.verified.slice().sort(function (a, b) {
        return String(b.at || "").localeCompare(String(a.at || ""));
      });
      var list = document.createElement("ul");
      list.className = "plain";
      events.forEach(function (event) {
        var item = document.createElement("li");
        var who = document.createElement("span");
        who.className = "actor";
        who.textContent = event.by;
        item.appendChild(who);
        if (event.at) {
          var when = document.createElement("span");
          when.className = "muted";
          when.textContent = " · " + event.at;
          item.appendChild(when);
        }
        list.appendChild(item);
      });
      verifiedEl.appendChild(list);
    } else {
      var none = document.createElement("div");
      none.textContent = "no verification recorded";
      verifiedEl.appendChild(none);
    }
    var rating = document.createElement("div");
    rating.className = "muted";
    rating.textContent = TRUST_LABEL[node.trustTier] || node.trustTier;
    verifiedEl.appendChild(rating);

    generatedTerm.hidden = !node.generated;
    generatedEl.hidden = !node.generated;
    generatedEl.textContent = node.generated
      ? node.generated.by + (node.generated.at ? " · " + node.generated.at : "")
      : "";

    resourceTerm.hidden = !node.resource;
    resourceEl.hidden = !node.resource;
    resourceEl.replaceChildren();
    if (node.resource) { appendExternal(node.resource, node.resource, resourceEl); }

    var flag = node.pending ? "Pending" : node.stale === true ? "Stale"
      : node.status === "deprecated" ? "Deprecated" : "";
    flagEl.textContent = flag;
    flagEl.hidden = !flag;

    var staleText = "";
    if (node.staleAfter) {
      staleText = node.staleAfter;
      if (node.stale === true) { staleText += " — passed"; }
      else if (node.stale === false) { staleText += " — current as of " + payload.evaluatedAt; }
    }
    staleTerm.hidden = !staleText;
    staleEl.hidden = !staleText;
    staleEl.textContent = staleText;

    tagsTerm.hidden = !node.tags.length;
    tagsEl.hidden = !node.tags.length;
    tagsEl.replaceChildren();
    node.tags.forEach(function (tag) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "tag";
      button.textContent = tag;
      button.addEventListener("click", function () {
        searchInput.value = tag;
        applyFilters();
      });
      tagsEl.appendChild(button);
    });

    sourcesEl.replaceChildren();
    if (node.sources.length) {
      var sourceList = document.createElement("ul");
      sourceList.className = "plain";
      node.sources.forEach(function (source) {
        var item = document.createElement("li");
        var label = source.title || source.resource;

        // A source pointing inside the bundle selects that page, the same as a body link.
        // Only an http(s) resource leaves the document.
        if (source.resolvedPath && source.exists) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "internal";
          button.textContent = label;
          button.addEventListener("click", function () { showNode(source.resolvedPath); });
          item.appendChild(button);
        } else {
          appendExternal(source.resource, label, item);
        }

        if (!source.title) {
          var untitled = document.createElement("span");
          untitled.className = "muted";
          untitled.textContent = " (untitled)";
          item.appendChild(untitled);
        }
        if (source.exists === false) {
          var missing = document.createElement("span");
          missing.className = "warn-text";
          missing.textContent = " — not written yet";
          item.appendChild(missing);
        }

        // The credibility signals OKF records so a reader can judge the source itself.
        var facts = [];
        if (source.author) { facts.push("by " + source.author); }
        if (source.usageCount !== null) {
          var used = "used " + source.usageCount.toLocaleString() + " times";
          if (node.usageWindow && (node.usageWindow.from || node.usageWindow.to)) {
            used += " between " + (node.usageWindow.from || "?") + " and " + (node.usageWindow.to || "?");
          }
          facts.push(used);
        }
        if (source.lastModified) { facts.push("source last changed " + source.lastModified); }
        if (source.id) { facts.push("cited as [^" + source.id + "]"); }
        if (facts.length) {
          var detail = document.createElement("span");
          detail.className = "muted";
          detail.textContent = facts.join(" · ");
          item.appendChild(detail);
        }
        sourceList.appendChild(item);
      });
      sourcesEl.appendChild(sourceList);
    } else {
      sourcesEl.textContent = "none recorded";
    }

    // Only an Attested Computation carries a sanctioned way to produce its value.
    var attestation = node.attestation;
    computationSection.hidden = !attestation;
    if (attestation) {
      setRow("runtime", "comp-runtime", attestation.runtime);
      setRow("computation", "comp-computation", attestation.computation);
      setRow("executor", "comp-executor", attestation.executorResource);
      setRow("attester", "comp-attester", attestation.attesterResource);
      setRow("receipt", "comp-receipt", attestation.executorReceipt.join(", "));
      setRow(
        "parameters",
        "comp-parameters",
        attestation.parameters.map(function (parameter) {
          var shown = parameter.name;
          if (parameter.type) { shown += ": " + parameter.type; }
          if (parameter.required === true) { shown += " (required)"; }
          return shown;
        }).join(", "),
      );
    }

    bodyEl.replaceChildren();
    renderMarkdown(node.body, bodyEl, node.id);

    var outgoing = [];
    var already = Object.create(null);
    node.links.forEach(function (link) {
      var id = link.pending ? "pending:" + link.target : link.target;
      if (id !== node.id && !already[id]) {
        already[id] = true;
        outgoing.push(id);
      }
    });
    fillReferences(outSection, outList, outgoing);
    fillReferences(backSection, backList, backlinks[node.id] || []);

    detailEl.scrollTop = 0;
    // The camera only follows a deliberate selection. On first paint the page opens a node to
    // fill the reader, and moving the view there would fight the initial fit and can leave the
    // graph parked on empty canvas.
    if (element && element.length && !keepCamera) {
      cy.animate({ center: { eles: element }, zoom: Math.max(cy.zoom(), 0.9) }, { duration: 180 });
    }
  }

  function fillReferences(section, list, ids) {
    list.replaceChildren();
    if (!ids.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    ids.forEach(function (id) {
      var target = nodeById[id];
      var item = document.createElement("li");
      item.appendChild(internalButton(id, target ? target.title : id));
      var path = document.createElement("span");
      path.className = "muted";
      path.textContent = target ? target.path : id;
      item.appendChild(path);
      list.appendChild(item);
    });
  }

  function internalButton(id, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "internal";
    button.textContent = label;
    button.addEventListener("click", function () { showNode(id); });
    return button;
  }

  function appendExternal(url, label, container) {
    if (/^https?:\/\//i.test(url)) {
      var anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = label;
      container.appendChild(anchor);
      return;
    }
    container.appendChild(document.createTextNode(label));
  }

  // Parse, sanitize, then rewrite navigation. Images and inline styles are forbidden.
  var SANITIZE = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["img", "form", "input", "textarea", "select", "style"],
    FORBID_ATTR: ["style"]
  };

  function renderMarkdown(text, container, sourceId) {
    var html = marked.parse(String(text), { gfm: true, breaks: false, async: false });
    container.innerHTML = DOMPurify.sanitize(html, SANITIZE);
    rewriteLinks(container, sourceId);
  }

  // The bundle analysis already resolved internal links; do not resolve them again here.
  function rewriteLinks(root, sourceId) {
    var known = linksBySource[sourceId] || Object.create(null);
    var anchors = Array.prototype.slice.call(root.querySelectorAll("a[href]"));

    anchors.forEach(function (anchor) {
      var href = anchor.getAttribute("href") || "";
      var id = known[href];
      if (id === undefined) {
        try {
          id = known[decodeURIComponent(href)];
        } catch {
          id = undefined;
        }
      }

      var label = anchor.textContent || href;

      if (id !== undefined && nodeById[id]) {
        anchor.replaceWith(internalButton(id, label));
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        return;
      }
      // Keep the label but remove an unresolved or disallowed link.
      anchor.replaceWith(document.createTextNode(label));
    });
  }

  var opening = graph.nodes.find(function (node) { return node.path === "index.md"; }) || graph.nodes[0];
  if (opening) { showNode(opening.id, true); }
})();
`;
