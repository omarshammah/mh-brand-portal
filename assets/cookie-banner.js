// Cookie notice banner. This site only ever sets one cookie (the password
// gate's mh_gate cookie), which is strictly necessary under § 25 Abs. 2
// Nr. 2 TTDSG and therefore doesn't legally require consent — so this is a
// transparency notice with an acknowledge button, not an accept/reject
// choice (there's nothing optional here to decline). Dismissal is
// remembered in localStorage, not a second cookie.
(function () {
  var DISMISS_KEY = "mh_cookie_notice_dismissed";
  if (localStorage.getItem(DISMISS_KEY) === "1") return;

  // "rel" (the path back to the site root, e.g. "../../") is passed in via
  // this script tag's data-rel attribute — see lightboxHtml()/cookieBannerHtml()
  // in build.js — so the cookie-policy link works from any page depth.
  var rel = (document.currentScript && document.currentScript.dataset.rel) || "";

  var banner = document.createElement("div");
  banner.className = "cookie-banner";
  banner.innerHTML =
    '<p>Diese Website verwendet ausschließlich ein technisch notwendiges Cookie für den Passwortschutz. ' +
    'Weitere Informationen in der <a href="' + rel + 'cookie-policy/index.html">Cookie-Erklärung</a>.</p>' +
    '<button type="button" class="cookie-banner-ok">Verstanden</button>';
  document.body.appendChild(banner);

  banner.querySelector(".cookie-banner-ok").addEventListener("click", function () {
    localStorage.setItem(DISMISS_KEY, "1");
    banner.remove();
  });
})();
