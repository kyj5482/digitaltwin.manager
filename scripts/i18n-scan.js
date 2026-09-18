#!/usr/bin/env node
/* AI/Data North Pole — 이중 언어(ko/en) 번역 스캐너·적용기
   /translate 스킬이 사용하는 결정적(deterministic) 도구. 번역 자체는 하지 않는다.

   사용법:
     node scripts/i18n-scan.js --list          # 데이터 저장소에서 미번역·낡은 번역 항목을 JSON으로 출력
     node scripts/i18n-scan.js --apply <file>  # 번역 결과 JSON을 각 티켓 파일의 rec.i18n에 병합
     node scripts/i18n-scan.js --ui            # UI 소스의 한글 문자열 중 사전에 없는 후보 출력
     node scripts/i18n-scan.js --docs          # 영어본이 없거나 원문보다 오래된 문서 목록 출력

   원문 언어는 텍스트의 한글 포함 여부로 판별한다 (한글 있음→ko, 없음→en).
   번역은 rec.i18n[<대상 언어>][field]에, 번역 시점의 원문은 rec.i18n[..]._src[field]에 저장
   — 원문이 바뀌면 _src 불일치로 "낡은 번역(stale)"으로 다시 나온다. */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const store = require(path.join(ROOT, "store.js"));   // 계층 티켓 파일 저장소
const DB_PATH = path.join(ROOT, "data", "db.json");   // 구버전 단일 파일 (폴백)
const HANGUL = /[ㄱ-힝]/;

// server.js의 TR_FIELDS와 동일해야 한다 (번역 대상 필드의 단일 기준)
const TR_FIELDS = {
  products: { key: "name", fields: ["goal", "kpi"], nested: { ms: { key: "code", fields: ["name"] }, history: { key: null, fields: ["why", "before"] } } },
  projects: { key: "id", fields: ["name"] },
  sprints:  { key: "id", fields: ["retro"] },
  tasks:    { key: "id", fields: ["title", "deliverable"], nested: { logs: { key: null, fields: ["text"] } } },
  requests: { key: "id", fields: ["title", "note", "requester"], nested: { logs: { key: null, fields: ["text"] } } },
};

const langOf = s => (HANGUL.test(s) ? "ko" : "en");
const otherOf = l => (l === "ko" ? "en" : "ko");

function* items(db) {
  for (const [col, spec] of Object.entries(TR_FIELDS)) {
    for (let i = 0; i < (db[col] || []).length; i++) {
      const rec = db[col][i];
      const key = spec.key ? rec[spec.key] : i;
      yield { col, key, rec, fields: spec.fields };
      for (const [nk, nspec] of Object.entries(spec.nested || {})) {
        for (let j = 0; j < (rec[nk] || []).length; j++) {
          const nrec = rec[nk][j];
          yield { col, key, nested: nk, nkey: nspec.key ? nrec[nspec.key] : j, rec: nrec, fields: nspec.fields };
        }
      }
    }
  }
}
function findRec(db, it) {
  const spec = TR_FIELDS[it.col];
  const arr = db[it.col] || [];
  const rec = spec.key ? arr.find(r => String(r[spec.key]) === String(it.key)) : arr[it.key];
  if (!rec || !it.nested) return rec;
  const nspec = spec.nested[it.nested];
  const narr = rec[it.nested] || [];
  return nspec.key ? narr.find(r => String(r[nspec.key]) === String(it.nkey)) : narr[it.nkey];
}

function listMissing(db) {
  const out = [];
  for (const it of items(db)) {
    for (const f of it.fields) {
      const src = it.rec[f];
      if (typeof src !== "string" || !src.trim()) continue;
      const from = langOf(src), to = otherOf(from);
      const tr = it.rec.i18n && it.rec.i18n[to];
      const done = tr && tr[f] != null && tr._src && tr._src[f] === src;
      if (!done) out.push({ col: it.col, key: it.key, nested: it.nested, nkey: it.nkey,
                            field: f, from, to, src,
                            stale: !!(tr && tr[f] != null) });
    }
  }
  return out;
}

function apply(db, translations) {
  let ok = 0, skipped = 0;
  for (const t of translations) {
    const rec = findRec(db, t);
    if (!rec) { console.error(`skip (레코드 없음): ${t.col}/${t.key}${t.nested ? "/" + t.nested + "/" + t.nkey : ""}.${t.field}`); skipped++; continue; }
    if (rec[t.field] !== t.src) { console.error(`skip (원문 변경됨): ${t.col}/${t.key}.${t.field}`); skipped++; continue; }
    if (typeof t.text !== "string" || !t.text.trim()) { console.error(`skip (번역문 없음): ${t.col}/${t.key}.${t.field}`); skipped++; continue; }
    rec.i18n = rec.i18n || {};
    rec.i18n[t.to] = rec.i18n[t.to] || {};
    rec.i18n[t.to][t.field] = t.text;
    (rec.i18n[t.to]._src = rec.i18n[t.to]._src || {})[t.field] = t.src;
    ok++;
  }
  return { ok, skipped };
}

function uiCandidates() {
  const dict = require(path.join(ROOT, "public", "assets", "i18n-dict.js"));
  const covered = s => {
    const k = s.trim();
    if (!k || !HANGUL.test(k)) return true;
    if (dict.exact[k] != null) return true;
    return dict.patterns.some(([re]) => re.test(k));
  };
  const files = ["public/index.html", "public/products.html", "public/projects.html",
                 "public/sprint.html", "public/requests.html", "public/assets/app.js"];
  const found = new Set();
  for (const f of files) {
    const srcTxt = fs.readFileSync(path.join(ROOT, f), "utf8");
    const add = raw => {
      // 템플릿 보간(${..})과 태그 경계로 쪼개 정적 조각만 검사
      for (const piece of String(raw).split(/\$\{[^}]*\}/))
        for (const frag of piece.replace(/<[^>]*>/g, "\n").split("\n")) {
          const k = frag.trim().replace(/\s+/g, " ");
          if (k && HANGUL.test(k) && !covered(k)) found.add(`${f}: ${k}`);
        }
    };
    let js = srcTxt;
    if (f.endsWith(".html")) {
      const markup = srcTxt.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
      for (const m of markup.matchAll(/>([^<]*[ㄱ-힝][^<]*)</g)) add(m[1]);
      for (const m of markup.matchAll(/(?:placeholder|title)="([^"]*[ㄱ-힝][^"]*)"/g)) add(m[1]);
      js = [...srcTxt.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
    }
    js = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "");  // 주석 제거 (러프)
    for (const m of js.matchAll(/"([^"\n\\]*[ㄱ-힝][^"\n\\]*)"|'([^'\n\\]*[ㄱ-힝][^'\n\\]*)'/g)) add(m[1] || m[2]);
    for (const m of js.matchAll(/`([^`]*[ㄱ-힝][^`]*)`/g)) add(m[1]);
  }
  return [...found];
}

function docsStatus() {
  const pairs = [["README.md", "README.en.md"]];
  for (const f of fs.readdirSync(path.join(ROOT, "docs")).filter(f => f.endsWith(".md")))
    pairs.push([`docs/${f}`, `docs/en/${f}`]);
  const out = [];
  for (const [src, dst] of pairs) {
    const sp = path.join(ROOT, src), dp = path.join(ROOT, dst);
    if (!fs.existsSync(sp) || sp.includes(`${path.sep}en${path.sep}`)) continue;
    if (!HANGUL.test(fs.readFileSync(sp, "utf8"))) continue;
    if (!fs.existsSync(dp)) out.push({ src, en: dst, status: "missing" });
    else if (fs.statSync(sp).mtimeMs > fs.statSync(dp).mtimeMs) out.push({ src, en: dst, status: "outdated" });
  }
  return out;
}

const mode = process.argv[2];
const legacy = !store.load() && fs.existsSync(DB_PATH);
const db = legacy ? JSON.parse(fs.readFileSync(DB_PATH, "utf8")) : store.load();
if (mode === "--list") {
  console.log(JSON.stringify(listMissing(db), null, 2));
} else if (mode === "--apply") {
  const translations = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const r = apply(db, translations);
  if (legacy) fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  else store.save(db);
  console.log(`적용 ${r.ok}건 · 건너뜀 ${r.skipped}건 → ${legacy ? DB_PATH : store.DATA}`);
} else if (mode === "--ui") {
  console.log(JSON.stringify(uiCandidates(), null, 2));
} else if (mode === "--docs") {
  console.log(JSON.stringify(docsStatus(), null, 2));
} else {
  console.log("사용법: node scripts/i18n-scan.js --list | --apply <번역.json> | --ui | --docs");
  process.exit(1);
}
