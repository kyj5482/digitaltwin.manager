/* AI/Data North Pole 공용 스크립트 — 사이드바 · 테마 · 모달 · API 헬퍼 · git 상태 칩 */
(function () {
  const MENUS = [
    { href: "index.html", ico: "◎", label: "대시보드" },
    { href: "kpi.html", ico: "✪", label: "KPI 모니터링" },
    { href: "products.html", ico: "▣", label: "Product & Goal" },
    { href: "projects.html", ico: "≡", label: "프로젝트" },
    { href: "sprint.html", ico: "▤", label: "스프린트 보드" },
    { href: "requests.html", ico: "✉", label: "요청 Intake" },
  ];
  const here = location.pathname.split("/").pop() || "index.html";
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand"><img class="logo" src="assets/logo.svg" alt="AI/Data North Pole 로고">
        <span class="brand-text"><span class="brand-sub">AI/Data</span>
        <span class="brand-name">North Pole</span></span></div>
      <nav class="nav"><div class="nav-group">
        <div class="nav-title">데이터 의사결정</div>
        ${MENUS.map(m => `<a class="nav-item ${m.href === here ? "active" : ""}" href="${m.href}">
          <span class="ico">${m.ico}</span> ${m.label}</a>`).join("")}
      </div></nav>
      <div class="nav-note" id="git-chip">git 상태 확인 중…</div>`;
  }

  // 테마
  try {
    const saved = localStorage.getItem("northpole-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  } catch (_) {}
  window.toggleTheme = function () {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("northpole-theme", next); } catch (_) {}
  };

  // 모달
  window.openModal = id => document.getElementById(id).classList.add("open");
  window.closeModal = id => document.getElementById(id).classList.remove("open");
  document.addEventListener("click", e => {
    if (e.target.classList.contains("modal-scrim")) e.target.classList.remove("open");
  });

  // API 헬퍼 — POST는 body, GET은 그대로
  // 상대 경로 사용: 프록시 하위 경로(/devenv/…/proxy/8787/)로 서빙될 때도 동작해야 함
  window.api = async function (path, body) {
    const lang = window.NP_LANG || "ko";       // GET: 응답 번역용 · POST: 편집 원문 판별용
    const url = "api/" + path + (path.includes("?") ? "&" : "?") + "lang=" + lang;
    const res = await fetch(url, body === undefined
      ? undefined
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, _lang: lang }) });
    const j = await res.json();
    if (!res.ok) { alert(j.error || "요청 실패"); throw new Error(j.error); }
    return j;
  };

  // 첨부파일 공통 (FR-540)
  window.fileRows = function (files) {
    return (files || []).map(f => `<div class="file-row"><span class="f-ico">📄</span>
      <a href="files/${encodeURIComponent(f.path)}">${f.name}</a>
      <span class="f-meta">${Math.max(1, Math.round(f.size / 1024))}KB · ${(f.at || "").slice(5, 10)}</span></div>`).join("") ||
      '<span class="muted small">첨부 없음</span>';
  };
  window.readFileB64 = function (file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result.split(",")[1]);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  };

  // 페이저 (FR-004a) — go: 페이지 이동 함수명, go(page[, size]) 형태로 호출됨
  window.renderPager = function (el, total, page, size, go) {
    const pages = Math.max(1, Math.ceil(total / size));
    const a = total ? (page - 1) * size + 1 : 0, b = Math.min(total, page * size);
    const items = []; let gap = false;
    for (let i = 1; i <= pages; i++) {
      if (pages > 9 && i !== 1 && i !== pages && Math.abs(i - page) > 1) {
        if (!gap) { items.push("<span>…</span>"); gap = true; }
        continue;
      }
      gap = false;
      items.push(`<button class="${i === page ? "cur" : ""}" onclick="${go}(${i})">${i}</button>`);
    }
    el.innerHTML = `<span class="info">총 ${total}건 중 ${a}–${b} 표시</span>
      <button ${page <= 1 ? "disabled" : ""} onclick="${go}(${page - 1})">‹ 이전</button>${items.join("")}
      <button ${page >= pages ? "disabled" : ""} onclick="${go}(${page + 1})">다음 ›</button>
      <select class="input" onchange="${go}(1, +this.value)">${[10, 25, 50].map(n =>
        `<option value="${n}" ${n === size ? "selected" : ""}>${n}건씩</option>`).join("")}</select>`;
  };

  // git 자동 커밋 상태 칩 (사이드바 하단)
  window.refreshGitChip = async function () {
    const el = document.getElementById("git-chip");
    if (!el) return;
    try {
      const g = await window.api("git/status");
      el.innerHTML =
        `<b>git</b> ${g.branch} · 리모트 ${g.remotes.length ? g.remotes.join(", ") : "없음"}<br>` +
        `${g.dirty ? `데이터 변경 ${g.changes}건 대기` : "변경 없음"} · 매일 ${g.config?.time || "-"} 자동 커밋<br>` +
        `최근: ${g.lastLog || "커밋 없음"}<br>` +
        `<a href="javascript:void(0)" onclick="commitNow()">지금 커밋·푸시 실행</a>`;
    } catch (_) { el.textContent = "git 상태를 가져오지 못했습니다."; }
  };
  window.commitNow = async function () {
    const r = await window.api("git/commit", {});
    alert(r.result);
    refreshGitChip();
    return r;
  };

  if (sidebar) refreshGitChip();   // 정의가 끝난 뒤 호출
})();
