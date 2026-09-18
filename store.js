/* AI/Data North Pole — 계층 티켓 파일 저장소 (의존성 0)
   하나의 db.json 대신 티켓 1건 = 파일 1개로 저장한다. 계층 구조가 곧 디렉터리 구조:

     data/
       meta.json                          시퀀스·스키마 버전 (ID 채번의 단일 기준)
       products/<부문명>.json             Product — Goal·마일스톤·변경 이력 포함
       kpis/<코드>.json                   KPI — 하위 지표(subs) 트리 포함
       projects/PRJ-###/
         project.json                     Project (kpi·kpiRole·impacts 연결)
         sprints/S-##.json                Sprint (프로젝트 하위)
         tasks/DT-###.json                Task   (프로젝트 하위)
       requests/REQ-YYYY-###.json         Request Intake
       files/                             첨부파일 (레코드의 files[]가 참조)

   서버(server.js)와 스캐너(scripts/i18n-scan.js)가 공유하며, 메모리에서는 기존과
   동일한 db 객체({meta, products, kpis, projects, sprints, tasks, requests})로 다룬다.
   변경 없는 파일은 다시 쓰지 않고, db에서 사라진 레코드의 파일은 삭제한다(git 친화).

   ⚠ 서버가 떠 있는 동안 파일을 직접 고치면 서버 메모리가 그 위를 덮어쓴다.
     서버 실행 중엔 API로만 쓰고, 파일 직접 편집은 서버를 내린 상태에서만. */
"use strict";
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "data");
const COLS = ["products", "kpis", "projects", "sprints", "tasks", "requests"];
const pad = (n, w) => String(n).padStart(w, "0");
const safe = s => String(s).replace(/[/\\:*?"<>|]/g, "_");
const prjDir = id => `projects/PRJ-${pad(id, 3)}`;

const relOf = {
  products: (p, i) => `products/${safe(p.name)}.json`,
  kpis:     k => `kpis/${safe(k.code)}.json`,
  requests: r => `requests/${safe(r.id)}.json`,
  projects: p => `${prjDir(p.id)}/project.json`,
  sprints:  s => `${prjDir(s.projectId)}/sprints/S-${pad(s.no, 2)}.json`,
  tasks:    t => `${prjDir(t.projectId)}/tasks/${safe(t.id)}.json`,
};

function writeJson(file, obj) {
  const s = JSON.stringify(obj, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === s) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s);
}
function* walkJson(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkJson(p);
    else if (e.name.endsWith(".json")) yield p;
  }
}

/* 저장 — 전 컬렉션을 파일 트리로 직렬화하고, 없어진 레코드의 파일은 지운다.
   products·kpis는 배열 순서(화면 표시 순서)를 order 필드로 보존한다. */
function save(db) {
  const expected = new Set([path.join(DATA, "meta.json")]);
  writeJson(path.join(DATA, "meta.json"), db.meta);
  for (const col of COLS) {
    (db[col] || []).forEach((rec, i) => {
      const file = path.join(DATA, relOf[col](rec, i));
      expected.add(file);
      writeJson(file, (col === "products" || col === "kpis") ? { ...rec, order: i } : rec);
    });
  }
  for (const top of ["products", "kpis", "projects", "requests"])
    for (const f of [...walkJson(path.join(DATA, top))])
      if (!expected.has(f)) fs.unlinkSync(f);
  // 빈 프로젝트 디렉터리 정리
  const pdir = path.join(DATA, "projects");
  if (fs.existsSync(pdir))
    for (const d of fs.readdirSync(pdir)) {
      const full = path.join(pdir, d);
      for (const sub of ["sprints", "tasks"]) {
        const s = path.join(full, sub);
        if (fs.existsSync(s) && !fs.readdirSync(s).length) fs.rmdirSync(s);
      }
      if (fs.statSync(full).isDirectory() && !fs.readdirSync(full).length) fs.rmdirSync(full);
    }
}

/* 로드 — 파일 트리를 db 객체로 조립. 트리가 없으면(meta.json 부재) null. */
function load() {
  const metaFile = path.join(DATA, "meta.json");
  if (!fs.existsSync(metaFile)) return null;
  const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
  const dirJson = d => [...walkJson(path.join(DATA, d))].map(read);
  const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9);
  const numId = v => +String(v).replace(/\D/g, "") || 0;
  const db = {
    meta: read(metaFile),
    products: dirJson("products").sort(byOrder),
    kpis: dirJson("kpis").sort(byOrder),
    requests: dirJson("requests").sort((a, b) => String(a.id).localeCompare(String(b.id))),
    projects: [], sprints: [], tasks: [],
  };
  const pdir = path.join(DATA, "projects");
  if (fs.existsSync(pdir))
    for (const d of fs.readdirSync(pdir).sort()) {
      const base = path.join(pdir, d);
      if (!fs.statSync(base).isDirectory()) continue;
      const pj = path.join(base, "project.json");
      if (fs.existsSync(pj)) db.projects.push(read(pj));
      for (const f of [...walkJson(path.join(base, "sprints"))]) db.sprints.push(read(f));
      for (const f of [...walkJson(path.join(base, "tasks"))]) db.tasks.push(read(f));
    }
  db.projects.sort((a, b) => a.id - b.id);
  db.sprints.sort((a, b) => a.projectId - b.projectId || a.no - b.no);
  db.tasks.sort((a, b) => numId(a.id) - numId(b.id));
  return db;
}

module.exports = { load, save, DATA };
