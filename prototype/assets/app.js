/* AI/Data North Pole 프로토타입 공용 스크립트
   - 사이드바 렌더 + 활성 메뉴 표시
   - 라이트/다크 토글
   - 차트 바 호버 툴팁
   - 모달 열기/닫기 */

(function () {
  // ---------- 사이드바 ----------
  const MENUS = [
    { href: "index.html",       ico: "◎", label: "대시보드 (North Pole)" },
    { href: "products.html",    ico: "▣", label: "Product & Goal" },
    { href: "projects.html",    ico: "≡", label: "프로젝트" },
    { href: "sprint.html",      ico: "▤", label: "스프린트 보드" },
    { href: "requests.html",    ico: "✉", label: "요청 Intake" },
  ];
  const here = location.pathname.split("/").pop() || "index.html";
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    const menuActive = (h) =>
      h === here || (here === "task-detail.html" && h === "sprint.html");
    sidebar.innerHTML = `
      <div class="brand"><span class="logo">DT</span> Digital Twin Manager</div>
      <nav class="nav">
        <div class="nav-group">
          <div class="nav-title">기존 서비스 메뉴 (예시)</div>
          <a class="nav-item placeholder" href="javascript:void(0)"><span class="ico">□</span> 트윈 대시보드</a>
          <a class="nav-item placeholder" href="javascript:void(0)"><span class="ico">□</span> 자산 · 모델 관리</a>
          <a class="nav-item placeholder" href="javascript:void(0)"><span class="ico">□</span> 시뮬레이션</a>
        </div>
        <div class="nav-group">
          <div class="nav-title">AI/Data North Pole — 신규</div>
          ${MENUS.map(
            (m) =>
              `<a class="nav-item ${menuActive(m.href) ? "active" : ""}" href="${m.href}">
                 <span class="ico">${m.ico}</span> ${m.label}</a>`
          ).join("")}
        </div>
      </nav>
      <div class="nav-note">본 화면은 검토용 HTML 프로토타입입니다.
      실제 구현 시 기존 서비스의 세부 메뉴로 편입되며, 상단 회색 메뉴는 위치를 보여주기 위한 예시입니다.</div>`;
  }

  // ---------- 테마 토글 ----------
  const saved = localStorage.getItem("northpole-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  window.toggleTheme = function () {
    const root = document.documentElement;
    const cur =
      root.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("northpole-theme", next);
  };

  // ---------- 차트 툴팁 ----------
  const tip = document.createElement("div");
  tip.className = "viz-tip";
  document.body.appendChild(tip);
  document.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.style.display = "none"; return; }
    const [title, sub] = t.getAttribute("data-tip").split("|");
    tip.innerHTML =
      `<div class="t-title">${title}</div>` +
      (sub ? `<div class="t-sub">${sub}</div>` : "");
    tip.style.display = "block";
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  });

  // ---------- 페이지네이션 ----------
  // el: 컨테이너, total: 필터 적용 후 전체 건수, page/size: 현재 상태, onGo(p): 페이지 이동 콜백
  window.renderPager = function (el, total, page, size, onGo) {
    const pages = Math.max(1, Math.ceil(total / size));
    page = Math.min(Math.max(1, page), pages);
    const from = total === 0 ? 0 : (page - 1) * size + 1;
    const to = Math.min(total, page * size);
    let html = `<span class="small muted">총 ${total.toLocaleString()}건 중 ${from}–${to} 표시</span>
      <div class="pages">
        <button class="page-btn" ${page === 1 ? "disabled" : ""} data-p="${page - 1}">‹ 이전</button>`;
    const nums = [...new Set([1, pages, page - 1, page, page + 1])]
      .filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    let last = 0;
    nums.forEach((n) => {
      if (n - last > 1) html += `<span class="muted small" style="padding:0 2px">…</span>`;
      html += `<button class="page-btn ${n === page ? "active" : ""}" data-p="${n}">${n}</button>`;
      last = n;
    });
    html += `<button class="page-btn" ${page === pages ? "disabled" : ""} data-p="${page + 1}">다음 ›</button>
      </div>`;
    el.innerHTML = html;
    el.querySelectorAll("button[data-p]").forEach((b) =>
      b.addEventListener("click", () => onGo(parseInt(b.dataset.p, 10)))
    );
  };

  // ---------- 모달 ----------
  window.openModal = (id) => document.getElementById(id).classList.add("open");
  window.closeModal = (id) => document.getElementById(id).classList.remove("open");
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-scrim")) e.target.classList.remove("open");
  });
})();
