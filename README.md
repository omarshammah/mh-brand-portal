# Brand Portal — reusable client template

A free, static Frontify-style brand portal: top navbar (Brand, Brand Guidelines, Stationery,
Editorial Templates, Video Templates), left sidebar per section, downloadable templates on
relevant pages. Built as flat HTML/CSS from a small JSON "CMS" so it costs nothing to host
and nothing to clone for the next client.

## Preview locally

Just double-click `dist/index.html` — it opens directly in your browser (no server needed,
since the site uses relative links throughout).

If you edit `data/*.json` and want to regenerate `dist/`:

```
cd site-project
node build.js
```

(Optional, only if you prefer serving it over localhost instead of file://:
`cd dist && python3 -m http.server 8000`, then open `http://localhost:8000`.)

## Edit content

Everything lives in three files under `data/`:

- `brand.config.json` — site name, client name, logo text, colors, font.
- `categories.json` — the 5 navbar tabs.
- `pages.json` — the 23 sidebar subpages: title, summary, a `body` array of content blocks,
  and an optional `downloads` array.

Edit those, then re-run `node build.js`. No dependencies to install.

### Navbar logos (studio + client)

The navbar shows the studio logo (`assets/images/logo.svg`) next to a dashed
placeholder box that reads "Client Logo". Once you have the client's actual
logo file:

1. Drop it in as `assets/images/client-logo.svg` (or `.png`).
2. In `build.js`, inside `navHtml()`, replace the `<div class="client-logo-placeholder">Client Logo</div>`
   line with `<img src="${rel}assets/images/client-logo.svg" alt="Client logo" class="navbar-logo" />`.
3. Re-run `node build.js`.

### Content blocks (text, tables, images, embedded slides)

Each page's `body` is a list of blocks. Mix and match any of these:

```json
{ "type": "p", "text": "A normal paragraph." }
{ "type": "placeholder", "text": "Shows with a yellow left border, for TODO notes." }
{ "type": "h2", "text": "A subheading" }
{ "type": "list", "items": ["First point", "Second point"] }
{ "type": "table", "headers": ["Name", "Hex"], "rows": [["Navy", "#1F2A44"], ["Blue", "#3B5BFE"]] }
{ "type": "image", "src": "../../assets/images/logo-clearspace.png", "alt": "Clearspace diagram", "caption": "Minimum clearspace" }
{ "type": "embed", "src": "https://docs.google.com/presentation/d/XXXX/embed", "title": "Brand deck" }
```

`color-palette` and `typography` already have a working `table` and `list` example — open
those two entries in `data/pages.json` to see the exact shape.

**Images**: drop image files into `assets/images/` (create the folder if it doesn't exist) —
`node build.js` copies it into `dist/assets/images/` automatically. Reference them from a
page with `../../assets/images/yourfile.png`.

**Slides**: for an inline-viewable deck, publish it in Google Slides (File → Share →
Publish to web → Embed) and use that embed URL as the `embed` block's `src`. For a
downloadable deck instead (or as well), add it to `downloads` like any other file.

### Downloadable files

Two ways to attach a file to a page's `downloads` array, by size:

- **Small files (a few MB — most PDFs, single AI/INDD files)**: put them straight in
  `assets/downloads/` in this project (create the folder), and set `"url"` to something
  like `"../../assets/downloads/business-card-template.pdf"`. Self-contained, no external
  account needed, and it deploys along with everything else.
- **Large files (AEP/Premiere projects with footage, big PSDs)**: host them on Google
  Drive instead — upload, right-click → Share → set to "Anyone with the link," and paste
  that link into `"url"`. Keeps the deployed site itself small and fast.

Either way, `downloads` items currently point at `"url": "#"` placeholders — replace those
as real files come in.

## Import content from a project folder

Instead of hand-editing `pages.json`, you can lay out a client's content as plain files and
folders and let `import-content.js` convert it. This is the fast path once a project has
real material — the folder mirrors the site's own structure, so filling it in is mostly
"drop the file in the right place."

Three levels deep: navbar category, then subcategory (the sidebar page itself), then that
page's own files:

```
Brand-Portal/
  logo.svg                       <- optional: replaces the site logo
  brand/                         <- 1st level: navlink category
    who-we-are/                  <- 2nd level: subcategory / sidebar page
      who-we-are.md              <- 3rd level: becomes the "Who We Are" page body
      content/                   <- 3rd level: photos/videos referenced from the .md
      download/                  <- 3rd level: any files here become that page's downloads
    mission-and-vision/
      mission-and-vision.md
      content/
      download/
    ...
  brand-guidelines/
    logo-system/
      logo-system.md
      content/
        logo-clearspace.png      <- referenced from logo-system.md as ![Clearspace diagram](logo-clearspace.png)
      download/
        Print.pdf
        Digital.zip
    color-palette/
      color-palette.md
      content/
      download/
        Brand-Colors.ase        <- drop an Adobe Swatch Exchange file here and its
                                    swatches auto-build the page's color table
    ...
  stationery/
    business-cards/
      business-cards.md
      content/
      download/
        business-card-template.pdf
    ...
  editorial-templates/
  video-templates/
```

Folder names must match the category and page slugs already in `data/categories.json` /
`data/pages.json` (e.g. `brand-guidelines/logo-system/`, not `Brand Guidelines/Logo System/`).
The `.md` file's own name matches its containing folder. Run:

```
node import-content.js /path/to/Brand-Portal
node build.js
```

What the markdown supports: plain paragraphs, `## ` subheadings, `- ` bullet lists, pipe
tables (`| A | B |`), and `![alt](image.png)` — the image file should sit in that page's own
`content/` folder and gets copied into `assets/images/` automatically. (Video files can live
in `content/` too, but aren't auto-embedded into the page yet — link them as a download
instead, or use an `embed` block in `pages.json` for a hosted video URL.)

**Color palette from an .ase file**: drop an Adobe Swatch Exchange (`.ase`) file straight into
a page's `download/` folder (works on any page, but this is built for Color Palette) and the
importer reads every swatch out of it — RGB, CMYK, LAB, and grayscale colors are all
converted to HEX/RGB — and builds a Swatch/Name/HEX/RGB table on that page automatically, no
manual table-writing needed. The `.ase` file also stays downloadable as-is. Re-running the
importer with an updated `.ase` regenerates that table in place rather than duplicating it,
so it's safe to swap in a revised swatch file at any time.

A subfolder inside `download/` (rather than a loose file) is treated as one asset kit and
zipped into a single download — e.g. `download/logo/` containing dozens of format/variant
files becomes one "Logo.zip" button instead of dozens of individual ones. Requires the
system `zip` command (present by default on macOS and most Linux setups).

Three safety rules make this repeatable as a project fills in over time: a page's body is
only replaced if you've provided a matching `.md` file (pages without one keep their current
content), a page's downloads are only replaced if its `download/` folder has files in it, and
a color table built from an `.ase` file only replaces a table that was itself built the same
way — a hand-written table you added directly in `pages.json` won't be touched.
Running the importer again later, once more material exists, only touches what's new.

## Deploy for free, on your own account (with a real custom domain)

Since you want to host this yourself rather than through a third party: Cloudflare Pages
and Netlify both let *you* create the account and keep full control — nobody else manages
it for you, it's just that the servers are theirs rather than yours. That's the right
trade-off here: this is a static site, so a self-managed VPS (Linode, DigitalOcean, your
own hardware) would only add work — you'd be renewing TLS certificates and patching a
server yourself for zero benefit over a free static host. If you specifically want that
route anyway (e.g. you already run a server for other things), say so and I'll walk through
it — but for this project Cloudflare Pages is the better default.

**Cloudflare Pages** (recommended):
1. Create a free Cloudflare account at [pages.cloudflare.com](https://pages.cloudflare.com).
2. Create a new Pages project → "Upload assets" → drag in the `dist/` folder. Live URL in
   under a minute.
3. Add your own domain under the project's Custom domains tab — free, with automatic HTTPS.
4. To redeploy after edits: re-run `node build.js`, then re-upload `dist/` (or connect a
   GitHub repo instead, so pushing to the repo auto-deploys).

**Netlify** (equally good alternative):
1. [app.netlify.com/drop](https://app.netlify.com/drop) — drag `dist/` in for an instant
   throwaway URL, no account needed.
2. For a permanent site, create a free account, keep using drag-and-drop deploys or connect
   a GitHub repo, and add a custom domain under Site settings → Domain management (free).

## Replicate for a new client

Copy this whole `site-project` folder, rename it, then:

1. Edit `data/brand.config.json` — new client name, logo text, and brand colors (the CSS
   reads these directly, so the whole site re-themes from one file).
2. Edit `data/categories.json` / `data/pages.json` if the nav structure needs to change for
   that client.
3. `node build.js`, then deploy as a new (also free) Netlify/Cloudflare Pages site.

## Optional: move content editing to a spreadsheet

Right now content lives in local JSON files, which someone technical needs to edit. To make
it spreadsheet-editable instead:

1. Create a Google Sheet with a "Categories" tab and a "Pages" tab, using the same column
   names as the keys in `categories.json` / `pages.json`.
2. File → Share → Publish to web → publish each tab as CSV, and copy the two CSV URLs.
3. In `build.js`, replace the `fs.readFileSync(...json)` calls in `loadData()` with a fetch
   of those CSV URLs and a CSV-to-JSON parse (e.g. the `papaparse` package).

That's the only file that needs to change — everything else (templates, styling, page
generation) stays exactly the same.
