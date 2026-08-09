// Content importer: fills data/pages.json from a client project folder.
//
// Usage:
//   node import-content.js /path/to/Brand-Portal
//
// Folder convention (see README for the full writeup) — three levels: navbar
// category, then subcategory/sidebar page, then that page's own files:
//
//   Brand-Portal/
//     logo.svg                          <- optional, replaces assets/images/logo.svg
//     brand-guidelines/                 <- 1st level: navlink category
//       logo-system/                    <- 2nd level: subcategory / sidebar page
//         logo-system.md                <- 3rd level: the page's text content
//         content/                      <- 3rd level: photos/videos referenced from the .md
//           logo-clearspace.png         <- referenced from logo-system.md via ![](logo-clearspace.png)
//         download/                     <- 3rd level: any files here become that page's downloads
//           Print.pdf
//           Digital.zip
//       color-palette/
//         color-palette.md
//         content/
//         download/
//       ...
//     brand/
//       who-we-are/
//         who-we-are.md
//         content/
//         download/
//       ...
//     stationery/
//       business-cards/
//         business-cards.md
//         content/
//         download/
//     ...
//
// Rules:
//   - A page's body is only overwritten if a matching <slug>/<slug>.md file exists in
//     the source. Pages without a source file keep whatever content they already have
//     (safe to run repeatedly as a client sends more material over time).
//   - A page's downloads are only overwritten if that page's download/ folder exists
//     and has files in it. Files directly inside it are copied into
//     assets/downloads/<category>/<page>/ and become the page's downloads array
//     (label = filename, type = extension). A SUBFOLDER inside download/ is
//     treated as one asset kit and zipped into a single .zip download (e.g.
//     download/logo/ with dozens of format/variant files becomes one
//     "Logo.zip" button) — requires the system `zip` command.
//   - Markdown supports: paragraphs, "## " subheadings, "- " bullet lists, pipe
//     tables, and ![alt](file.png) images — the image file must sit in that page's
//     own content/ folder; it's copied into assets/images/ automatically. (Video
//     files can live in content/ too, but aren't auto-embedded yet — link them as a
//     download, or use an "embed" block in pages.json for a hosted video URL.)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const sourceDir = process.argv[2];
if (!sourceDir) {
  fail("usage: node import-content.js /path/to/ClientProjectFolder");
}
if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
  fail(`source folder not found: ${sourceDir}`);
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function titleCaseFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

// --- Markdown -> content blocks -------------------------------------------------

function parseMarkdown(md, { imagesSourceDir, imageDestPrefix, uniquePrefix, copyImage }) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraphBuf = [];

  function flushParagraph() {
    if (paragraphBuf.length) {
      blocks.push({ type: "p", text: paragraphBuf.join(" ").trim() });
      paragraphBuf = [];
    }
  }

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (line === "") {
      flushParagraph();
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      i++;
      continue;
    }

    // Tolerate a whole line wrapped in quotes (some editors/apps do this when
    // pasting an image reference), e.g. "![alt](file.jpg)" with real quote marks.
    const unquoted = line.replace(/^["']|["']$/g, "");
    const imgMatch = unquoted.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      flushParagraph();
      const alt = imgMatch[1];
      const rawSrc = imgMatch[2];
      const destSrc = copyImage(rawSrc, imagesSourceDir, imageDestPrefix, uniquePrefix);
      blocks.push({ type: "image", src: destSrc, alt });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const cellsOf = (l) =>
        l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (tableLines.length >= 1) {
        const headers = cellsOf(tableLines[0]);
        const isSeparator = (l) => /^[\s:|-]+$/.test(l);
        const dataLines = tableLines.slice(1).filter((l) => !isSeparator(l));
        const rows = dataLines.map(cellsOf);
        blocks.push({ type: "table", headers, rows });
      }
      continue;
    }

    paragraphBuf.push(line);
    i++;
  }
  flushParagraph();
  return blocks;
}

function zipDirectory(srcDir, destZipPath) {
  // Uses the system `zip` binary (present by default on macOS/Linux). Zips
  // the *contents* of srcDir, not the folder itself, so extracting the
  // download lands the files directly instead of one level deeper.
  execFileSync("zip", ["-rq", destZipPath, "."], { cwd: srcDir });
}

function listFilesRecursive(dir, relPrefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, rel));
    } else {
      out.push({ full, rel });
    }
  }
  return out;
}

function copyImageFactory(destImagesDir) {
  return function copyImage(rawSrc, sourceDir, destPrefix, uniquePrefix) {
    const srcPath = path.join(sourceDir, rawSrc);
    if (!fs.existsSync(srcPath)) {
      console.warn(`  ! image referenced but not found: ${rawSrc} (looked in ${sourceDir})`);
      return `${destPrefix}${rawSrc}`;
    }
    // uniquePrefix is "<category>-<page>", not the immediate parent folder's
    // name — every page's images now live in a folder that's always just
    // called "content", so using that folder's own name here would collide
    // two images named the same across different pages into one file.
    const destName = `${uniquePrefix}-${path.basename(rawSrc)}`.replace(/\s+/g, "-");
    fs.mkdirSync(destImagesDir, { recursive: true });
    fs.copyFileSync(srcPath, path.join(destImagesDir, destName));
    return `${destPrefix}${destName}`;
  };
}

// --- Main import ------------------------------------------------------------

function main() {
  const categories = loadJson(path.join(ROOT, "data/categories.json"));
  const pages = loadJson(path.join(ROOT, "data/pages.json"));

  const imagesDestDir = path.join(ROOT, "assets/images");
  const copyImage = copyImageFactory(imagesDestDir);

  let pagesUpdated = 0;
  let downloadsUpdated = 0;

  for (const category of categories) {
    const categoryDir = path.join(sourceDir, category.slug);
    if (!fs.existsSync(categoryDir)) continue;

    const categoryPages = pages.filter((p) => p.categoryId === category.id);
    for (const page of categoryPages) {
      const pageDir = path.join(categoryDir, page.slug);
      if (!fs.existsSync(pageDir)) continue;

      const mdPath = path.join(pageDir, `${page.slug}.md`);
      const contentDir = path.join(pageDir, "content");
      if (fs.existsSync(mdPath)) {
        const md = fs.readFileSync(mdPath, "utf8");
        page.body = parseMarkdown(md, {
          imagesSourceDir: contentDir,
          imageDestPrefix: "../../assets/images/",
          uniquePrefix: `${category.slug}-${page.slug}`,
          copyImage,
        });
        pagesUpdated++;
        console.log(`  content: ${category.slug}/${page.slug}/${page.slug}.md -> ${page.body.length} block(s)`);
      }

      const downloadsDir = path.join(pageDir, "download");
      if (fs.existsSync(downloadsDir) && fs.statSync(downloadsDir).isDirectory()) {
        const entries = fs
          .readdirSync(downloadsDir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith("."));
        if (entries.length) {
          const destDir = path.join(ROOT, "assets/downloads", category.slug, page.slug);
          fs.mkdirSync(destDir, { recursive: true });
          const downloads = [];
          for (const entry of entries) {
            const entryPath = path.join(downloadsDir, entry.name);
            if (entry.isDirectory()) {
              // A subfolder is a whole asset kit (e.g. every format/variant of
              // one logo lockup) — bundle it into a single .zip download
              // rather than one download button per file inside it.
              const zipName = `${entry.name}.zip`.replace(/\s+/g, "-");
              const zipDest = path.join(destDir, zipName);
              try {
                zipDirectory(entryPath, zipDest);
                downloads.push({
                  label: titleCaseFromFilename(entry.name),
                  type: "ZIP",
                  url: `../../assets/downloads/${category.slug}/${page.slug}/${encodeURIComponent(zipName)}`,
                });
              } catch (err) {
                console.warn(`  ! couldn't zip "${entry.name}/" (is the "zip" command installed?) — copying its files individually instead`);
                for (const { full, rel } of listFilesRecursive(entryPath)) {
                  const flatName = `${entry.name}-${rel}`.replace(/[\\/\s]+/g, "-");
                  fs.copyFileSync(full, path.join(destDir, flatName));
                  const ext = path.extname(flatName).replace(".", "").toUpperCase();
                  downloads.push({
                    label: titleCaseFromFilename(`${entry.name} ${rel}`),
                    type: ext,
                    url: `../../assets/downloads/${category.slug}/${page.slug}/${encodeURIComponent(flatName)}`,
                  });
                }
              }
            } else {
              fs.copyFileSync(entryPath, path.join(destDir, entry.name));
              const ext = path.extname(entry.name).replace(".", "").toUpperCase();
              downloads.push({
                label: titleCaseFromFilename(entry.name),
                type: ext,
                url: `../../assets/downloads/${category.slug}/${page.slug}/${encodeURIComponent(entry.name)}`,
              });
            }
          }
          if (downloads.length) {
            page.downloads = downloads;
            downloadsUpdated++;
            console.log(`  downloads: ${category.slug}/${page.slug}/download/ -> ${downloads.length} item(s)`);
          }
        }
      }
    }
  }

  const logoSrc = path.join(sourceDir, "logo.svg");
  let logoUpdated = false;
  if (fs.existsSync(logoSrc)) {
    fs.mkdirSync(imagesDestDir, { recursive: true });
    fs.copyFileSync(logoSrc, path.join(imagesDestDir, "logo.svg"));
    logoUpdated = true;
  }

  saveJson(path.join(ROOT, "data/pages.json"), pages);

  console.log("");
  console.log(`Done. ${pagesUpdated} page(s) got new content, ${downloadsUpdated} page(s) got new downloads${logoUpdated ? ", logo replaced" : ""}.`);
  console.log("Run `node build.js` to regenerate dist/ with the imported content.");
}

main();
