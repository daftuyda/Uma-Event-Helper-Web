(function () {
  const DEFAULT_ROUTES = [
    { label: "Events", path: "/", file: "/index.html" },
    { label: "Support Hints", path: "/hints", file: "/hints.html" },
    { label: "Umadle", path: "/umadle", file: "/umadle.html" },
    { label: "Randomizer", path: "/random", file: "/random.html" },
    { label: "Optimizer", path: "/optimizer", file: "/optimizer.html" },
  ];
  const ROUTES =
    Array.isArray(window.NAV_ROUTES) && window.NAV_ROUTES.length
      ? window.NAV_ROUTES
      : DEFAULT_ROUTES;

  // Footer links: override per-page with window.FOOTER_LINKS if you want
  const DEFAULT_FOOTER = [
    {
      label: "GitHub",
      href: "https://github.com/daftuyda/Uma-Event-Helper-Web",
    },
    { label: "YouTube", href: "https://youtube.com/@MaybeVoid" },
  ];
  const FOOTER =
    Array.isArray(window.FOOTER_LINKS) && window.FOOTER_LINKS.length
      ? window.FOOTER_LINKS
      : DEFAULT_FOOTER;

  // Build navbar element (not in DOM yet)
  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.innerHTML = `
    <div class="nav-inner">
      <div class="nav-left">
        <a class="brand" href="/" aria-label="Uma Tools Home">UmaTools</a>
        <button class="menu-btn" aria-label="Menu" aria-expanded="false">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <div class="nav-links" role="navigation" aria-label="Primary"></div>
      </div>
      <div class="nav-right">
        <div id="navModeToggleSlot"></div>
      </div>
    </div>
  `;

  // Safe to reference the element we just created
  const navEl = nav;
  const linksWrap = nav.querySelector(".nav-links");
  const menuBtn = nav.querySelector(".menu-btn");

  // Toggle dropdown on mobile
  menuBtn.addEventListener("click", () => {
    const open = navEl.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });

  // Close menu when a link is chosen
  linksWrap.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link")) {
      navEl.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Inject everything after DOM is ready
  document.addEventListener("DOMContentLoaded", () => {
    // Put navbar at top
    document.body.prepend(nav);

    // Build links
    const links = ROUTES.map((route) => {
      const a = document.createElement("a");
      a.className = "nav-link";
      a.textContent = route.label;
      a.href = route.path || route.file || "#";
      if (route.file) a.dataset.file = route.file;
      if (route.path) a.dataset.clean = route.path;
      linksWrap.appendChild(a);
      return a;
    });

    // Mark active route
    const here = location.pathname.replace(/\/+$/, "") || "/";
    const norm = (s) => (s || "").replace(/\/+$/, "") || "/";
    ROUTES.forEach((r, i) => {
      if (here === norm(r.path) || here === norm(r.file))
        links[i].classList.add("active");
    });

    // Prefer clean URLs, fall back to .html if needed
    const test = ROUTES.find((r) => r.path && r.file && r.path !== "/");
    if (test) {
      fetch(test.path, { method: "HEAD" })
        .then((res) => {
          if (!res.ok) throw 0;
        })
        .catch(() => {
          links.forEach((a) => {
            if (a.dataset.file) a.href = a.dataset.file;
          });
        });
    }

    // Move existing dark-mode toggle into navbar (if present)
    const slot = nav.querySelector("#navModeToggleSlot");
    const toggle = document.getElementById("modeToggleBtn");
    if (toggle && slot) {
      slot.appendChild(toggle);
      toggle.classList.add("in-nav");
    }

    // Footer at bottom
    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML = `
      <span>Made with ❤️</span>
      ${FOOTER.map(
        (l) =>
          `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${l.label}</a>`
      ).join("")}
    `;
    document.body.appendChild(footer);
  });

  // Close menu if switching to desktop width
  window.addEventListener("resize", () => {
    if (window.innerWidth > 640 && navEl.classList.contains("open")) {
      navEl.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    }
  });
})();
