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
//   - Markdown supports: paragraphs, "## " and "### " subheadings, "- " bullet lists,
//     pipe tables, and ![alt](file.png) images — the image file must sit in that
//     page's own content/ folder; it's copied into assets/images/ automatically.
//     (Video files can live in content/ too, but aren't auto-embedded yet — link
//     them as a download, or use an "embed" block in pages.json for a hosted video
//     URL.) Inline formatting works inside paragraphs, headings, list items, and
//     table cells: [text](url) links, **bold**, and ==highlighted==.
//   - Any .ase (Adobe Swatch Exchange) file dropped into a page's download/ folder
//     is parsed automatically and turned into a Swatch/Name/HEX/RGB table on that
//     page — this is how the Color Palette page's table gets built, no manual
//     table-writing needed. The .ase file is also still copied through as its own
//     downloadable file. Re-running the importer with an updated .ase regenerates
//     the table in place (it's tracked separately from any hand-written table).

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

// Inline formatting applied inside paragraphs, headings, list items, and table
// cells: [link text](url) -> a link (see README's "Cross-references between
// pages"), **bold text** -> bold, ==highlighted text== -> a yellow highlight.
// `resolveLink`, if given, gets first crack at rewriting a link's URL — used to
// auto-fix cross-page links that forgot the "../../" prefix (see resolveLink
// factory below).
function applyInlineFormatting(text, resolveLink) {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => `<a href="${resolveLink ? resolveLink(url) : url}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>");
}

// Builds a resolveLink(url) function that recognizes a plain "<category-slug>/
// <page-slug>" link (with or without a trailing "/index.html") that's missing
// its "../../" prefix — an easy mistake since every page sits two folders deep
// — and rewrites it to the correct relative path. Only touches links that
// exactly match a real category/page slug pair; anything else (already-correct
// "../../..." links, http(s) URLs, "#anchor", "mailto:") passes through as-is.
function makeResolveLink(categories, pages) {
  const known = new Set();
  for (const p of pages) {
    const cat = categories.find((c) => c.id === p.categoryId);
    if (cat) known.add(`${cat.slug}/${p.slug}`);
  }
  return function resolveLink(url) {
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^(mailto:|#)/i.test(url) || url.startsWith("../") || url.startsWith("/")) {
      return url;
    }
    const m = url.match(/^([a-z0-9-]+)\/([a-z0-9-]+)\/?(?:index\.html)?$/i);
    if (m && known.has(`${m[1]}/${m[2]}`)) {
      return `../../${m[1]}/${m[2]}/index.html`;
    }
    return url;
  };
}

function parseMarkdown(md, { imagesSourceDir, imageDestPrefix, uniquePrefix, copyImage, resolveLink }) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraphBuf = [];

  function flushParagraph() {
    if (paragraphBuf.length) {
      blocks.push({ type: "p", text: applyInlineFormatting(paragraphBuf.join(" ").trim(), resolveLink) });
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

    // "## " / "### " subheadings — lenient about a missing space after the
    // hashes ("##Heading") and an optional trailing "###" decoration
    // ("### Heading ###"), both easy mistakes in a plain text editor.
    const headingMatch = line.match(/^(#{2,3})\s*(.*?)\s*#*$/);
    if (headingMatch && headingMatch[2]) {
      flushParagraph();
      const level = headingMatch[1].length;
      blocks.push({ type: level === 3 ? "h3" : "h2", text: applyInlineFormatting(headingMatch[2], resolveLink) });
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
        items.push(applyInlineFormatting(lines[i].trim().replace(/^[-*]\s+/, ""), resolveLink));
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
        l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => applyInlineFormatting(c.trim(), resolveLink));
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

// --- ASE (Adobe Swatch Exchange) -> color table ---------------------------------
//
// Binary format: "ASEF" signature, version (4 bytes, unused here), block count
// (uint32 BE), then a stream of blocks. We only care about color-entry blocks
// (type 0x0001); group start/end blocks (0xc001/0xc002) are skipped over via
// the block-length field, which flattens any grouping — fine for a flat table.

function readUtf16BEString(buffer, offset, numChars) {
  let str = "";
  for (let i = 0; i < numChars; i++) {
    const code = buffer.readUInt16BE(offset + i * 2);
    if (code === 0) continue; // trailing null terminator
    str += String.fromCharCode(code);
  }
  return str;
}

// CIE L*a*b* (D65) -> sRGB, standard conversion, used for LAB swatches.
function labToRgb(L, a, b) {
  let y = (L + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;
  const finv = (t) => (Math.pow(t, 3) > 0.008856 ? Math.pow(t, 3) : (t - 16 / 116) / 7.787);
  x = finv(x) * 95.047;
  y = finv(y) * 100.0;
  z = finv(z) * 108.883;
  x /= 100;
  y /= 100;
  z /= 100;
  let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let bl = x * 0.0557 + y * -0.204 + z * 1.057;
  const gamma = (c) => (c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c);
  r = gamma(r);
  g = gamma(g);
  bl = gamma(bl);
  const clamp = (c) => Math.max(0, Math.min(255, Math.round(c * 255)));
  return [clamp(r), clamp(g), clamp(bl)];
}

function toHex(rgb) {
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function parseASE(buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "ASEF") {
    throw new Error("not a valid .ase file (missing ASEF signature)");
  }
  const numBlocks = buffer.readUInt32BE(8);
  let offset = 12;
  const swatches = [];
  for (let i = 0; i < numBlocks && offset + 6 <= buffer.length; i++) {
    const blockType = buffer.readUInt16BE(offset);
    const blockLength = buffer.readUInt32BE(offset + 2);
    const blockStart = offset + 6;
    if (blockType === 0x0001) {
      let p = blockStart;
      const nameLen = buffer.readUInt16BE(p);
      p += 2;
      const name = readUtf16BEString(buffer, p, nameLen).trim();
      p += nameLen * 2;
      const model = buffer.toString("ascii", p, p + 4).trim();
      p += 4;
      let rgb = null;
      let cmyk = null; // raw 0-1 floats, kept separately from the RGB used for HEX/RGB columns
      if (model === "RGB") {
        const r = buffer.readFloatBE(p);
        p += 4;
        const g = buffer.readFloatBE(p);
        p += 4;
        const b = buffer.readFloatBE(p);
        p += 4;
        rgb = [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
      } else if (model === "CMYK") {
        const c = buffer.readFloatBE(p);
        p += 4;
        const m = buffer.readFloatBE(p);
        p += 4;
        const y = buffer.readFloatBE(p);
        p += 4;
        const k = buffer.readFloatBE(p);
        p += 4;
        cmyk = [c, m, y, k];
        rgb = [
          Math.round(255 * (1 - c) * (1 - k)),
          Math.round(255 * (1 - m) * (1 - k)),
          Math.round(255 * (1 - y) * (1 - k)),
        ];
      } else if (model === "LAB") {
        const L = buffer.readFloatBE(p);
        p += 4;
        const A = buffer.readFloatBE(p);
        p += 4;
        const B = buffer.readFloatBE(p);
        p += 4;
        rgb = labToRgb(L, A, B);
      } else if (model === "Gray" || model === "GRAY") {
        const g = buffer.readFloatBE(p);
        p += 4;
        const v = Math.round(g * 255);
        rgb = [v, v, v];
      }
      if (rgb && name) {
        swatches.push({ name, model, rgb, cmyk, hex: toHex(rgb) });
      }
    }
    offset = blockStart + blockLength;
  }
  return swatches;
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
  const resolveLink = makeResolveLink(categories, pages);

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
          resolveLink,
        });
        pagesUpdated++;
        console.log(`  content: ${category.slug}/${page.slug}/${page.slug}.md -> ${page.body.length} block(s)`);
      }

      const downloadsDir = path.join(pageDir, "download");
      const downloads = [];
      const destDownloadDir = path.join(ROOT, "assets/downloads", category.slug, page.slug);

      if (fs.existsSync(downloadsDir) && fs.statSync(downloadsDir).isDirectory()) {
        const entries = fs
          .readdirSync(downloadsDir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith("."));
        if (entries.length) {
          fs.mkdirSync(destDownloadDir, { recursive: true });
          for (const entry of entries) {
            const entryPath = path.join(downloadsDir, entry.name);
            if (entry.isDirectory()) {
              // A subfolder is a whole asset kit (e.g. every format/variant of
              // one logo lockup) — bundle it into a single .zip download
              // rather than one download button per file inside it.
              const zipName = `${entry.name}.zip`.replace(/\s+/g, "-");
              const zipDest = path.join(destDownloadDir, zipName);
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
                  fs.copyFileSync(full, path.join(destDownloadDir, flatName));
                  const ext = path.extname(flatName).replace(".", "").toUpperCase();
                  downloads.push({
                    label: titleCaseFromFilename(`${entry.name} ${rel}`),
                    type: ext,
                    url: `../../assets/downloads/${category.slug}/${page.slug}/${encodeURIComponent(flatName)}`,
                  });
                }
              }
            } else {
              fs.copyFileSync(entryPath, path.join(destDownloadDir, entry.name));
              const ext = path.extname(entry.name).replace(".", "").toUpperCase();
              downloads.push({
                label: titleCaseFromFilename(entry.name),
                type: ext,
                url: `../../assets/downloads/${category.slug}/${page.slug}/${encodeURIComponent(entry.name)}`,
              });
            }
          }
        }
      }

      // Any .ase swatch library auto-builds a color table on this page — no
      // hand-written table needed. Swatches are merged by NAME across every
      // .ase file found, so e.g. a "Palette-RGB.ase" and a "Palette-CMYK.ase"
      // with matching swatch names combine into one row per color: RGB and
      // HEX come from the RGB-model swatch, CMYK from the CMYK-model swatch,
      // rather than converting one to the other (which would drift/round).
      //
      // Looked for in BOTH download/ and content/ — content/ is an easy place
      // to drop it by mistake (it's also where other reference material like
      // images lives), so both are checked rather than silently doing nothing
      // if it's in the "wrong" one. A file already handled by the download/
      // loop above isn't re-copied; one found only in content/ gets copied
      // into the downloads folder and added as its own download button too.
      const byName = new Map();
      let order = 0;
      for (const aseDir of [downloadsDir, contentDir]) {
        if (!fs.existsSync(aseDir) || !fs.statSync(aseDir).isDirectory()) continue;
        const aseFiles = fs
          .readdirSync(aseDir, { withFileTypes: true })
          .filter((e) => e.isFile() && /\.ase$/i.test(e.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const f of aseFiles) {
          try {
            const buf = fs.readFileSync(path.join(aseDir, f.name));
            for (const s of parseASE(buf)) {
              let entry = byName.get(s.name);
              if (!entry) {
                entry = { name: s.name, order: order++ };
                byName.set(s.name, entry);
              }
              if (s.model === "RGB") {
                entry.rgb = s.rgb;
              } else if (s.model === "CMYK") {
                entry.cmyk = s.cmyk;
                if (!entry.rgb) entry.rgb = s.rgb; // fallback if no RGB-model entry ever shows up for this name
              } else if (!entry.rgb) {
                entry.rgb = s.rgb; // LAB/Gray fallback
              }
            }
            if (aseDir !== downloadsDir) {
              fs.mkdirSync(destDownloadDir, { recursive: true });
              fs.copyFileSync(path.join(aseDir, f.name), path.join(destDownloadDir, f.name));
              downloads.push({
                label: titleCaseFromFilename(f.name),
                type: "ASE",
                url: `../../assets/downloads/${category.slug}/${page.slug}/${encodeURIComponent(f.name)}`,
              });
            }
          } catch (err) {
            console.warn(`  ! couldn't parse ${category.slug}/${page.slug}/${path.basename(aseDir)}/${f.name}: ${err.message}`);
          }
        }
      }

      if (downloads.length) {
        page.downloads = downloads;
        downloadsUpdated++;
        console.log(`  downloads: ${category.slug}/${page.slug} -> ${downloads.length} item(s)`);
      }

      const merged = [...byName.values()].sort((a, b) => a.order - b.order);
      if (merged.length) {
        const table = {
          type: "table",
          source: "ase",
          headers: ["Swatch", "Name", "HEX", "RGB", "CMYK", "Pantone"],
          rows: merged.map((e) => {
            const hex = toHex(e.rgb);
            const cmykText = e.cmyk ? e.cmyk.map((v) => Math.round(v * 100)).join(", ") : "";
            return [
              `<span class="swatch-dot" style="background:${hex}"></span>`,
              e.name,
              hex,
              e.rgb.join(", "),
              cmykText,
              "",
            ];
          }),
        };
        if (!Array.isArray(page.body)) page.body = [];
        const existingIdx = page.body.findIndex((b) => b.type === "table" && b.source === "ase");
        if (existingIdx >= 0) page.body[existingIdx] = table;
        else page.body.push(table);
        pagesUpdated++;
        console.log(`  color palette: ${category.slug}/${page.slug} -> ${merged.length} swatch(es)`);
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
