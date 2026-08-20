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
    node.links.forEach(function (link) { map[link.href] = link.target; });
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
  var layoutSelect = document.getElementById("layout");

  document.getElementById("bundle").textContent = payload.bundle;
  document.getElementById("counts").textContent =
    graph.nodes.length + " pages, " + graph.edges.length + " relationships";

  graph.types.forEach(function (type) {
    var option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeSelect.appendChild(option);
  });

  var cy = cytoscape({
    container: document.getElementById("graph"),
    elements: graph.nodes.map(function (node) {
      return { data: { id: node.id, label: node.title, color: node.color, size: node.size } };
    }).concat(graph.edges.map(function (edge) {
      return { data: { id: edge.id, source: edge.source, target: edge.target, relation: edge.relation } };
    })),
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "label": "data(label)",
          "color": "#64748b",
          "font-size": 10,
          "text-valign": "bottom",
          "text-margin-y": 5,
          "text-wrap": "wrap",
          "text-max-width": 130,
          "width": "data(size)",
          "height": "data(size)"
        }
      },
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
      { selector: "edge:selected", style: { "line-color": "#b45309", "target-arrow-color": "#b45309", "width": 2.4 } },
      { selector: ".dim", style: { "opacity": 0.12 } }
    ],
    layout: { name: "cose", animate: false, padding: 36 }
  });

  cy.on("tap", "node", function (event) { showNode(event.target.id()); });
  cy.on("tap", function (event) { if (event.target === cy) { clearSelection(); } });

  layoutSelect.addEventListener("change", function () {
    cy.layout({ name: layoutSelect.value, animate: false, padding: 36 }).run();
  });

  document.getElementById("reset").addEventListener("click", function () {
    searchInput.value = "";
    typeSelect.value = "";
    applyFilters();
    cy.fit(undefined, 36);
    clearSelection();
  });

  searchInput.addEventListener("input", applyFilters);
  typeSelect.addEventListener("change", applyFilters);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { clearSelection(); }
  });

  function applyFilters() {
    var query = searchInput.value.trim().toLowerCase();
    var type = typeSelect.value;
    cy.nodes().forEach(function (element) {
      var node = nodeById[element.id()];
      var matches = !type || node.type === type;
      if (matches && query) {
        var haystack = (node.title + " " + node.path + " " + node.description).toLowerCase();
        matches = haystack.indexOf(query) !== -1;
      }
      element.toggleClass("dim", !matches);
    });
    cy.edges().forEach(function (element) {
      element.toggleClass("dim", element.source().hasClass("dim") || element.target().hasClass("dim"));
    });
  }

  function clearSelection() {
    cy.elements().unselect();
    emptyEl.hidden = false;
    contentEl.hidden = true;
  }

  function showNode(id) {
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
    statusEl.textContent = node.status || "—";

    sourcesEl.replaceChildren();
    if (node.sources.length) {
      var list = document.createElement("ul");
      list.className = "plain";
      node.sources.forEach(function (source) {
        var item = document.createElement("li");
        appendExternal(source.resource, source.title, item);
        list.appendChild(item);
      });
      sourcesEl.appendChild(list);
    } else {
      sourcesEl.textContent = "—";
    }

    bodyEl.replaceChildren();
    renderMarkdown(node.body, bodyEl, node.id);

    var outgoing = [];
    var already = Object.create(null);
    node.links.forEach(function (link) {
      if (link.target !== node.id && !already[link.target]) {
        already[link.target] = true;
        outgoing.push(link.target);
      }
    });
    fillReferences(outSection, outList, outgoing);
    fillReferences(backSection, backList, backlinks[node.id] || []);

    detailEl.scrollTop = 0;
    if (element && element.length) {
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
  if (opening) { showNode(opening.id); }
})();
`;
