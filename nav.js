(function () {
  const DEFAULT_ROUTES = [
    { label: "Events", path: "/", file: "/index.html" },
    { label: "Support Hints", path: "/hints", file: "/hints.html" },
  ];
  const ROUTES =
    Array.isArray(window.NAV_ROUTES) && window.NAV_ROUTES.length
      ? window.NAV_ROUTES
      : DEFAULT_ROUTES;

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.innerHTML = `
    <div class="nav-inner">
      <div class="nav-left">
        <a class="brand" href="/" aria-label="Uma Tools Home">Uma Tools</a>
        <div class="nav-links" role="navigation" aria-label="Primary"></div>
      </div>
      <div class="nav-right">
        <div id="navModeToggleSlot"></div>
      </div>
    </div>
  `;

  document.addEventListener("DOMContentLoaded", () => {
    document.body.prepend(nav);

    const linksWrap = nav.querySelector(".nav-links");
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

    // Move existing dark-mode toggle into navbar and reset absolute positioning
    const slot = nav.querySelector("#navModeToggleSlot");
    const toggle = document.getElementById("modeToggleBtn");
    if (toggle && slot) {
      slot.appendChild(toggle);
      toggle.classList.add("in-nav");
    }
  });
})();
