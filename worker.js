// Password gate in front of the whole static site. Runs on every request
// (see wrangler.jsonc's "run_worker_first": true — without that flag,
// Cloudflare serves matching static files directly and this script never
// runs at all, since every real page here IS a static file in dist/).
//
// To change the password: edit PASSWORD below and redeploy (push to GitHub,
// Cloudflare rebuilds/redeploys automatically). Anyone with a valid cookie
// (set for 30 days on success) skips straight through to the real site.
const PASSWORD = "MH-123";
const COOKIE_NAME = "mh_gate";

// A small allowlist of static files the gate page itself needs (so the
// login screen isn't unstyled) — these are served straight from dist/
// without requiring auth. Nothing else in the site is reachable without it.
const PUBLIC_PATHS = new Set([
  "/assets/style.css",
  "/assets/images/logo.svg",
  "/assets/fonts/NeueCampton-Regular.woff2",
  "/assets/fonts/NeueCampton-Light.woff2",
  "/assets/lightbox.js",
  "/assets/cookie-banner.js",
]);

// Imprint/Datenschutz/Cookie-Erklärung must stay reachable WITHOUT the
// password — German Impressumspflicht (§5 DDG) requires these to be
// accessible to any visitor, not just ones who already have the password.
// Both the directory URL and its index.html are allowed since either form
// could be requested.
const PUBLIC_PAGES = new Set([
  "/imprint/",
  "/imprint/index.html",
  "/privacy-policy/",
  "/privacy-policy/index.html",
  "/cookie-policy/",
  "/cookie-policy/index.html",
]);

async function tokenFor(password) {
  const bytes = new TextEncoder().encode("mh-brand-portal-gate:" + password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function gatePage({ error = false, redirectTo = "/" } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>MH Brand Portal — Access</title>
<link rel="stylesheet" href="/assets/style.css" />
<style>
  html, body { height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  .gate-box { text-align: center; max-width: 340px; padding: 40px 24px; }
  .gate-box img { width: 56px; margin-bottom: 24px; }
  .gate-box h1 { font-size: 20px; margin: 0 0 8px 0; text-transform: none; color: var(--text); }
  .gate-box p { font-size: 14px; color: var(--muted); margin: 0 0 24px 0; }
  .gate-box input[type="password"] {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid #BEBEBE;
    border-radius: 8px;
    font-size: 15px;
    font-family: inherit;
    margin-bottom: 14px;
    box-sizing: border-box;
  }
  .gate-box button {
    width: 100%;
    padding: 12px 14px;
    border: none;
    border-radius: 100vw;
    background: var(--text);
    color: #fff;
    font-size: 15px;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .gate-box button:hover { opacity: 0.85; }
  .gate-error { color: #C0392B; font-size: 13px; margin: -8px 0 14px 0; }
  .gate-legal { margin-top: 24px; display: flex; justify-content: center; gap: 16px; }
  .gate-legal a { font-size: 12px; color: var(--muted); text-decoration: underline; }
</style>
</head>
<body>
  <div class="gate-box">
    <img src="/assets/images/logo.svg" alt="Logo" />
    <h1>This portal is private</h1>
    <p>Enter the access password to continue.</p>
    <form method="POST" action="/gate-auth">
      <input type="hidden" name="redirect" value="${escapeHtml(redirectTo)}" />
      ${error ? `<div class="gate-error">Incorrect password — try again.</div>` : ""}
      <input type="password" name="password" placeholder="Password" autofocus required />
      <button type="submit">Enter</button>
    </form>
    <div class="gate-legal">
      <a href="/imprint/index.html">Impressum</a>
      <a href="/privacy-policy/index.html">Datenschutz</a>
      <a href="/cookie-policy/index.html">Cookies</a>
    </div>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (PUBLIC_PATHS.has(url.pathname) || PUBLIC_PAGES.has(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const validToken = await tokenFor(PASSWORD);
    const cookieHeader = request.headers.get("Cookie") || "";
    const cookieMatch = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([a-f0-9]{64})`));
    const authed = !!cookieMatch && cookieMatch[1] === validToken;

    if (url.pathname === "/gate-auth" && request.method === "POST") {
      const form = await request.formData();
      const submitted = String(form.get("password") || "");
      const redirectTo = String(form.get("redirect") || "/");
      if (submitted === PASSWORD) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: redirectTo,
            "Set-Cookie": `${COOKIE_NAME}=${validToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          },
        });
      }
      return new Response(gatePage({ error: true, redirectTo }), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }

    if (!authed) {
      return new Response(gatePage({ error: false, redirectTo: url.pathname + url.search }), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
