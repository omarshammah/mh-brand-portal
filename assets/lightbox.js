// Click-to-enlarge for every content photo. Any <img> inside a
// .content-figure (see the "image" block type in build.js) opens the same
// shared overlay (#lightbox-overlay, injected on every page by
// lightboxHtml() in build.js) at full size. Closes via the (X) button,
// clicking anywhere outside the enlarged photo, or Escape.
(function () {
  var overlay = document.getElementById("lightbox-overlay");
  var overlayImg = document.getElementById("lightbox-img");
  var closeBtn = document.getElementById("lightbox-close");
  if (!overlay || !overlayImg || !closeBtn) return;

  function openLightbox(src, alt) {
    overlayImg.src = src;
    overlayImg.alt = alt || "";
    overlayImg.classList.remove("is-zoomed"); // always opens at the fitted size
    overlayImg.style.transformOrigin = "center center";
    overlay.classList.add("is-open");
    document.body.classList.add("lightbox-locked");
  }

  function closeLightbox() {
    overlay.classList.remove("is-open");
    document.body.classList.remove("lightbox-locked");
    overlayImg.classList.remove("is-zoomed");
    overlayImg.src = "";
  }

  // 1st click on the enlarged photo zooms further in, centered on exactly
  // where it was clicked (via transform-origin, set from the click position
  // just before the zoom class is applied); 2nd click zooms back out to the
  // fitted size. Stops propagation so it never reaches the overlay's own
  // click-to-close handler below.
  overlayImg.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!overlayImg.classList.contains("is-zoomed")) {
      var rect = overlayImg.getBoundingClientRect();
      var originX = ((e.clientX - rect.left) / rect.width) * 100;
      var originY = ((e.clientY - rect.top) / rect.height) * 100;
      overlayImg.style.transformOrigin = originX + "% " + originY + "%";
    }
    overlayImg.classList.toggle("is-zoomed");
  });

  document.querySelectorAll(".content-figure img").forEach(function (img) {
    img.addEventListener("click", function () {
      openLightbox(img.currentSrc || img.src, img.alt);
    });
  });

  closeBtn.addEventListener("click", closeLightbox);

  // Clicking the dimmed backdrop (anywhere that isn't the enlarged photo
  // or the close button itself) closes the overlay.
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeLightbox();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) closeLightbox();
  });
})();
