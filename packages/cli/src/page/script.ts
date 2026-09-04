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
  var graphEl = document.getElementById("graph");

  var TRUST_LABEL = {
    "human-reviewed": "reviewed by a person",
    "machine-confirmed": "confirmed by a machine only",
    "unverified": "unverified"
  };

  var AUTHOR_LABEL = {
    "human": "written by a person",
    "agent": "written by an agent",
    "process": "written by an automated process",
    "unknown": "nobody recorded who wrote it"
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

  // The encoding is okf-viz's, computed when the page was generated and applied here. Two
  // stylesheets travel with the page because the authorship ring is chosen at view time: a
  // near-black ring is invisible on a dark background, and that ring is a signal that must
  // always read. Neither the rules nor the node classes are decided in this file any more,
  // so the graph is drawn one way by one implementation.
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var MUTED = dark ? payload.encoding.muted.dark : payload.encoding.muted.light;

  var cy = cytoscape({
    container: document.getElementById("graph"),
    elements: graph.nodes.map(function (node) {
      return {
        data: {
          id: node.id,
          label: node.title,
          color: node.color,
          size: node.size,
          shape: node.shape
        },
        classes: (payload.encoding.classes[node.id] || []).join(" ")
      };
    }).concat(graph.edges.map(function (edge) {
      return {
        data: { id: edge.id, source: edge.source, target: edge.target, relation: edge.relation },
        classes: edge.attested ? "attested" : ""
      };
    })),
    style: dark ? payload.encoding.style.dark : payload.encoding.style.light,
    // Labels sit below their node, so the default packing overlaps them. Give the layout room.
    layout: payload.encoding.layout
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

  // The constructor's layout ran against the pane as it was before the split was applied, so
  // it fitted to the wrong width. Refit on the next frame, once flex has settled, and again
  // whenever the window changes size.
  window.requestAnimationFrame(fitGraph);
  window.addEventListener("resize", fitGraph);

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

  // Pointing at a node answers "what is this" without answering it in the reader: hovering must
  // never change the selection, or a reader loses the page they were reading by moving a mouse.
  // Built with createElement and textContent, so a title can never become markup.
  var hoverCard = document.createElement("div");
  hoverCard.className = "hovercard";
  hoverCard.hidden = true;
  // Presented from here rather than the stylesheet so the card carries its own appearance; the
  // class name is the hook if the page stylesheet ever takes it over.
  hoverCard.style.position = "fixed";
  hoverCard.style.zIndex = "20";
  hoverCard.style.pointerEvents = "none";
  hoverCard.style.maxWidth = "260px";
  hoverCard.style.padding = "6px 8px";
  hoverCard.style.borderRadius = "4px";
  hoverCard.style.fontSize = "12px";
  hoverCard.style.lineHeight = "1.45";
  hoverCard.style.border = "1px solid " + (dark ? "#1f2937" : "#e2e8f0");
  hoverCard.style.background = dark ? "#111827" : "#ffffff";
  hoverCard.style.color = dark ? "#e5e7eb" : "#0f172a";
  hoverCard.style.boxShadow = "0 2px 10px rgba(15, 23, 42, 0.22)";
  document.body.appendChild(hoverCard);

  function hoverLine(text, muted) {
    var line = document.createElement("div");
    if (muted) { line.style.color = MUTED; }
    line.textContent = text;
    return line;
  }

  function hideHover() { hoverCard.hidden = true; }

  /** Place the card beside the node, then pull it back inside the window if it would overhang. */
  function placeHover(rendered) {
    var pane = graphEl.getBoundingClientRect();
    var card = hoverCard.getBoundingClientRect();
    var left = pane.left + rendered.x + 16;
    var top = pane.top + rendered.y + 16;
    if (left + card.width > window.innerWidth - 8) { left = window.innerWidth - card.width - 8; }
    if (top + card.height > window.innerHeight - 8) { top = top - card.height - 32; }
    hoverCard.style.left = Math.max(8, left) + "px";
    hoverCard.style.top = Math.max(8, top) + "px";
  }

  function showHover(node, rendered) {
    hoverCard.replaceChildren();
    var title = hoverCard.appendChild(hoverLine(node.title, false));
    title.style.fontWeight = "600";
    hoverCard.appendChild(hoverLine(node.type, true));
    // Who wrote it and when, in the words the page recorded. Say so plainly when nobody did:
    // an empty line here would read as though the question had not been asked.
    hoverCard.appendChild(hoverLine(
      node.generated
        ? node.generated.by + (node.generated.at ? " · " + node.generated.at : "")
        : AUTHOR_LABEL[node.authorKind],
      true
    ));
    hoverCard.hidden = false;
    placeHover(rendered);
  }

  cy.on("mouseover", "node", function (event) {
    var node = nodeById[event.target.id()];
    if (node) { showHover(node, event.target.renderedPosition()); }
  });
  cy.on("mouseout", "node", hideHover);
  // The card is anchored to a rendered position, so anything that moves the camera invalidates
  // it. Dropping it is honest; leaving it pointing at empty canvas is not.
  cy.on("pan zoom drag", hideHover);
  graphEl.addEventListener("mouseleave", hideHover);

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

  /* === dated strip and source usage bars ====================================================
   * Appended as one block so the reader panel gains a timeline and proportional usage bars
   * without editing showNode above. Everything here only reads the node payload and writes
   * into elements the markup already carries.
   * ======================================================================================= */

  var timelineSection = document.getElementById("detail-timeline");
  var timelineMarks = document.getElementById("timeline-marks");
  var timelineOverrun = document.getElementById("timeline-overrun");
  var timelineNote = document.getElementById("timeline-note");

  var DAY = 86400000;

  /** Milliseconds for a date or a datetime, or null when the value is neither. */
  function instant(value) {
    if (!value) { return null; }
    var parsed = Date.parse(value);
    return isNaN(parsed) ? null : parsed;
  }

  /** Strips a time off a datetime: the strip is about days, and a clock crowds the label. */
  function calendarDay(value) { return String(value).slice(0, 10); }

  /**
   * Every dated event on a page, chronological. The evaluation date is only ever a companion
   * to the page's own dates: it anchors them, but it never earns the strip on its own.
   */
  function timelineEvents(node) {
    var events = [];

    function add(kind, label, at, title) {
      var time = instant(at);
      if (time === null) { return; }
      events.push({ kind: kind, label: label, at: calendarDay(at), time: time, title: title });
    }

    if (node.generated) {
      add("written", "written", node.generated.at, "written by " + node.generated.by);
    }
    node.verified.forEach(function (event) {
      add("checked", event.by, event.at, "checked by " + event.by);
    });
    if (node.staleAfter) {
      var expiry = node.stale === true ? "expired" : "expires";
      add("expires", expiry, node.staleAfter, "stale after");
    }
    if (!events.length) { return events; }
    add("today", "today", payload.evaluatedAt, "freshness evaluated");
    events.sort(function (a, b) { return a.time - b.time; });
    return events;
  }

  function renderTimeline(node) {
    timelineMarks.replaceChildren();
    timelineOverrun.hidden = true;
    timelineNote.hidden = true;
    timelineNote.textContent = "";

    var events = node ? timelineEvents(node) : [];
    timelineSection.hidden = !events.length;
    if (!events.length) { return; }

    // One date, or several landing on the same instant, has no span to scale against.
    var low = events[0].time;
    var high = events[events.length - 1].time;
    var flat = high <= low;
    var pad = flat ? 0 : (high - low) * 0.08;
    var from = low - pad;
    var span = flat ? 0 : (high - low) + pad * 2;

    function place(time) { return flat ? 50 : ((time - from) / span) * 100; }

    // Alternate sides by whichever one was used less recently, so a cluster of dates spreads
    // across both instead of stacking its labels on one.
    var lastAbove = -1000;
    var lastBelow = -1000;
    var drawn = [];

    events.forEach(function (event) {
      var x = place(event.time);
      var above = lastAbove <= lastBelow;
      if (above) { lastAbove = x; } else { lastBelow = x; }

      var mark = document.createElement("div");
      mark.className = "tl-mark tl-" + event.kind + (above ? " tl-above" : " tl-below");
      mark.style.left = x + "%";
      mark.title = event.title + " " + event.at;

      var stem = document.createElement("span");
      stem.className = "tl-stem";
      mark.appendChild(stem);

      var dot = document.createElement("span");
      dot.className = "tl-dot";
      mark.appendChild(dot);

      var label = document.createElement("span");
      label.className = "tl-label";
      var what = document.createElement("span");
      what.className = "tl-what";
      what.textContent = event.label;
      var when = document.createElement("span");
      when.className = "tl-when";
      when.textContent = event.at;
      label.appendChild(what);
      label.appendChild(when);
      mark.appendChild(label);

      timelineMarks.appendChild(mark);
      drawn.push({ mark: mark, label: label });
    });

    // Anchor a label inward only when centring it would actually run off the strip. Measuring
    // beats a percentage threshold here: the labels vary from "today" to a namespaced actor,
    // so how close to the end is too close depends on the label, not on the date.
    var strip = timelineMarks.getBoundingClientRect();
    if (strip.width > 0) {
      drawn.forEach(function (entry) {
        var box = entry.label.getBoundingClientRect();
        if (box.left < strip.left) { entry.mark.classList.add("tl-start"); }
        else if (box.right > strip.right) { entry.mark.classList.add("tl-end"); }
      });
    }

    // The overrun is the stretch between an expiry already passed and the evaluation date.
    var expired = instant(node.staleAfter);
    var today = instant(payload.evaluatedAt);
    if (expired !== null && today !== null && today > expired) {
      var left = place(expired);
      timelineOverrun.style.left = left + "%";
      timelineOverrun.style.width = (place(today) - left) + "%";
      timelineOverrun.hidden = false;
      var days = Math.round((today - expired) / DAY);
      timelineNote.textContent = days + (days === 1 ? " day" : " days") + " past its stale-after date";
      timelineNote.hidden = false;
    }
  }

  /**
   * Proportional usage bars, appended to the source rows showNode already drew. The scale is
   * the busiest source on this page: the counts answer "which of these carries the weight",
   * and a bundle-wide scale would flatten every page that cites nothing popular.
   */
  function renderUsage(node) {
    var list = sourcesEl.querySelector("ul.plain");
    if (!list) { return; }

    var largest = 0;
    node.sources.forEach(function (source) {
      if (source.usageCount !== null && source.usageCount > largest) { largest = source.usageCount; }
    });
    if (!largest) { return; }

    var rows = list.children;
    node.sources.forEach(function (source, index) {
      var row = rows[index];
      if (!row || source.usageCount === null) { return; }

      var usage = document.createElement("span");
      usage.className = "usage";
      var bar = document.createElement("span");
      bar.className = "usage-bar";
      var fill = document.createElement("span");
      fill.className = "usage-fill";
      fill.style.width = ((source.usageCount / largest) * 100) + "%";
      bar.appendChild(fill);
      var count = document.createElement("span");
      count.className = "usage-count";
      count.textContent = "used " + source.usageCount.toLocaleString() + " times";
      usage.appendChild(bar);
      usage.appendChild(count);
      row.appendChild(usage);
    });

    // The window is a property of the measurement, so it is stated once rather than per row.
    var measured = node.usageWindow;
    if (measured && (measured.from || measured.to)) {
      var caption = document.createElement("div");
      caption.className = "usage-window";
      caption.textContent = "counted between " + (measured.from || "?") + " and " + (measured.to || "?");
      sourcesEl.appendChild(caption);
    }
  }

  // Wrap rather than edit: every existing call site reads this binding, so the strip and the
  // bars follow any selection, including one made from inside the panel.
  var baseShowNode = showNode;
  showNode = function (id, keepCamera) {
    baseShowNode(id, keepCamera);
    var node = nodeById[id];
    if (!node) { return; }
    renderTimeline(node);
    renderUsage(node);
  };

  // The opening page was drawn above, before this block existed. Catch it up.
  if (opening) {
    renderTimeline(opening);
    renderUsage(opening);
  }
})();
`;
