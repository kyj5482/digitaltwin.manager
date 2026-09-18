/* AI/Data North Pole — i18n 런타임 (ko/en)
   - UI 문자열: i18n-dict.js 사전으로 텍스트 노드·속성을 표시 시점에 번역 (원문은 한국어)
   - 데이터: api()가 lang을 서버에 전달하면 서버가 레코드의 i18n 번역본으로 치환해 응답
   - 언어 전환 시 저장 후 새로고침 (데이터·화면 모두 새 언어로 재로드)
   - 미번역 문자열은 한국어로 그대로 표시됨 — /translate 스킬이 사전·데이터 번역을 채움 */
(function () {
  let lang = "ko";
  try { lang = localStorage.getItem("northpole-lang") || "ko"; } catch (_) {}
  window.NP_LANG = lang;
  document.documentElement.lang = lang;

  window.toggleLang = function () {
    try { localStorage.setItem("northpole-lang", lang === "ko" ? "en" : "ko"); } catch (_) {}
    location.reload();
  };

  const D = window.NP_DICT || { exact: {}, patterns: [] };
  const HANGUL = /[ㄱ-힝]/;

  function trStr(s) {
    if (lang !== "en" || !s || !HANGUL.test(s)) return s;
    const key = String(s).trim();
    if (!key) return s;
    if (D.exact[key] != null) return s.replace(key, D.exact[key]);
    for (const [re, rep] of D.patterns) {
      const m = key.match(re);
      if (m) return s.replace(key, typeof rep === "function" ? rep(m) : key.replace(re, rep));
    }
    return s;
  }
  window.NP_T = trStr;

  // 언어 토글 버튼 (테마 버튼 옆) — 버튼 라벨은 전환될 언어를 표시
  function attachToggle() {
    const theme = document.querySelector(".topbar .theme-toggle");
    if (!theme || document.getElementById("lang-toggle")) return;
    theme.insertAdjacentHTML("beforebegin",
      `<button class="theme-toggle" id="lang-toggle" onclick="toggleLang()">${lang === "en" ? "한국어" : "English"}</button>`);
  }

  if (lang !== "en") {
    document.addEventListener("DOMContentLoaded", attachToggle);
    return;                                      // 한국어 모드: 번역 불필요
  }

  /* ── 영어 모드: DOM 번역 ── */
  const ATTRS = ["placeholder", "title", "alt"];

  function trText(node) {
    const cur = node.data;
    if (node.__npw === cur) return;              // 우리가 쓴 값 그대로면 스킵
    const out = trStr(cur);
    if (out !== cur) { node.__npw = out; node.data = out; }
  }
  function trAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && HANGUL.test(v)) {
        const out = trStr(v);
        if (out !== v) el.setAttribute(a, out);
      }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return trText(root);
    if (root.nodeType !== 1) return;
    trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? trText(n) : trAttrs(n);
  }
  function trTitle() {
    document.title = document.title.split(" — ").map(part => trStr(part)).join(" — ");
  }

  // alert/confirm/prompt 메시지 번역 (검증 메시지, 서버 오류 포함)
  const _alert = window.alert, _confirm = window.confirm, _prompt = window.prompt;
  window.alert = m => _alert(trStr(m));
  window.confirm = m => _confirm(trStr(m));
  window.prompt = (m, d) => _prompt(trStr(m), d);

  document.addEventListener("DOMContentLoaded", () => {
    walk(document.body);
    trTitle();
    new MutationObserver(muts => {
      for (const mu of muts) {
        if (mu.type === "characterData") trText(mu.target);
        else if (mu.type === "attributes") trAttrs(mu.target);
        else for (const n of mu.addedNodes) walk(n);
      }
    }).observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
    attachToggle();
  });
})();
