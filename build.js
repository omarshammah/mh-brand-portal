// Static site generator for the Brand Portal template.
// Data model mirrors what a Google Sheet export would look like (see data/*.json),
// so swapping to a live Sheet-fetch later only means changing loadData() below.
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

function loadData() {
  const brand = JSON.parse(fs.readFileSync(path.join(ROOT, "data/brand.config.json"), "utf8"));
  const categories = JSON.parse(fs.readFileSync(path.join(ROOT, "data/categories.json"), "utf8"))
    .sort((a, b) => a.order - b.order);
  const pages = JSON.parse(fs.readFileSync(path.join(ROOT, "data/pages.json"), "utf8"))
    .sort((a, b) => a.order - b.order);
  const legal = JSON.parse(fs.readFileSync(path.join(ROOT, "data/legal.json"), "utf8"));
  return { brand, categories, pages, legal };
}

function pagesFor(categoryId, pages) {
  return pages.filter((p) => p.categoryId === categoryId);
}

// Nav/sidebar links display sentence case ("Logo system") regardless of how
// the title is cased in data/pages.json ("Logo System") — everywhere else
// (page <h1>, <title>, category cards) keeps the title's original casing.
// Done here in JS rather than via CSS text-transform + ::first-letter because
// the nav/sidebar links are display:flex, and ::first-letter doesn't apply to
// flex containers in any browser.
function toSentenceCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Where a navbar category link should actually land: straight on that
// category's first subpage (by `order`) rather than the card-grid overview,
// so clicking "Brand Guidelines" opens "Logo System" immediately. Falls back
// to the category landing page only if it has no subpages yet.
function categoryEntryUrl(category, pages) {
  const first = pagesFor(category.id, pages)[0];
  return first ? `${category.slug}/${first.slug}/index.html` : `${category.slug}/index.html`;
}

// `rel` is the relative path prefix back to the site root (e.g. "" at the
// root, "../" one level deep, "../../" two levels deep). Every internal
// link points at an explicit index.html (not just a folder), because
// browsers won't auto-resolve a folder to its index.html over file:// —
// that's what caused links to fall through to Finder instead of navigating.
function navHtml(categories, pages, activeCategoryId, activePageId, rel) {
  // Structure mirrors omarshammah.com's real navbar exactly (verified via the
  // Webflow Designer API): the outer div carries the flex layout, the width
  // (4.6em) lives on the <a class="logo">, and the <img> itself has no
  // forced width — it sizes to its own aspect ratio inside that box. States
  // (hover/pressed/visited/current-page) are plain color changes — no
  // underline element, no animation.
  //
  // Each category renders TWO parallel controls, and style.css shows only
  // one per breakpoint: on desktop, .nav-cat-link is a plain link straight
  // to the category's first subpage (unchanged behavior). Below the tablet
  // breakpoint, that link is hidden and a <details> element takes over —
  // a native, JS-free accordion that expands .nav-subpages in place,
  // folding what used to be the separate stacked sidebar directly into the
  // Menu dropdown. The current category starts pre-expanded (`open`
  // attribute) so opening the menu already shows exactly what the desktop
  // sidebar would.
  //
  // All the <details> elements share one `name` ("nav-cat-accordion"),
  // which makes them an exclusive group in every modern browser: opening
  // one automatically closes whichever other was open. <details> also
  // keeps its normal built-in behavior on top of that — clicking the
  // currently-open one's header closes it — so both "only one open at a
  // time" and "click again to collapse" come for free, no JS.
  const links = categories
    .map((c) => {
      const isActiveCat = c.id === activeCategoryId;
      const catUrl = `${rel}${categoryEntryUrl(c, pages)}`;
      const subpages = pagesFor(c.id, pages)
        .map((p) => {
          const isActivePage = p.id === activePageId;
          return `<a href="${rel}${c.slug}/${p.slug}/index.html" class="${isActivePage ? "active" : ""}">${toSentenceCase(p.title)}</a>`;
        })
        .join("\n            ");
      return `<div class="nav-item">
        <a href="${catUrl}" class="nav-cat-link ${isActiveCat ? "active" : ""}">${toSentenceCase(c.name)}</a>
        <details class="nav-cat-accordion" name="nav-cat-accordion" ${isActiveCat ? "open" : ""}>
          <summary class="nav-cat-toggle-label ${isActiveCat ? "active" : ""}">${toSentenceCase(c.name)}</summary>
          <div class="nav-subpages">
            ${subpages}
          </div>
        </details>
      </div>`;
    })
    .join("\n      ");
  const logoBlock = `<div class="logo-wrapper">
      <a href="${rel}index.html" class="logo"><img src="${rel}assets/images/logo.svg" alt="Logo" class="navbar-logo" /></a>
      </div>`;
  // Below the tablet breakpoint (991px, matching omarshammah.com's own
  // tablet cutoff) the inline links no longer fit, so they collapse behind a
  // "Menu" toggle. This is a checkbox-driven CSS-only toggle (no JS) — the
  // checkbox and its label must stay siblings of .nav-links for the
  // :checked ~ selector in style.css to reach it. The label shows "Menu"
  // normally and swaps to "Close" once the checkbox is checked (also via a
  // :checked ~ sibling rule — no JS needed to change the text either), so
  // the close control sits in exactly the same spot the "Menu" label did —
  // there's deliberately no separate close button anywhere else.
  const menuToggle = `<input type="checkbox" id="nav-toggle" class="nav-toggle-checkbox" />
      <label for="nav-toggle" class="nav-toggle-label">
        <span class="nav-toggle-text-open">Menu</span>
        <span class="nav-toggle-text-close">Close</span>
      </label>`;
  return `${logoBlock}\n      ${menuToggle}\n      <div class="nav-links">\n      ${links}\n      </div>`;
}

function sidebarHtml(category, pages, activePageId, rel) {
  // `rel` here is the path from the current page to the category folder itself
  // (e.g. "" from the category landing page, "../" from a subpage one level in).
  const items = pagesFor(category.id, pages)
    .map(
      (p) =>
        `<li><a href="${rel}${p.slug}/index.html" class="${p.id === activePageId ? "active" : ""}">${toSentenceCase(p.title)}</a></li>`
    )
    .join("\n        ");
  return `<h2>${category.name}</h2>\n      <ul>\n        ${items}\n      </ul>`;
}

function downloadsHtml(page) {
  if (!page.downloads || page.downloads.length === 0) return "";
  const items = page.downloads
    .map(
      (d) => `
      <div class="download-item">
        <div>
          <div class="file-label">${d.label}</div>
          <div class="file-type">${d.type}</div>
        </div>
        <a class="btn" href="${d.url}" target="_blank" rel="noopener">Download</a>
      </div>`
    )
    .join("");
  return `
    <div class="downloads">
      <h3>Downloads</h3>
      ${items}
    </div>`;
}

// Content blocks: each item in a page's `body` array has a `type`.
// Supported types: p, placeholder, h2, h3, list, table, image, embed.
// See README for the exact shape of each.
function renderBlock(block) {
  switch (block.type) {
    case "p":
      return `<p>${block.text}</p>`;
    case "placeholder":
      return `<p class="placeholder-note">${block.text}</p>`;
    case "h2":
      return `<h2 class="section-heading">${block.text}</h2>`;
    case "h3":
      return `<h3 class="section-subheading">${block.text}</h3>`;
    case "list":
      return `<ul class="content-list">${block.items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
    case "table": {
      const head = `<tr>${block.headers.map((h) => `<th>${h}</th>`).join("")}</tr>`;
      const rows = block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("");
      return `<table class="content-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
    case "image":
      return `<figure class="content-figure"><img src="${block.src}" alt="${block.alt || ""}" />${
        block.caption ? `<figcaption>${block.caption}</figcaption>` : ""
      }</figure>`;
    case "embed":
      // For embedding a published Google Slides deck, Figma file, etc.
      // Use the platform's "Embed" / "Publish to web" iframe URL as `src`.
      return `<div class="content-embed"><iframe src="${block.src}" title="${
        block.title || ""
      }" loading="lazy" allowfullscreen></iframe></div>`;
    default:
      return "";
  }
}

function renderBody(body) {
  return body.map(renderBlock).join("\n      ");
}

// Shared by pageShell and the standalone legal pages so the footer only
// needs to be defined once. Imprint / Privacy Policy / Cookie Policy render
// grey (the site's default link color); the studio site link is the only
// one styled black, via .footer-link-primary.
function footerHtml(brand, rel) {
  return `<div class="footer-main">
      <span>${brand.clientName} — Brand Portal · internal reference, not for external distribution</span>
      <div class="footer-links">
        <a href="${rel}imprint/index.html">Imprint</a>
        <a href="${rel}privacy-policy/index.html">Privacy Policy</a>
        <a href="${rel}cookie-policy/index.html">Cookie Policy</a>
        <a href="https://www.omarshammah.com" target="_blank" rel="noopener" class="footer-link-primary">omarshammah.com</a>
      </div>
    </div>
    <div class="footer-contact">for questions and inquiries: <a href="mailto:hey@omarshammah.com" class="footer-contact-btn">hey@omarshammah.com</a></div>`;
}

// Shared <head> extras that fight the "glitch on navigation" symptom: a
// declared light color-scheme stops the browser from flashing a dark
// pre-CSS background on every full page load for users in OS/browser dark
// mode (the most common cause of a visible flash between static pages), and
// preloading the two font files stops the brief unstyled-text swap (FOUT)
// that otherwise happens as each new page re-renders.
function headExtras(rel) {
  return `<meta name="color-scheme" content="light" />
  <link rel="preload" href="${rel}assets/fonts/NeueCampton-Regular.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="${rel}assets/fonts/NeueCampton-Light.woff2" as="font" type="font/woff2" crossorigin />`;
}

function pageShell({ brand, title, navActive, sidebar, bodyHtml, rel }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${headExtras(rel)}
  <title>${title} — ${brand.clientName} Brand Portal</title>
  <link rel="stylesheet" href="${rel}assets/style.css" />
</head>
<body>
  <nav class="navbar">
      ${navActive}
  </nav>
  <div class="layout">
    <aside class="sidebar">
      ${sidebar}
    </aside>
    <main class="content">
      ${bodyHtml}
    </main>
  </div>
  <footer>
    ${footerHtml(brand, rel)}
  </footer>
</body>
</html>`;
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function buildCategoryLanding(category, data) {
  const { brand, categories, pages } = data;
  const rel = "../"; // dist/<category>/index.html is 1 level deep
  const items = pagesFor(category.id, pages);
  const cards = items
    .map(
      (p) => `
      <a class="card" href="${p.slug}/index.html">
        <div class="card-title">${p.title}</div>
        <div class="card-desc">${p.summary}</div>
      </a>`
    )
    .join("");

  const bodyHtml = `
      <div class="eyebrow">${category.name}</div>
      <h1>${category.name}</h1>
      <p>${category.intro}</p>
      <div class="card-grid">${cards}</div>`;

  const html = pageShell({
    brand,
    title: category.name,
    navActive: navHtml(categories, pages, category.id, null, rel),
    sidebar: sidebarHtml(category, pages, null, ""), // links to siblings within this category: no prefix needed
    bodyHtml,
    rel,
  });
  writeFile(path.join(DIST, category.slug, "index.html"), html);
}

function buildSubpage(page, data) {
  const { brand, categories, pages } = data;
  const rel = "../../"; // dist/<category>/<page>/index.html is 2 levels deep
  const category = categories.find((c) => c.id === page.categoryId);

  const bodyHtml = `
      <div class="eyebrow">${category.name}</div>
      <h1>${page.title}</h1>
      ${renderBody(page.body)}
      ${downloadsHtml(page)}`;

  const html = pageShell({
    brand,
    title: page.title,
    navActive: navHtml(categories, pages, category.id, page.id, rel),
    sidebar: sidebarHtml(category, pages, page.id, "../"), // sibling pages are one level up from here
    bodyHtml,
    rel,
  });
  writeFile(path.join(DIST, category.slug, page.slug, "index.html"), html);
}

function buildHome(data) {
  const { brand, categories, pages } = data;
  const first = categories[0];
  const entryUrl = categoryEntryUrl(first, pages);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0; url=${entryUrl}" />
  <title>${brand.clientName} Brand Portal</title>
</head>
<body>
  <p>Redirecting to <a href="${entryUrl}">${first.name}</a>…</p>
</body>
</html>`;
  writeFile(path.join(DIST, "index.html"), html);
}

// Imprint / Privacy Policy / Cookie Policy: standalone pages linked only
// from the footer, not tied to any navbar category, so they skip the
// sidebar/two-column layout and just get a full-width content column.
function buildLegalPage(page, data) {
  const { brand, categories, pages } = data;
  const rel = "../"; // dist/<slug>/index.html is 1 level deep

  const bodyHtml = `
      <h1>${page.title}</h1>
      ${renderBody(page.body)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${headExtras(rel)}
  <title>${page.title} — ${brand.clientName} Brand Portal</title>
  <link rel="stylesheet" href="${rel}assets/style.css" />
</head>
<body>
  <nav class="navbar">
      ${navHtml(categories, pages, null, null, rel)}
  </nav>
  <main class="content legal-content">
      ${bodyHtml}
  </main>
  <footer>
    ${footerHtml(brand, rel)}
  </footer>
</body>
</html>`;
  writeFile(path.join(DIST, page.slug, "index.html"), html);
}

function buildAssets(data) {
  const css = fs
    .readFileSync(path.join(ROOT, "assets/style.css"), "utf8")
    .replace("__PRIMARY__", data.brand.colors.primary)
    .replace("__ACCENT__", data.brand.colors.accent)
    .replace("__LIGHT__", data.brand.colors.light)
    .replace("__TEXT__", data.brand.colors.text)
    .replace("__MUTED__", data.brand.colors.muted)
    .replace("__FONT__", data.brand.fontFamily);
  writeFile(path.join(DIST, "assets/style.css"), css);

  // Copy any user-added images across (assets/images/* -> dist/assets/images/*)
  const imgSrc = path.join(ROOT, "assets/images");
  if (fs.existsSync(imgSrc)) {
    fs.cpSync(imgSrc, path.join(DIST, "assets/images"), { recursive: true });
  }

  // Copy self-hosted font files across (assets/fonts/* -> dist/assets/fonts/*)
  const fontSrc = path.join(ROOT, "assets/fonts");
  if (fs.existsSync(fontSrc)) {
    fs.cpSync(fontSrc, path.join(DIST, "assets/fonts"), { recursive: true });
  }

  // Copy downloadable template/working files across (assets/downloads/* -> dist/assets/downloads/*)
  const downloadsSrc = path.join(ROOT, "assets/downloads");
  if (fs.existsSync(downloadsSrc)) {
    fs.cpSync(downloadsSrc, path.join(DIST, "assets/downloads"), { recursive: true });
  }
}

function main() {
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
  const data = loadData();
  buildAssets(data);
  buildHome(data);
  data.categories.forEach((c) => buildCategoryLanding(c, data));
  data.pages.forEach((p) => buildSubpage(p, data));
  data.legal.forEach((p) => buildLegalPage(p, data));
  const pageCount = 1 + data.categories.length + data.pages.length + data.legal.length;
  console.log(`Built ${pageCount} static pages into dist/`);
}

main();
