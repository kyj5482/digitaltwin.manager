/* AI/Data North Pole — 실행형 서비스 (의존성 0, Node 18+)
   - 정적 화면(public/) + JSON API + 계층 티켓 파일 저장소(store.js — 티켓 1건 = 파일 1개)
   - 매일 지정 시각에 데이터 변경분 자동 git commit → 설정된 모든 리모트(GitHub/GitLab)로 push
   실행: node server.js  ·  즉시 커밋: node server.js --commit-now */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const store = require("./store");

const ROOT = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const DB_PATH = path.join(ROOT, "data", "db.json");   // 구버전 단일 파일 (1회 마이그레이션 원천)
const STAGES = ["Intake 협의", "데이터 준비", "EDA", "모델링", "파이프라인", "서비스 개발"];

/* ═══════════ 저장소 — 계층 티켓 파일 트리(store.js), 구버전 db.json은 최초 1회 이관 ═══════════ */
let db;
function loadDb() {
  db = store.load();
  const fromLegacy = !db && fs.existsSync(DB_PATH);
  if (fromLegacy) db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (db) {
    // 구버전 db 마이그레이션 — 요청 Intake 필드
    if (!db.requests) { db.requests = seedRequests(); db.meta.reqSeq = 42; saveDb(); }
    // 구버전 db 마이그레이션 — 전사 KPI (FR-7xx): 영역(재무/사업/지속경영) 소속 전사 지표.
    // 부문(Product) 소속이던 v1 구조화 KPI는 전사 KPI로 승격하고 프로젝트 연결 코드를 재매핑한다.
    if (!db.kpis) {
      const collected = [];
      for (const p of db.products) for (const k of (p.kpis || [])) collected.push({ dept: p.name, k });
      if (collected.length) {
        db.kpis = [];
        const map = {};                       // "부문|구코드" → 새 전사 코드
        let n = 0;
        for (const area of KPI_AREAS) {
          for (const c of collected.filter(x => (KPI_AREA_MIGRATE[x.k.name] || "사업") === area)) {
            const code = "K" + (++n);
            map[c.dept + "|" + c.k.code] = code;
            db.kpis.push({ ...c.k, code, area });
          }
        }
        for (const prj of db.projects) prj.kpi = map[prj.dept + "|" + prj.kpi] || "";
      } else {
        db.kpis = seedKpis();
        for (const prj of db.projects) if (prj.kpi === undefined) prj.kpi = SEED_PRJ_KPI[prj.id] || "";
      }
      for (const p of db.products) delete p.kpis;
      saveDb();
    }
    // v3 — KPI 트리(하위 지표)·데이터 연동 소스·기여 유형: 지표는 시스템 수집 데이터와
    // 연동되는 것이 원칙이며, 미연동 지표는 "데이터 연동 프로젝트"가 필수로 이어져야 한다.
    if ((db.meta.kpiSchema || 2) < 3) {
      for (const k of db.kpis) {
        if (k.source === undefined) {
          const src = KPI_SRC_MIGRATE[k.name];
          k.source = src ? src[0] : "";
          if (src && k.i18n && k.i18n.en) {
            k.i18n.en.source = src[1];
            (k.i18n.en._src = k.i18n.en._src || {}).source = src[0];
          }
        }
        if (!k.subs) k.subs = [];
      }
      if (!db.kpis.some(k => k.name === "고객만족")) {
        const n = db.kpis.reduce((m, k) => Math.max(m, +String(k.code).slice(1) || 0), 0) + 1;
        db.kpis.push(seedCsatKpi("K" + n));
      }
      for (const p of db.projects) if (p.kpiRole === undefined) p.kpiRole = p.kpi ? "개선" : "";
      // 예시 데이터 연동 프로젝트 — 미연동 지표(즉시 예약 가능률)를 시스템 데이터와 연결
      const csat = db.kpis.find(k => k.name === "고객만족");
      if (csat && !db.projects.some(p => p.kpiRole === "연동")) {
        const id = ++db.meta.projectSeq;
        db.projects.push({ id, name: "정비 예약 시스템 데이터 연동", dept: "Service", ms: "M1",
                           kpi: csat.code + "-3", kpiRole: "연동", owner: "최현우", prio: "P1",
                           status: "진행중", start: "2026-09-01", end: "2026-11-27",
                           i18n: { en: { name: "Service booking system data integration",
                                         _src: { name: "정비 예약 시스템 데이터 연동" } } } });
        db.sprints.push(nextSprint(id));
      }
      db.meta.kpiSchema = 3;
      saveDb();
    }
    if (migrateKpiV4() | migrateKpiV5() | migrateKpiV6() | migrateKpiV7()) saveDb();
    if (fromLegacy) {
      saveDb();
      fs.renameSync(DB_PATH, DB_PATH + ".migrated");
      console.log("[store] data/db.json → 계층 티켓 파일 트리 마이그레이션 완료 (원본 보존: data/db.json.migrated)");
    }
    return;
  }
  db = seed();
  migrateKpiV4();
  migrateKpiV5();
  migrateKpiV6();
  migrateKpiV7();
  saveDb();
}

/* v4 — KPI 상충 관계(사이드 이펙트): 지표 개선 액션이 다른 지표를 희생시킬 수 있다
   (예: OTA 확대 → 품질 개선이지만 네트워크 비용으로 이익 감소, 캠페인 → 예약 가능률·이익 하락).
   프로젝트가 impacts[]로 영향을 선언하고, 영향받는 지표는 상충 감시(가드레일) 대상이 된다. */
function migrateKpiV4() {
  if ((db.meta.kpiSchema || 0) >= 4) return false;
  for (const p of db.projects) if (!p.impacts) p.impacts = [];
  // 재무 이익 지표 — 상충 판단의 공통 기준
  let profit = db.kpis.find(k => k.name === "영업이익률");
  if (!profit) {
    const n = db.kpis.reduce((m, k) => Math.max(m, +String(k.code).slice(1) || 0), 0) + 1;
    profit = trKpi({ code: "K" + n, area: "재무", name: "영업이익률", unit: "%", direction: "+",
      target: 8, weight: 3, source: "손익(P&L) 마감 리포트",
      measures: [{ at: "2026-07-31", value: 7.1 }, { at: "2026-08-31", value: 7.4 }, { at: "2026-09-10", value: 7.2 }] },
      "Operating profit margin", "P&L closing report");
    db.kpis.push(profit);
  }
  // 예시 — 상충을 선언한 개선 프로젝트 2건
  const csat = db.kpis.find(k => k.name === "고객만족");
  const trN = (ko, en) => ({ i18n: { en: { note: en, _src: { note: ko } } } });
  if (csat && !db.projects.some(p => (p.impacts || []).length)) {
    const dtc = csat.code + "-2", booking = csat.code + "-3", rating = csat.code + "-5";
    const ex = [
      { name: "커넥티드카 OTA 품질 개선 확대", en: "Connected-car OTA quality improvement expansion",
        dept: "Service", ms: "M1", kpi: dtc, status: "진행중", owner: "최현우", start: "2026-08-24", end: "2026-12-18",
        impacts: [{ kpi: profit.code, effect: "-", note: "OTA 횟수 증가 → 모바일 네트워크 비용 증가",
                    ...trN("OTA 횟수 증가 → 모바일 네트워크 비용 증가", "More OTA updates → higher mobile network cost") }] },
      { name: "고객케어 서비스 캠페인", en: "Customer-care service campaign",
        dept: "Marketing", ms: "M1", kpi: rating, status: "계획", owner: "이서연", start: "2026-10-05", end: "2026-12-04",
        impacts: [{ kpi: booking, effect: "-", note: "캠페인 입고 물량이 일반 수리 예약 슬롯 점유",
                    ...trN("캠페인 입고 물량이 일반 수리 예약 슬롯 점유", "Campaign inflow occupies regular repair booking slots") },
                  { kpi: profit.code, effect: "-", note: "캠페인 비용과 무상 점검으로 이익 감소",
                    ...trN("캠페인 비용과 무상 점검으로 이익 감소", "Campaign cost and free inspections reduce profit") }] },
    ];
    for (const e of ex) {
      const id = ++db.meta.projectSeq;
      db.projects.push({ id, name: e.name, dept: e.dept, ms: e.ms, kpi: e.kpi, kpiRole: "개선",
                         owner: e.owner, prio: "P1", status: e.status, start: e.start, end: e.end,
                         impacts: e.impacts,
                         i18n: { en: { name: e.en, _src: { name: e.name } } } });
      if (e.status === "진행중") db.sprints.push(nextSprint(id));
    }
  }
  db.meta.kpiSchema = 4;
  return true;
}

/* v5 — 트윈(digitaltwin.retail.vehicle)의 실질 KPI 트리 이식.
   정본: ~/workspace/digitaltwin.retail.vehicle/data/governance/ceo_tree.csv
   (영역 가중치 재무 37/사업 35/지속경영 25 = 산하 KPI weight 합, 코드는 트윈 node_id 유지).
   bind(실측 바인딩)가 있는 지표는 연동(source에 바인딩 키 표기), 없는 지표는 미연동 —
   트윈의 "bind 빈값 = 데이터 수집 프로젝트 신설 대상" 규약 그대로. 이 KPI들을 기반으로
   하위 프로젝트가 생성·연결된다. lever는 트윈 전략 시뮬레이션 레버 키(참조용 보존). */
function seedTwinKpis() {
  const M = (v7, v8, v9) => [v7 != null && { at: "2026-07-31", value: v7 },
                             v8 != null && { at: "2026-08-31", value: v8 },
                             v9 != null && { at: "2026-09-10", value: v9 }].filter(Boolean);
  const mk = (rec, en) => {
    const tr = { name: en, _src: { name: rec.name } };
    if (rec.bind) {
      rec.source = `트윈 실측 바인딩 '${rec.bind}' — digitaltwin.retail.vehicle`;
      tr.source = `Twin data binding '${rec.bind}' — digitaltwin.retail.vehicle`;
      tr._src.source = rec.source;
    } else rec.source = "";
    delete rec.bind;
    return { target: null, measures: [], subs: [], ...rec, i18n: { en: tr } };
  };
  // 하위 노드: [code, group, name, en, unit, dir, bind, target, measures] — 폴더(오피스 관리비)는 group으로 평탄화
  const nodes = {
    "KPI-ASP": [
      ["ND-ASP-MIX", "", "트림 믹스 프리미엄", "Trim mix premium", "$", "+", "mixprem"],
      ["ND-ASP-INC", "", "대당 인센티브", "Incentive per unit", "$", "-", "incunit", 1800, M(2050, 1980, 1920)],
      ["ND-ASP-FX", "", "환율 영향", "FX impact", "$", "~", ""],
    ],
    "KPI-RECUR": [
      ["ND-ENERGY", "오피스 관리비", "전력사용량", "Energy usage", "$", "-", "energy", 42000, M(46000, 44800, 44100), "hvac"],
      ["ND-LEASE", "오피스 관리비", "임차·시설", "Lease & facilities", "$", "-", "lease"],
      ["ND-SUPPLY", "오피스 관리비", "소모품·기타", "Supplies & misc", "$", "-", ""],
      ["ND-PARTS", "", "Parts 손익", "Parts P&L", "k$", "+", "parts"],
      ["ND-LOGI", "", "물류·운송비", "Logistics & freight", "$", "-", "freight"],
      ["ND-FINCOST", "", "금융 비용", "Financing cost", "$", "-", ""],
    ],
    "KPI-COMB": [
      ["ND-OP", "", "영업이익 (판매법인)", "Operating profit (sales company)", "$", "+", "op"],
      ["ND-CAPTIVE", "", "금융법인 손익 (캡티브)", "Captive finance P&L", "$", "+", "captive"],
    ],
    "KPI-COMBR": [["ND-REV", "", "도매 매출", "Wholesale revenue", "$", "+", "rev"]],
    "KPI-WS": [
      ["ND-ORD", "", "월 생산 주문", "Monthly production orders", "대", "+", "ord"],
      ["ND-DS", "", "재고 일수 (DS)", "Days of supply (DS)", "일", "~", "ds", 60, M(75, 68, 64)],
      ["ND-PIPE", "", "해상 파이프라인", "Ocean pipeline", "대", "~", ""],
    ],
    "KPI-SUV": [
      ["ND-TRN", "", "Terron 소매 (대형 SUV)", "Terron retail (full-size SUV)", "대", "+", "m_TRN"],
      ["ND-VST", "", "Vista 소매 (중형 SUV)", "Vista retail (mid-size SUV)", "대", "+", "m_VST"],
      ["ND-SUVINC", "", "SUV 인센티브 효율", "SUV incentive efficiency", "$", "-", "suvinc"],
    ],
    "KPI-SHARE": [
      ["ND-IND", "", "산업 수요 (SAAR)", "Industry demand (SAAR)", "대", "~", "industry"],
      ["ND-COMP", "", "경쟁사 런칭 모니터링", "Competitor launch monitoring", "건", "~", ""],
    ],
    "KPI-EV": [
      ["ND-AUR", "", "Aurora EV 소매", "Aurora EV retail", "대", "+", "m_AUR"],
      ["ND-LUM", "", "Lumen EV 소매", "Lumen EV retail", "대", "+", "m_LUM"],
      ["ND-CHG", "", "충전 인프라 파트너십", "Charging infrastructure partnerships", "건", "+", ""],
    ],
    "KPI-GREEN": [["ND-GREEN-AD", "", "광고 환경 표기 심의", "Green ad claim review", "건", "-", ""]],
    "KPI-FSI": [["ND-FSI-DLR", "", "딜러 SI 2.0 적용률", "Dealer SI 2.0 adoption", "%", "+", ""]],
    "KPI-CSIS": [
      ["ND-VOC", "", "VoC·클레임 발생률", "VoC/claim rate", "/1k", "-", "voc", 0.5, M(0.8, 0.6, 0.55)],
      ["ND-CAMP", "", "품질 캠페인 커버리지", "Quality campaign coverage", "%", "+", "camp"],
    ],
    "KPI-CSIP": [
      ["ND-DLV", "", "인도 리드타임 지수", "Delivery lead-time index", "점", "+", "csidlv"],
      ["ND-DEXP", "", "딜러 구매 경험", "Dealer purchase experience", "점", "+", ""],
    ],
    "KPI-SEC": [
      ["ND-SECP", "", "차량 SW 보안 패치", "Vehicle SW security patching", "%", "+", ""],
      ["ND-SECIT", "", "IT 침해 시도 대응", "IT intrusion response", "건", "-", ""],
    ],
    "KPI-BRAND": [
      ["ND-ADST", "", "광고 인지 잔존 (adstock)", "Ad awareness (adstock)", "점", "+", "adstock"],
      ["ND-SOC", "", "소셜 감성 지수", "Social sentiment index", "점", "+", ""],
    ],
  };
  // KPI: [code, area, name, en, unit, dir, weight, bind, target, measures]
  const kpis = [
    ["KPI-ASP", "재무", "ASP (인센티브 차감 후)", "ASP (net of incentives)", "$", "+", 5, "asp", 32000, M(30800, 31200, 31450)],
    ["KPI-RECUR", "재무", "경상이익률", "Recurring profit margin", "%", "+", 5, "recur", 8, M(7.1, 7.4, 7.2)],
    ["KPI-COMB", "재무", "합산손익", "Combined P&L", "M$", "+", 12, "comb", 128, M(118, 122, 121)],
    ["KPI-COMBR", "재무", "합산손익률", "Combined P&L margin", "%", "+", 15, "combr", 9, M(8.2, 8.6, 8.5)],
    ["KPI-WS", "사업", "도매판매량", "Wholesale volume", "대", "+", 10, "ws", 52000, M(47000, 50100, 49800)],
    ["KPI-SUV", "사업", "볼륨 SUV 육성 (소매)", "Volume SUV growth (retail)", "대", "+", 10, "suv", 18000, M(15200, 16900, 17400)],
    ["KPI-SHARE", "사업", "시장점유율", "Market share", "%", "+", 10, "share", 9, M(8.4, 8.6, 8.7)],
    ["KPI-EV", "사업", "친환경 소매판매량 (소매)", "EV retail sales", "대", "+", 5, "ev", 6000, M(4800, 5300, 5600)],
    ["KPI-GREEN", "지속경영", "그린워싱", "Greenwashing", "건", "-", 5, ""],
    ["KPI-FSI", "지속경영", "Full SI 2.0", "Full SI 2.0", "%", "+", 5, "", 100],
    ["KPI-CSIS", "지속경영", "고객만족도 (서비스)", "Customer satisfaction (service)", "점", "+", 3.5, "csisvc", 90, M(86.5, 87.2, 87.8)],
    ["KPI-CSIP", "지속경영", "고객만족도 (판매)", "Customer satisfaction (sales)", "점", "+", 3.5, "csidlv", 90, M(88.1, 88.6, 89.0)],
    ["KPI-SEC", "지속경영", "보안", "Security", "건", "-", 3, ""],
    ["KPI-BRAND", "지속경영", "브랜드트래커", "Brand tracker", "점", "+", 5, "brand", 75, M(71, 72.5, 73.4)],
  ];
  return kpis.map(([code, area, name, en, unit, direction, weight, bind, target, measures]) =>
    mk({ code, area, name, unit, direction, weight, bind, target: target ?? null, measures: measures || [],
         subs: (nodes[code] || []).map(([c, group, n2, en2, u2, d2, b2, t2, m2, lever]) =>
           mk({ code: c, group, name: n2, unit: u2, direction: d2, weight: 1, bind: b2,
                target: t2 ?? null, measures: m2 || [], ...(lever ? { lever } : {}) }, en2)) }, en));
}
function migrateKpiV5() {
  if ((db.meta.kpiSchema || 0) >= 5) return false;
  const twin = seedTwinKpis();
  // 기존 지표 이관: K9 영업이익률 → KPI-RECUR 경상이익률, K8 고객만족 하위 지표 → KPI-CSIS 밑으로 병합
  const k9 = db.kpis.find(k => k.code === "K9");
  const recur = twin.find(k => k.code === "KPI-RECUR");
  if (k9 && (k9.measures || []).length) recur.measures = k9.measures;
  const k8 = db.kpis.find(k => k.name === "고객만족");
  const csis = twin.find(k => k.code === "KPI-CSIS");
  if (k8) csis.subs.push(...(k8.subs || []));
  const remap = c => c === "K9" ? "KPI-RECUR" : (k8 && c === k8.code ? "KPI-CSIS" : c);
  for (const p of db.projects) {
    p.kpi = remap(p.kpi || "");
    for (const i of (p.impacts || [])) i.kpi = remap(i.kpi);
  }
  // K1~K7(AI/Data 과제 지표)은 유지, K8·K9는 트윈 지표로 흡수
  db.kpis = [...db.kpis.filter(k => k !== k8 && k !== k9), ...twin];
  db.meta.kpiSeq = 9;              // 수동 추가 KPI는 K10부터 채번
  db.meta.kpiSchema = 5;
  return true;
}

/* v6 — AI/Data 과제 지표(K1~K7)를 실질 KPI 하위로 매칭.
   KPI를 열면 그 아래에서 과제 지표와 활동(프로젝트→스프린트→태스크)이 바로 확인된다.
   코드는 유지되므로 프로젝트 링크·측정 이력은 그대로 보존된다. */
const V6_PARENT = {
  K1: ["KPI-RECUR", "재무 운영"],    // 월 결산 소요일 → 경상이익률
  K2: ["KPI-WS", "수요 예측"],       // 분기 수주 예측 오차 → 도매판매량
  K3: ["KPI-SHARE", "영업 전환"],    // 리드 스코어링 적용률 → 시장점유율
  K4: ["KPI-BRAND", "마케팅 효율"],  // 캠페인 ROI 측정 커버리지 → 브랜드트래커
  K5: ["KPI-BRAND", "마케팅 효율"],  // 세그먼트 기반 캠페인 비중 → 브랜드트래커
  K6: ["KPI-CSIS", "서비스"],        // AS 접수 자동 분류 정확도 → 고객만족도(서비스)
  K7: ["KPI-CSIS", "서비스"],        // VOC 리포트 주간 자동 발행률 → 고객만족도(서비스)
};
function migrateKpiV6() {
  if ((db.meta.kpiSchema || 0) >= 6) return false;
  for (const [code, [parent, group]] of Object.entries(V6_PARENT)) {
    const i = db.kpis.findIndex(k => k.code === code);
    const pk = db.kpis.find(k => k.code === parent);
    if (i < 0 || !pk) continue;
    const k = db.kpis.splice(i, 1)[0];
    delete k.area; delete k.subs;
    k.group = group;
    (pk.subs = pk.subs || []).push(k);
  }
  db.meta.kpiSchema = 6;
  return true;
}

/* v7 — 미국 자동차 판매법인 BP 기반: 외부 발표 점수(J.D. Power CSI/SSI 등)를 내부에서
   측정 가능한 드라이버 지표로 분해하고, 실무 프로젝트(BP 사례)를 발굴·수치화해 연결.
   근거: J.D. Power CSI(서비스)·SSI(판매) 드라이버, NADA 서비스 리텐션·Fixed Ops,
   NHTSA 리콜 완료율 캠페인, Cox Automotive 리드 응답 연구(15분 내 응답 BP).
   상세 카탈로그: docs/08-kpi-bp-catalog.md. 미연결 프로젝트 4건도 지표에 매칭. */
function migrateKpiV7() {
  if ((db.meta.kpiSchema || 0) >= 7) return false;
  const csis = db.kpis.find(k => k.code === "KPI-CSIS");
  const csip = db.kpis.find(k => k.code === "KPI-CSIP");
  if (csis && !csis.subs.some(s => s.code === "KPI-CSIS-1")) {
    // J.D. Power CSI(서비스) 내부 드라이버 — 우리가 직접 Measure·개선 가능한 형태
    csis.subs.push(
      trKpi({ code: "KPI-CSIS-1", group: "서비스", name: "FRFT 일발 수리율", unit: "%", direction: "+",
        target: 90, weight: 2, source: "", measures: [] },
        "Fix Right First Time (FRFT) rate"),
      trKpi({ code: "KPI-CSIS-2", group: "서비스", name: "서비스 리텐션율 (보증기간 내 재방문)", unit: "%", direction: "+",
        target: 55, weight: 1, source: "", measures: [] },
        "Service retention rate (in-warranty return)"),
      trKpi({ code: "KPI-CSIS-3", group: "품질", name: "오픈 리콜 완료율", unit: "%", direction: "+",
        target: 75, weight: 1, source: "리콜 관리 시스템 (오픈 리콜 대상 DB)",
        measures: [{ at: "2026-07-31", value: 58 }, { at: "2026-08-31", value: 61 }, { at: "2026-09-10", value: 63 }] },
        "Open recall completion rate", "Recall management system (open-recall database)"),
    );
    // J.D. Power SSI(판매) 내부 드라이버
    csip.subs.push(
      trKpi({ code: "KPI-CSIP-1", group: "", name: "인터넷 리드 응답 시간", unit: "분", direction: "-",
        target: 15, weight: 2, source: "", measures: [] },
        "Internet lead response time"),
      trKpi({ code: "KPI-CSIP-2", group: "", name: "시승 전환율", unit: "%", direction: "+",
        target: 35, weight: 1, source: "CRM 시승 스케줄러",
        measures: [{ at: "2026-08-31", value: 24 }, { at: "2026-09-10", value: 26 }] },
        "Test-drive conversion rate", "CRM test-drive scheduler"),
    );
  }
  // 미연결 프로젝트 매칭 — 모든 프로젝트는 기여 KPI에서 출발
  const relink = { 16: ["ND-ORD", "개선"], 12: ["K5", "개선"], 21: ["ND-VOC", "연동"], 22: ["ND-ASP-FX", "연동"] };
  for (const [pid, [kpi, role]] of Object.entries(relink)) {
    const p = db.projects.find(x => x.id === +pid);
    if (p && !p.kpi) { p.kpi = kpi; p.kpiRole = role; }
  }
  // BP 프로젝트 시드 — 판매법인이 실제로 수행하는 업무 (연동/개선 짝 구성)
  const trN = (ko, en) => ({ note: ko, i18n: { en: { note: en, _src: { note: ko } } } });
  const seedPrj = [
    { name: "딜러 DMS 정비 오더(RO) 데이터 연동", en: "Dealer DMS repair-order (RO) data integration",
      dept: "Service", kpi: "KPI-CSIS-1", role: "연동", status: "진행중", owner: "최현우",
      start: "2026-09-07", end: "2026-12-11",
      tasks: [["딜러 DMS RO 스키마 분석·필드 매핑", "Dealer DMS RO schema analysis & field mapping", 1, "2026-09-18",
               "RO 필드 매핑 정의서", "RO field-mapping spec"],
              ["RO 일배치 적재 파이프라인 구축", "Daily RO ingestion pipeline", 4, "2026-09-25",
               "일배치 적재 파이프라인 (FRFT·리텐션 산출)", "Daily ingestion pipeline (feeds FRFT & retention)"]] },
    { name: "FRFT 일발 수리 개선 (부품 사전 준비·기술 핫라인)", en: "FRFT improvement (parts pre-pull & tech hotline)",
      dept: "Service", kpi: "KPI-CSIS-1", role: "개선", status: "계획", owner: "최현우",
      start: "2026-10-12", end: "2027-02-26" },
    { name: "서비스 리텐션 케어 프로그램 (정비 리마인더·선불 정비 패키지)", en: "Service retention care program (maintenance reminders & prepaid packages)",
      dept: "Marketing", kpi: "KPI-CSIS-2", role: "개선", status: "계획", owner: "이서연",
      start: "2026-10-19", end: "2027-03-26",
      impacts: [{ kpi: "KPI-RECUR", effect: "-", ...trN("무상 점검·쿠폰 프로모션 비용으로 단기 이익 감소",
                  "Free inspections and coupon promotions reduce short-term profit") }] },
    { name: "미조치 리콜 아웃리치 캠페인 (오픈 리콜 완료율 제고)", en: "Open-recall outreach campaign",
      dept: "Service", kpi: "KPI-CSIS-3", role: "개선", status: "진행중", owner: "최현우",
      start: "2026-08-31", end: "2026-12-18",
      impacts: [{ kpi: "K8-3", effect: "-", ...trN("리콜 입고 물량이 일반 정비 예약 슬롯 점유",
                  "Recall inflow occupies regular service booking slots") }],
      tasks: [["오픈 리콜 대상 차량·고객 명단 정제", "Refine open-recall vehicle & owner list", 1, "2026-09-19",
               "발송 대상 명단 (중복·폐차 제외)", "Outreach list (deduped, scrapped vehicles excluded)"],
              ["1차 아웃리치 발송(SMS·우편) 및 응답 추적", "First outreach wave (SMS/mail) with response tracking", 5, "2026-09-25",
               "발송 결과·입고 전환 리포트", "Send results & service-visit conversion report"]] },
    { name: "인터넷 리드 15분 응답 체계 (CRM 라우팅·딜러 SLA)", en: "15-minute internet lead response (CRM routing & dealer SLA)",
      dept: "Sales", kpi: "KPI-CSIP-1", role: "개선", status: "계획", owner: "김유진",
      start: "2026-10-05", end: "2027-01-29" },
    { name: "CRM 리드 퍼널 데이터 연동", en: "CRM lead-funnel data integration",
      dept: "Sales", kpi: "KPI-CSIP-1", role: "연동", status: "진행중", owner: "김유진",
      start: "2026-09-14", end: "2026-11-20" },
    { name: "온라인 시승 예약 퍼널 최적화", en: "Online test-drive booking funnel optimization",
      dept: "Sales", kpi: "KPI-CSIP-2", role: "개선", status: "계획", owner: "김유진",
      start: "2026-10-26", end: "2027-02-19" },
    { name: "인센티브 지출 최적화 (모델·지역 탄력성 분석)", en: "Incentive spend optimization (model/region elasticity)",
      dept: "Finance", kpi: "ND-ASP-INC", role: "개선", status: "계획", owner: "박민수",
      start: "2026-10-12", end: "2027-01-15",
      impacts: [{ kpi: "KPI-SHARE", effect: "-", ...trN("인센티브 축소 시 단기 판매·점유율 하락 위험",
                  "Cutting incentives risks short-term sales and share decline") }] },
    { name: "딜러 재고 리밸런싱 (재고 일수 DS 최적화)", en: "Dealer inventory rebalancing (days-of-supply optimization)",
      dept: "Sales", kpi: "ND-DS", role: "개선", status: "계획", owner: "김유진",
      start: "2026-11-02", end: "2027-02-12" },
  ];
  if (!db.projects.some(p => p.kpi === "KPI-CSIS-1")) {
    for (const e of seedPrj) {
      const id = ++db.meta.projectSeq;
      db.projects.push({ id, name: e.name, dept: e.dept, ms: "M1", kpi: e.kpi, kpiRole: e.role,
                         owner: e.owner, prio: "P1", status: e.status, start: e.start, end: e.end,
                         impacts: e.impacts || [],
                         i18n: { en: { name: e.en, _src: { name: e.name } } } });
      if (e.status === "진행중") {
        const sp = nextSprint(id);
        sp.status = "active"; sp.start = "2026-09-07"; sp.end = "2026-09-18";
        db.sprints.push(sp);
        for (const [title, enT, stage, due, deliverable, enD] of (e.tasks || [])) {
          db.tasks.push({ id: "DT-" + (++db.meta.taskSeq), projectId: id, sprintNo: sp.no,
                          title, owner: e.owner, stage, due, done: false, carry: 0, deliverable,
                          stageAt: "2026-09-08", logs: [],
                          i18n: { en: { title: enT, deliverable: enD, _src: { title, deliverable } } } });
        }
      }
    }
  }
  db.meta.kpiSchema = 7;
  return true;
}
function seedRequests() {
  return [
    { id: "REQ-2026-041", title: "신제품 수요 예측 문의", channel: "이메일", requester: "기획팀 홍길동",
      dept: "Product Planning", status: "접수", note: "내년 상반기 라인업 수요 규모 추정 요청", createdAt: "2026-08-20", link: null },
    { id: "REQ-2026-042", title: "지난달 캠페인 채널별 성과 데이터 요청", channel: "회의", requester: "마케팅팀 김철수",
      dept: "Marketing", status: "리턴", note: "기존 대시보드 링크로 즉시 회신", createdAt: "2026-08-21", link: null },
  ];
}
function saveDb() {
  store.save(db);
}

/* 전사 KPI — 영역(재무/사업/지속경영) 소속. 부서(Product)와 독립이며,
   어느 부서의 프로젝트든 KPI에 연결할 수 있다 (부서간 협업 과제의 지표 중심 추적).
   direction: '+' 높을수록 좋음 · '-' 낮을수록 좋음 · '~' 목표에 근접할수록 좋음 */
const KPI_AREAS = ["재무", "사업", "지속경영"];
// v1(부문 소속 KPI) → 전사 KPI 승격 시 지표명 기준 영역 매핑 (미등록 지표는 사업)
const KPI_AREA_MIGRATE = {
  "월 결산 소요일": "재무",
  "분기 수주 예측 오차": "사업",
  "리드 스코어링 적용률": "사업",
  "캠페인 ROI 측정 커버리지": "사업",
  "세그먼트 기반 캠페인 비중": "사업",
  "AS 접수 자동 분류 정확도": "지속경영",
  "VOC 리포트 주간 자동 발행률": "지속경영",
};
// 시드 공용 — 이름(+데이터 소스) 영문 사이드카 부착
function trKpi(rec, en, enSrc) {
  const tr = { name: en, _src: { name: rec.name } };
  if (enSrc && rec.source) { tr.source = enSrc; tr._src.source = rec.source; }
  return { source: "", subs: [], ...rec, i18n: { en: tr } };
}
function seedKpis() {
  const tr = trKpi;
  return [
    tr({ code: "K1", area: "재무", name: "월 결산 소요일", unit: "일", direction: "-", target: 2, weight: 2,
      source: "ERP 결산 마감 로그",
      measures: [{ at: "2026-07-05", value: 5 }, { at: "2026-08-05", value: 3 }, { at: "2026-09-04", value: 2.1 }] },
      "Days to monthly close", "ERP closing ledger log"),
    tr({ code: "K2", area: "사업", name: "분기 수주 예측 오차", unit: "%", direction: "-", target: 10, weight: 2,
      source: "CRM 수주 파이프라인",
      measures: [{ at: "2026-07-31", value: 18 }, { at: "2026-08-31", value: 12 }, { at: "2026-09-10", value: 10.4 }] },
      "Quarterly order forecast error", "CRM order pipeline"),
    tr({ code: "K3", area: "사업", name: "리드 스코어링 적용률", unit: "%", direction: "+", target: 100, weight: 1,
      measures: [{ at: "2026-07-31", value: 45 }, { at: "2026-08-31", value: 62 }, { at: "2026-09-10", value: 78 }] },
      "Lead scoring adoption rate"),
    tr({ code: "K4", area: "사업", name: "캠페인 ROI 측정 커버리지", unit: "%", direction: "+", target: 100, weight: 1,
      measures: [{ at: "2026-08-31", value: 30 }, { at: "2026-09-10", value: 55 }] },
      "Campaign ROI measurement coverage"),
    tr({ code: "K5", area: "사업", name: "세그먼트 기반 캠페인 비중", unit: "%", direction: "+", target: 50, weight: 1,
      measures: [] },
      "Share of segment-based campaigns"),
    tr({ code: "K6", area: "지속경영", name: "AS 접수 자동 분류 정확도", unit: "%", direction: "+", target: 90, weight: 2,
      source: "VOC 분류 모델 평가 파이프라인",
      measures: [{ at: "2026-07-31", value: 82 }, { at: "2026-08-31", value: 86 }, { at: "2026-09-10", value: 88.5 }] },
      "AS intake auto-classification accuracy", "VOC classification model evaluation pipeline"),
    tr({ code: "K7", area: "지속경영", name: "VOC 리포트 주간 자동 발행률", unit: "%", direction: "+", target: 100, weight: 1,
      measures: [{ at: "2026-08-31", value: 50 }, { at: "2026-09-10", value: 75 }] },
      "Weekly VOC report automation rate"),
  ];
}
// v2→v3 승격 시 지표명 기준 데이터 소스 매핑 (빈 값 = 미연동 → 연동 프로젝트 필요)
const KPI_SRC_MIGRATE = {
  "월 결산 소요일": ["ERP 결산 마감 로그", "ERP closing ledger log"],
  "분기 수주 예측 오차": ["CRM 수주 파이프라인", "CRM order pipeline"],
  "AS 접수 자동 분류 정확도": ["VOC 분류 모델 평가 파이프라인", "VOC classification model evaluation pipeline"],
};
/* KPI 트리 예시 — 고객만족(지속경영): 품질/서비스/고객케어 하위 지표로 분해되고,
   각 지표는 시스템 수집 데이터 소스와 연동된다. 미연동 지표(source 빈값)는
   "데이터 연동 프로젝트"가 필수로 이어져야 하는 1급 관리 대상. */
function seedCsatKpi(code) {
  const tr = trKpi;
  return tr({
    code, area: "지속경영", name: "고객만족", unit: "", direction: "+", target: null, weight: 2,
    source: "", measures: [],
    subs: [
      tr({ code: code + "-1", group: "품질", name: "12V 배터리 방전 건수", unit: "건/천대", direction: "-",
        target: 3, weight: 2, source: "텔레매틱스 배터리 이벤트 로그",
        measures: [{ at: "2026-07-31", value: 5.2 }, { at: "2026-08-31", value: 4.6 }, { at: "2026-09-10", value: 4.1 }] },
        "12V battery discharge cases", "Telematics battery event log"),
      tr({ code: code + "-2", group: "품질", name: "DTC (MIL ON) 발생률", unit: "%", direction: "-",
        target: 1.5, weight: 2, source: "차량 진단 DTC 수집 시스템",
        measures: [{ at: "2026-07-31", value: 2.4 }, { at: "2026-08-31", value: 2.1 }, { at: "2026-09-10", value: 1.9 }] },
        "DTC (MIL ON) incidence rate", "Vehicle diagnostics DTC collection system"),
      tr({ code: code + "-3", group: "서비스", name: "정비 즉시 예약 가능률", unit: "%", direction: "+",
        target: 90, weight: 1, source: "", measures: [] },
        "Immediate service booking availability"),
      tr({ code: code + "-4", group: "서비스", name: "평균 수리 소요시간", unit: "시간", direction: "-",
        target: 4, weight: 1, source: "정비 시스템 작업 오더",
        measures: [{ at: "2026-08-31", value: 6.5 }, { at: "2026-09-10", value: 5.8 }] },
        "Average repair turnaround time", "Service shop work orders"),
      tr({ code: code + "-5", group: "고객케어", name: "서비스 앱 고객 평점", unit: "점", direction: "+",
        target: 4.5, weight: 1, source: "",
        measures: [{ at: "2026-07-31", value: 4.1 }, { at: "2026-08-31", value: 4.2 }, { at: "2026-09-10", value: 4.25 }] },
        "Service app customer rating"),
    ],
  }, "Customer satisfaction");
}
// 시드 프로젝트 ↔ 전사 KPI 연결 (projectId → KPI/하위 지표 코드)
const SEED_PRJ_KPI = { 14: "K1", 11: "K2", 3: "K3", 9: "K4", 7: "K6", 17: "K8-3" };

/* 초기 시드 — 프로토타입 검토 데이터를 실데이터의 출발점으로 */
function seed() {
  const products = [
    { name: "Sales", status: "fixed", owner: "김유진",
      goal: "감(感)이 아닌 데이터로 수주를 예측한다: 분기 수주 예측 오차 ±10% 이내, 리드 스코어링 전 영업조직 적용.",
      kpi: "분기 수주 예측 오차 ±10% · 리드 스코어링 적용률 100%",
      ms: [{ code: "M1", name: "리드 스코어링 v1 적용", due: "2026-Q2" },
           { code: "M2", name: "수주 파이프라인 예측 모델", due: "2026-Q3" },
           { code: "M3", name: "예측 기반 목표 수립 프로세스", due: "2026-Q4" }],
      history: [] },
    { name: "Finance", status: "shaping", owner: "박민수",
      goal: "결산·재무 리포트의 수작업 제거와 이상 징후 조기 탐지. KPI는 결산 자동화 결과를 보고 4분기 확정.",
      kpi: "월 결산 소요일 5일 → 2일 (안)",
      ms: [{ code: "M1", name: "월 결산 자동화 파이프라인", due: "2026-Q3" },
           { code: "M2", name: "이상 거래 탐지 PoC", due: "2026-Q4" }],
      history: [] },
    { name: "Marketing", status: "shaping", owner: "이서연",
      goal: "캠페인 집행을 ROI 데이터로 의사결정: 전 캠페인 ROI 측정 체계 구축, 세그먼트 기반 타게팅 전환.",
      kpi: "캠페인 ROI 측정 커버리지 100% (안)",
      ms: [{ code: "M1", name: "캠페인 ROI 대시보드", due: "2026-Q3" },
           { code: "M2", name: "고객 세그먼테이션", due: "2026-Q4", hold: true }],
      history: [] },
    { name: "Product Planning", status: "draft", owner: "정다현",
      goal: "신제품 기획에 수요 예측 데이터를 반영한다. KPI·범위는 첫 프로젝트 Intake 협의로 구체화.",
      kpi: "",
      ms: [{ code: "M1", name: "신제품 수요 예측 PoC", due: "2026-Q4" }],
      history: [] },
    { name: "Service", status: "fixed", owner: "최현우",
      goal: "VOC를 실시간으로 읽는 서비스 조직: AS 접수 자동 분류 정확도 90%, VOC 리포트 주간 자동 발행.",
      kpi: "AS 자동 분류 정확도 90% · VOC 리포트 주간 발행",
      ms: [{ code: "M1", name: "VOC 분류 자동화 배포", due: "2026-Q3" },
           { code: "M2", name: "주간 VOC 리포트 자동화", due: "2026-Q4" }],
      history: [] },
  ];
  const projects = [
    { id: 11, name: "수주 파이프라인 예측 모델", dept: "Sales", ms: "M2", owner: "김유진", prio: "P0", status: "진행중", start: "2026-06-01", end: "2026-09-30" },
    { id: 7,  name: "AS 접수 VOC 분류 자동화", dept: "Service", ms: "M1", owner: "최현우", prio: "P0", status: "진행중", start: "2026-04-14", end: "2026-09-12" },
    { id: 14, name: "월 결산 자동화 및 이상 탐지", dept: "Finance", ms: "M1", owner: "박민수", prio: "P1", status: "진행중", start: "2026-07-06", end: "2026-11-27" },
    { id: 9,  name: "캠페인 ROI 대시보드", dept: "Marketing", ms: "M1", owner: "이서연", prio: "P1", status: "진행중", start: "2026-05-18", end: "2026-10-16" },
    { id: 16, name: "신제품 수요 예측", dept: "Product Planning", ms: "M1", owner: "정다현", prio: "P2", status: "계획", start: "2026-09-01", end: "2026-12-18" },
    { id: 12, name: "마케팅 고객 세그먼테이션", dept: "Marketing", ms: "M2", owner: "한지민", prio: "P2", status: "보류", start: "2026-06-15", end: "" },
    { id: 3,  name: "영업 리드 스코어링", dept: "Sales", ms: "M1", owner: "김유진", prio: "P2", status: "완료", start: "2026-01-12", end: "2026-05-29" },
    { id: 17, name: "정비 예약 시스템 데이터 연동", dept: "Service", ms: "M1", owner: "최현우", prio: "P1", status: "진행중", start: "2026-09-01", end: "2026-11-27" },
  ];
  for (const p of projects) {
    p.kpi = SEED_PRJ_KPI[p.id] || "";
    p.kpiRole = p.id === 17 ? "연동" : (p.kpi ? "개선" : "");
  }
  const sprints = [];
  const tasks = [];
  let taskSeq = 100;
  const addTask = (pid, spNo, title, owner, stage, due, done, carry = 0) =>
    tasks.push({ id: "DT-" + (++taskSeq), projectId: pid, sprintNo: spNo, title, owner,
                 stage, due, done: !!done, carry, stageAt: "2026-08-" + String(10 + (taskSeq % 15)).padStart(2, "0") });
  for (const p of projects.filter(p => p.status === "진행중")) {
    sprints.push({ id: `${p.id}:16`, projectId: p.id, no: 16, name: "Sprint 2026-16", start: "2026-08-03", end: "2026-08-14", status: "closed", retro: "" });
    sprints.push({ id: `${p.id}:17`, projectId: p.id, no: 17, name: "Sprint 2026-17", start: "2026-08-17", end: "2026-08-28", status: "active", retro: "" });
    sprints.push({ id: `${p.id}:18`, projectId: p.id, no: 18, name: "Sprint 2026-18", start: "2026-08-31", end: "2026-09-11", status: "planned", retro: "" });
  }
  addTask(11, 16, "CRM 원천 데이터 적재 배치", "김유진", 5, "2026-08-12", true);
  addTask(11, 16, "수주 이력 정합성 검증", "김유진", 5, "2026-08-14", true);
  addTask(11, 17, "수주 예측 피처 마트 구축 + 베이스라인", "김유진", 3, "2026-08-22", false, 1);
  addTask(11, 17, "분기 수주액 모델 하이퍼파라미터 튜닝", "김유진", 3, "2026-08-28", false);
  addTask(11, 17, "CRM 활동 이력 적재 배치 작성", "김유진", 1, "2026-08-28", false);
  addTask(7, 17, "VOC 분류 모델 재학습 파이프라인 (주 1회)", "최현우", 4, "2026-08-25", false);
  addTask(7, 17, "AS 접수 화면에 분류 결과 노출 API", "최현우", 5, "2026-08-26", false);
  addTask(7, 16, "분류 라벨 체계 정리", "최현우", 5, "2026-08-13", true);
  addTask(14, 17, "결산 데이터 정합성 검증 (ERP-DW 대사)", "박민수", 1, "2026-08-21", false, 1);
  addTask(14, 17, "이상 탐지 대상 계정과목 범위 협의", "박민수", 0, "2026-08-26", false);
  addTask(9, 17, "캠페인 비용 데이터 연동 (GA4+광고)", "이서연", 1, "2026-08-25", false);
  addTask(9, 17, "채널별 전환 기여 탐색 분석", "이서연", 2, "2026-08-27", false);
  addTask(9, 17, "ROI 대시보드 화면 개발 (1차)", "이서연", 5, "2026-08-28", false);
  return { meta: { taskSeq, projectSeq: 20, reqSeq: 42, kpiSchema: 3 }, products, projects, sprints, tasks,
           kpis: [...seedKpis(), seedCsatKpi("K8")], requests: seedRequests() };
}

/* ═══════════ KPI 달성률·신호등 (digitaltwin.retail.vehicle 방식 이식) ═══════════ */
// 방향 반영 달성률: '+' 실적/목표 · '-' 목표/실적 · '~' 1-|실적-목표|/목표. 0~1.3 클램프, 미측정·목표 미정은 null.
function kpiAttain(k, v) {
  const t = k.target;
  if (v == null || t == null || t === "") return null;
  let a;
  if (k.direction === "-") a = v === 0 ? 1.3 : t / v;
  else if (k.direction === "~") a = t === 0 ? null : 1 - Math.abs(v - t) / Math.abs(t);
  else a = t === 0 ? null : v / t;
  return a == null || !isFinite(a) ? null : Math.max(0, Math.min(1.3, a));
}
// 신호등: 달성률 98%↑ good · 92%↑ warn · 미만 crit · 미측정 na
const kpiLamp = a => a == null ? "na" : a >= 0.98 ? "good" : a >= 0.92 ? "warn" : "crit";

/* ═══════════ 파생값 (진행률 등) ═══════════ */
function enrich() {
  const byPrj = {};
  for (const t of db.tasks) {
    (byPrj[t.projectId] = byPrj[t.projectId] || { total: 0, done: 0 }).total++;
    if (t.done) byPrj[t.projectId].done++;
  }
  const projects = db.projects.map(p => {
    const c = byPrj[p.id] || { total: 0, done: 0 };
    return { ...p, tasksTotal: c.total, tasksDone: c.done,
             pct: c.total ? Math.round(c.done / c.total * 100) : 0 };
  });
  const products = db.products.map(pr => ({
    ...pr,
    ms: pr.ms.map(m => {
      const rel = projects.filter(p => p.dept === pr.name && p.ms === m.code);
      const tot = rel.reduce((s, p) => s + p.tasksTotal, 0);
      const pct = tot ? Math.round(rel.reduce((s, p) => s + p.pct * p.tasksTotal, 0) / tot)
                      : (rel.length ? Math.round(rel.reduce((s, p) => s + p.pct, 0) / rel.length) : 0);
      return { ...m, pct, projects: rel.length };
    }),
  }));
  // 전사 KPI: 최신 측정값 → 달성률·신호등, 부서 불문 연결 프로젝트·태스크 집계 (협업 추적).
  // 지표(leaf)마다 데이터 연동 상태 파생: 소스 명시=linked · 연동 프로젝트 진행=in_progress ·
  // 둘 다 없음=unlinked (미연동 지표는 데이터 연동 프로젝트가 필수로 이어져야 한다)
  const enrichLeaf = node => {
    const msr = (node.measures || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const last = msr[msr.length - 1] || null;
    const attain = kpiAttain(node, last ? last.value : null);
    const rel = projects.filter(p => p.kpi === node.code);
    const dataActive = rel.some(p => p.kpiRole === "연동" && p.status !== "완료");
    // 상충 감시(가드레일): 다른 프로젝트가 이 지표에 선언한 사이드 이펙트
    const sideEffects = projects.flatMap(p => (p.impacts || [])
      .filter(i => i.kpi === node.code)
      .map(i => ({ id: p.id, name: p.name, dept: p.dept, status: p.status, effect: i.effect, note: i.note })));
    return { ...node, measures: msr, actual: last, attain, lamp: kpiLamp(attain),
             projects: rel.length, depts: [...new Set(rel.map(p => p.dept))],
             tasksTotal: rel.reduce((s, p) => s + p.tasksTotal, 0),
             tasksDone: rel.reduce((s, p) => s + p.tasksDone, 0),
             dataState: node.source ? "linked" : dataActive ? "in_progress" : "unlinked",
             sideEffects,
             conflicts: sideEffects.filter(e => e.effect === "-" && e.status !== "완료").length };
  };
  const kpis = (db.kpis || []).map(k => {
    const subs = (k.subs || []).map(enrichLeaf);
    const own = enrichLeaf(k);
    if (!subs.length) return { ...own, subs };
    // 하위 지표가 있는 KPI: 트윈 방식대로 KPI 자체 실측이 우선, 없으면 측정된 하위 지표의 가중 롤업.
    // 프로젝트·태스크는 하위 지표 연결분 포함 합산 (rollup=true면 달성률이 롤업값이라는 표시)
    const meas = subs.filter(s => s.attain != null);
    const w = meas.reduce((s, x) => s + (x.weight || 1), 0);
    const roll = w ? meas.reduce((s, x) => s + x.attain * (x.weight || 1), 0) / w : null;
    const attain = own.attain != null ? own.attain : roll;
    const subCodes = new Set(subs.map(s => s.code));
    const rel = projects.filter(p => p.kpi === k.code || subCodes.has(p.kpi));
    return { ...own, subs, attain, lamp: kpiLamp(attain), rollup: own.attain == null && roll != null,
             projects: rel.length, depts: [...new Set(rel.map(p => p.dept))],
             tasksTotal: rel.reduce((s, p) => s + p.tasksTotal, 0),
             tasksDone: rel.reduce((s, p) => s + p.tasksDone, 0) };
  });
  // 영역 롤업 — 측정된 KPI만 가중 평균, 미측정은 커버리지로 별도 표시
  const kpiAreas = KPI_AREAS.map(area => {
    const list = kpis.filter(k => k.area === area);
    const measured = list.filter(k => k.attain != null);
    const w = measured.reduce((s, k) => s + (k.weight || 1), 0);
    const score = w ? measured.reduce((s, k) => s + k.attain * (k.weight || 1), 0) / w : null;
    return { area, total: list.length, measured: measured.length, score, lamp: kpiLamp(score) };
  });
  return { products, projects, kpis, kpiAreas, sprints: db.sprints, tasks: db.tasks,
           requests: db.requests || [], stages: STAGES };
}

/* ═══════════ i18n — 사용자 작성 데이터의 언어별 치환 ═══════════
   레코드의 rec.i18n[lang][field]에 번역본이 있으면 응답 시 원문 대신 치환한다.
   원문 언어는 필드 텍스트 자체(한글 포함 여부)로 판별되며, 번역본은 /translate
   스킬(scripts/i18n-scan.js)이 채운다. 조인 키(product.name, project.dept,
   status·stage 토큰)는 번역하지 않는다 — UI 표시 번역은 클라이언트 사전이 담당. */
const TR_FIELDS = {
  products: { fields: ["goal", "kpi"], nested: { ms: ["name"], history: ["why", "before"] } },
  kpis:     { fields: ["name", "source"], nested: { subs: ["name", "source"] } },
  projects: { fields: ["name"], nested: { impacts: ["note"] } },
  sprints:  { fields: ["retro"] },
  tasks:    { fields: ["title", "deliverable"], nested: { logs: ["text"] } },
  requests: { fields: ["title", "note", "requester"], nested: { logs: ["text"] } },
};
function trRec(rec, fields, lang) {
  const tr = rec && rec.i18n && rec.i18n[lang];
  if (!tr) return rec;
  const out = { ...rec };
  for (const f of fields) if (tr[f] != null) out[f] = tr[f];
  return out;
}
function localize(state, lang) {
  if (lang !== "en" && lang !== "ko") return state;
  const out = { ...state };
  for (const [col, spec] of Object.entries(TR_FIELDS)) {
    out[col] = (state[col] || []).map(rec => {
      let r = trRec(rec, spec.fields, lang);
      for (const [nk, nf] of Object.entries(spec.nested || {})) {
        if (Array.isArray(rec[nk])) {
          if (r === rec) r = { ...rec };
          r[nk] = rec[nk].map(item => trRec(item, nf, lang));
        }
      }
      return r;
    });
  }
  return out;
}
// 편집 저장: 값이 기존 번역본과 동일하면 원문을 건드리지 않고(무변경),
// 실제로 바뀐 값이면 원문을 갱신하고 그 필드의 기존 번역을 폐기한다 (스킬이 재번역).
function updTr(rec, field, val) {
  if (val == null || val === rec[field]) return;
  if (rec.i18n && Object.values(rec.i18n).some(tr => tr && tr[field] === val)) return;
  rec[field] = val;
  if (rec.i18n) for (const tr of Object.values(rec.i18n)) {
    if (tr) { delete tr[field]; if (tr._src) delete tr._src[field]; }
  }
}

/* ═══════════ Git 자동 커밋 ═══════════ */
function git(args, opts = {}) {
  return new Promise(resolve =>
    execFile("git", args, { cwd: ROOT, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout || "").trim(), err: (stderr || "").trim() })));
}
let lastCommit = { at: null, result: "" };
async function autoCommit(reason = "daily") {
  const ac = CFG.autoCommit || {};
  const paths = ac.paths && ac.paths.length ? ac.paths : ["data"];
  const st = await git(["status", "--porcelain", "--", ...paths]);
  if (!st.out) { lastCommit = { at: new Date().toISOString(), result: "변경 없음 — 커밋 생략" }; return lastCommit; }
  await git(["add", "--", ...paths]);
  const msg = `${ac.message || "chore(data): daily snapshot"} ${new Date().toISOString().slice(0, 10)} (${reason})`;
  const cm = await git(["commit", "-m", msg]);
  if (!cm.ok) { lastCommit = { at: new Date().toISOString(), result: "커밋 실패: " + cm.err }; return lastCommit; }
  let pushed = [];
  if (ac.push) {
    for (const r of ac.remotes || ["origin"]) {
      const p = await git(["push", r, "HEAD"]);
      pushed.push(`${r}: ${p.ok ? "OK" : "실패(" + (p.err.split("\n")[0] || "원격 미설정") + ")"}`);
    }
  }
  lastCommit = { at: new Date().toISOString(), result: `커밋 완료 — ${msg}` + (pushed.length ? ` · push ${pushed.join(", ")}` : "") };
  console.log("[autocommit]", lastCommit.result);
  return lastCommit;
}
function scheduleDaily() {
  const ac = CFG.autoCommit || {};
  if (!ac.enabled) return;
  const [h, m] = (ac.time || "23:50").split(":").map(Number);
  const now = new Date();
  const next = new Date(now); next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  console.log(`[autocommit] 다음 자동 커밋: ${next.toLocaleString()}`);
  setTimeout(async () => { await autoCommit("daily"); scheduleDaily(); }, next - now);
}
async function gitStatus() {
  const [dirty, branch, remotes, last] = await Promise.all([
    git(["status", "--porcelain", "--", ...(CFG.autoCommit?.paths || ["data"])]),
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    git(["remote", "-v"]),
    git(["log", "-1", "--format=%h %ad %s", "--date=format:%m-%d %H:%M"]),
  ]);
  return { dirty: !!dirty.out, changes: dirty.out.split("\n").filter(Boolean).length,
           branch: branch.out, remotes: [...new Set(remotes.out.split("\n").map(l => l.split("\t")[0]).filter(Boolean))],
           lastLog: last.out, lastAuto: lastCommit, config: CFG.autoCommit };
}

/* ═══════════ API ═══════════ */
// 사이드 이펙트 병합 — 무변경(또는 기존 번역본과 동일) 항목은 원문·i18n 사이드카를 보존
function mergeImpacts(oldArr, newArr) {
  return (Array.isArray(newArr) ? newArr : []).filter(ni => ni && ni.kpi).map(ni => {
    const o = (oldArr || []).find(x => x.kpi === ni.kpi && x.effect === ni.effect &&
      (x.note === ni.note || (x.i18n && Object.values(x.i18n).some(t => t && t.note === ni.note))));
    return o || { kpi: String(ni.kpi), effect: ni.effect === "+" ? "+" : "-", note: String(ni.note || "") };
  });
}
function nextSprint(projectId) {
  const sps = db.sprints.filter(s => s.projectId === projectId).sort((a, b) => a.no - b.no);
  const last = sps[sps.length - 1];
  const no = last ? last.no + 1 : 1;
  const start = last ? addDays(last.end, 3) : new Date().toISOString().slice(0, 10);
  return { id: `${projectId}:${no}`, projectId, no, name: `Sprint 2026-${String(no).padStart(2, "0")}`,
           start, end: addDays(start, 11), status: "planned", retro: "" };
}
const addDays = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const stageDays = t => Math.max(0, Math.round((Date.now() - new Date(t.stageAt + "T00:00:00")) / 864e5));

/* 첨부파일 — base64 JSON 업로드, data/files/에 저장 (자동 커밋 대상) */
const FILES_DIR = path.join(ROOT, "data", "files");
const safeName = n => String(n || "file").replace(/[/\\<>&"'`]/g, "_").slice(0, 80);
function uploadFile(coll, b) {
  const o = coll.find(x => x.id === b.id);
  if (!o) throw { code: 404, msg: "not found" };
  if (!b.name || !b.data) throw { code: 400, msg: "파일이 없습니다" };
  const buf = Buffer.from(b.data, "base64");
  if (buf.length > 10 * 1024 * 1024) throw { code: 400, msg: "10MB 이하 파일만 업로드할 수 있습니다" };
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const name = safeName(b.name);
  const fname = `${o.id}-${Date.now()}-${name}`;
  fs.writeFileSync(path.join(FILES_DIR, fname), buf);
  (o.files = o.files || []).push({ name, path: fname, size: buf.length, at: new Date().toISOString() });
  (o.logs = o.logs || []).push({ at: new Date().toISOString(), type: "note", text: `📎 첨부: ${name}` });
  saveDb(); return { ok: true, file: fname };
}

const API = {
  "GET /api/state": (b, q) => localize(enrich(), (q && q.get("lang")) || "ko"),
  "GET /api/git/status": () => gitStatus(),
  "POST /api/git/commit": () => autoCommit("manual"),

  "POST /api/product/create": b => {
    if (!b.name || !b.owner) throw { code: 400, msg: "부문명과 오너는 필수입니다" };
    if (db.products.some(x => x.name === b.name)) throw { code: 409, msg: "이미 존재하는 부문입니다" };
    db.products.push({ name: b.name, status: b.status || "draft", owner: b.owner,
                       goal: b.goal || "", kpi: b.kpi || "", ms: [], history: [] });
    saveDb(); return { ok: true };
  },
  "POST /api/goal/save": b => {
    const p = db.products.find(x => x.name === b.product);
    if (!p) throw { code: 404, msg: "product not found" };
    p.history.push({ at: new Date().toISOString(), why: b.why || "", before: p.goal });
    updTr(p, "goal", b.goal); updTr(p, "kpi", b.kpi);
    Object.assign(p, { status: b.status ?? p.status, owner: b.owner ?? p.owner });
    saveDb(); return { ok: true };
  },
  "POST /api/milestone/save": b => {
    const p = db.products.find(x => x.name === b.product);
    if (!p) throw { code: 404, msg: "product not found" };
    if (b.code) {
      const m = p.ms.find(x => x.code === b.code);
      if (!m) throw { code: 404, msg: "milestone not found" };
      updTr(m, "name", b.name);
      Object.assign(m, { due: b.due ?? m.due, hold: !!b.hold });
    } else {
      p.ms.push({ code: "M" + (p.ms.length + 1), name: b.name, due: b.due || "2026-Q4", hold: !!b.hold });
    }
    saveDb(); return { ok: true };
  },
  "POST /api/kpi/save": b => {
    db.kpis = db.kpis || [];
    const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
    if (b.area !== undefined && !KPI_AREAS.includes(b.area)) throw { code: 400, msg: "영역은 재무/사업/지속경영 중 하나여야 합니다" };
    if (b.code) {
      const k = db.kpis.find(x => x.code === b.code);
      if (!k) throw { code: 404, msg: "kpi not found" };
      updTr(k, "name", b.name); updTr(k, "source", b.source);
      Object.assign(k, { area: b.area ?? k.area, unit: b.unit ?? k.unit, direction: b.direction ?? k.direction,
                         target: b.target !== undefined ? num(b.target) : k.target,
                         weight: b.weight !== undefined ? (num(b.weight) || 1) : k.weight });
    } else {
      if (!b.name) throw { code: 400, msg: "지표명은 필수입니다" };
      if (!b.area) throw { code: 400, msg: "영역은 재무/사업/지속경영 중 하나여야 합니다" };
      // 수동 추가 KPI는 Kn 시퀀스 채번 (트윈 코드 KPI-*와 별도)
      db.meta.kpiSeq = (db.meta.kpiSeq || db.kpis.reduce((m, k) => Math.max(m, +String(k.code).slice(1) || 0), 0)) + 1;
      db.kpis.push({ code: "K" + db.meta.kpiSeq, area: b.area, name: b.name, unit: b.unit || "",
                     direction: b.direction || "+", target: num(b.target), weight: num(b.weight) || 1,
                     source: b.source || "", measures: [], subs: [] });
    }
    saveDb(); return { ok: true };
  },
  // 하위 지표 — 부모 KPI를 분류(예: 품질/서비스/고객케어)별 정량 지표로 분해
  "POST /api/kpi/sub/save": b => {
    const k = (db.kpis || []).find(x => x.code === b.parent);
    if (!k) throw { code: 404, msg: "kpi not found" };
    const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
    k.subs = k.subs || [];
    if (b.code) {
      const s = k.subs.find(x => x.code === b.code);
      if (!s) throw { code: 404, msg: "kpi not found" };
      updTr(s, "name", b.name); updTr(s, "source", b.source);
      Object.assign(s, { group: b.group ?? s.group, unit: b.unit ?? s.unit, direction: b.direction ?? s.direction,
                         target: b.target !== undefined ? num(b.target) : s.target,
                         weight: b.weight !== undefined ? (num(b.weight) || 1) : s.weight });
    } else {
      if (!b.name) throw { code: 400, msg: "지표명은 필수입니다" };
      // "부모코드-n" 채번 — 트윈 노드 코드(ND-*)와 공존, 부모 프리픽스 항목만 집계
      const n = k.subs.reduce((m, s) => Math.max(m,
        String(s.code).startsWith(k.code + "-") ? +String(s.code).slice(k.code.length + 1) || 0 : 0), 0) + 1;
      k.subs.push({ code: `${k.code}-${n}`, group: b.group || "", name: b.name, unit: b.unit || "",
                    direction: b.direction || "+", target: num(b.target), weight: num(b.weight) || 1,
                    source: b.source || "", measures: [] });
    }
    saveDb(); return { ok: true };
  },
  "POST /api/kpi/sub/delete": b => {
    const k = (db.kpis || []).find(x => x.code === b.parent);
    const i = k ? (k.subs || []).findIndex(x => x.code === b.code) : -1;
    if (i < 0) throw { code: 404, msg: "kpi not found" };
    for (const prj of db.projects) if (prj.kpi === b.code) { prj.kpi = ""; prj.kpiRole = ""; }
    k.subs.splice(i, 1); saveDb(); return { ok: true };
  },
  "POST /api/kpi/measure": b => {
    let k = null;
    for (const x of db.kpis || []) {
      if (x.code === b.code) { k = x; break; }
      k = (x.subs || []).find(s => s.code === b.code);
      if (k) break;
    }
    if (!k) throw { code: 404, msg: "kpi not found" };
    if (b.value === "" || b.value == null || isNaN(+b.value)) throw { code: 400, msg: "측정값은 숫자여야 합니다" };
    (k.measures = k.measures || []).push({ at: b.at || new Date().toISOString().slice(0, 10),
                                           value: +b.value, note: b.note || "" });
    saveDb(); return { ok: true };
  },
  "POST /api/kpi/delete": b => {
    const i = (db.kpis || []).findIndex(x => x.code === b.code);
    if (i < 0) throw { code: 404, msg: "kpi not found" };
    // 하위 지표에 연결된 프로젝트까지 모두 해제
    const codes = new Set([b.code, ...(db.kpis[i].subs || []).map(s => s.code)]);
    for (const prj of db.projects) if (codes.has(prj.kpi)) { prj.kpi = ""; prj.kpiRole = ""; }
    db.kpis.splice(i, 1); saveDb(); return { ok: true };
  },
  "POST /api/project/create": b => {
    const id = ++db.meta.projectSeq;
    db.projects.push({ id, name: b.name, dept: b.dept, ms: b.ms || "M1", owner: b.owner,
                       kpi: b.kpi || "", kpiRole: b.kpi ? (b.kpiRole || "개선") : "",
                       impacts: mergeImpacts([], b.impacts),
                       prio: b.prio || "P1", status: "계획", start: b.start || "", end: b.end || "" });
    db.sprints.push(nextSprint(id));
    saveDb(); return { ok: true, id };
  },
  "POST /api/project/update": b => {
    const p = db.projects.find(x => x.id === +b.id);
    if (!p) throw { code: 404, msg: "project not found" };
    updTr(p, "name", b.name);
    Object.assign(p, { dept: b.dept ?? p.dept, ms: b.ms ?? p.ms, kpi: b.kpi ?? p.kpi,
                       owner: b.owner ?? p.owner, prio: b.prio ?? p.prio, status: b.status ?? p.status,
                       start: b.start ?? p.start, end: b.end ?? p.end });
    p.kpiRole = p.kpi ? (b.kpiRole ?? p.kpiRole ?? "개선") : "";
    if (b.impacts !== undefined) p.impacts = mergeImpacts(p.impacts, b.impacts);
    saveDb(); return { ok: true };
  },
  "POST /api/project/delete": b => {
    const i = db.projects.findIndex(x => x.id === +b.id);
    if (i < 0) throw { code: 404, msg: "project not found" };
    db.projects.splice(i, 1);
    db.sprints = db.sprints.filter(s => s.projectId !== +b.id);
    db.tasks = db.tasks.filter(t => t.projectId !== +b.id);
    saveDb(); return { ok: true };
  },
  "POST /api/sprint/create": b => {
    const sp = nextSprint(b.projectId);
    db.sprints.push(sp); saveDb(); return { ok: true, sprint: sp };
  },
  "POST /api/sprint/start": b => {
    const sp = db.sprints.find(s => s.id === b.sprintId);
    if (!sp) throw { code: 404, msg: "sprint not found" };
    if (db.sprints.some(s => s.projectId === sp.projectId && s.status === "active"))
      throw { code: 409, msg: "이미 진행중인 스프린트가 있습니다 (프로젝트당 1개)" };
    sp.status = "active"; saveDb(); return { ok: true };
  },
  "POST /api/sprint/close": b => {
    const sp = db.sprints.find(s => s.id === b.sprintId);
    if (!sp || sp.status !== "active") throw { code: 400, msg: "진행중 스프린트만 종료할 수 있습니다" };
    const open = db.tasks.filter(t => t.projectId === sp.projectId && t.sprintNo === sp.no && !t.done);
    let nxt = null;
    if (b.carry === "next" && open.length) {
      nxt = db.sprints.find(s => s.projectId === sp.projectId && s.no === sp.no + 1);
      if (!nxt) { nxt = nextSprint(sp.projectId); db.sprints.push(nxt); }
      for (const t of open) { t.sprintNo = nxt.no; t.carry = (t.carry || 0) + 1; }
    } else if (open.length) {                 // backlog
      for (const t of open) { t.sprintNo = null; t.carry = (t.carry || 0) + 1; }
    }
    sp.status = "closed"; sp.retro = b.retro || "";
    saveDb(); return { ok: true, carried: open.length, to: b.carry === "next" ? (nxt && nxt.name) : "백로그" };
  },
  "POST /api/task/create": b => {
    const id = "DT-" + (++db.meta.taskSeq);
    db.tasks.push({ id, projectId: +b.projectId, sprintNo: b.sprintNo ?? null, title: b.title,
                    owner: b.owner, stage: 0, due: b.due || "", done: false, carry: 0,
                    deliverable: b.deliverable || "",
                    stageAt: new Date().toISOString().slice(0, 10), logs: [] });
    saveDb(); return { ok: true, id };
  },
  "POST /api/task/update": b => {
    const t = db.tasks.find(x => x.id === b.id);
    if (!t) throw { code: 404, msg: "task not found" };
    updTr(t, "title", b.title); updTr(t, "deliverable", b.deliverable);
    Object.assign(t, { owner: b.owner ?? t.owner, due: b.due ?? t.due });
    if (b.sprintNo !== undefined) t.sprintNo = b.sprintNo;
    (t.logs = t.logs || []).push({ at: new Date().toISOString(), by: t.owner, type: "edit",
      text: `정보 수정 — 담당 ${t.owner} · 목표일 ${t.due || "미정"}` + (b.reason ? ` · 사유: ${b.reason}` : "") });
    saveDb(); return { ok: true };
  },
  "POST /api/task/log": b => {
    const t = db.tasks.find(x => x.id === b.id);
    if (!t) throw { code: 404, msg: "task not found" };
    if (!b.text) throw { code: 400, msg: "내용을 입력하세요" };
    (t.logs = t.logs || []).push({ at: new Date().toISOString(), by: b.by || t.owner, type: "note", text: b.text });
    saveDb(); return { ok: true };
  },
  "POST /api/task/delete": b => {
    const i = db.tasks.findIndex(x => x.id === b.id);
    if (i < 0) throw { code: 404, msg: "task not found" };
    db.tasks.splice(i, 1); saveDb(); return { ok: true };
  },
  "POST /api/request/create": b => {
    if (!b.title || !b.requester) throw { code: 400, msg: "제목과 요청자는 필수입니다" };
    const id = "REQ-2026-" + String(++db.meta.reqSeq).padStart(3, "0");
    db.requests.push({ id, title: b.title, channel: b.channel || "이메일", requester: b.requester,
                       dept: b.dept || "", status: "접수", note: b.note || "",
                       createdAt: new Date().toISOString().slice(0, 10), link: null });
    saveDb(); return { ok: true, id };
  },
  "POST /api/request/return": b => {
    const r = db.requests.find(x => x.id === b.id);
    if (!r) throw { code: 404, msg: "request not found" };
    r.status = "리턴"; r.note = b.note || r.note;
    (r.logs = r.logs || []).push({ at: new Date().toISOString(), type: "return",
      text: "리턴 완료 — 회신 처리" + (b.note ? ` · ${b.note}` : "") });
    saveDb(); return { ok: true };
  },
  "POST /api/request/status": b => {
    const r = db.requests.find(x => x.id === b.id);
    if (!r) throw { code: 404, msg: "request not found" };
    if (b.status === "반려" && !b.reason) throw { code: 400, msg: "반려는 사유 입력이 필수입니다" };
    const from = r.status; r.status = b.status;
    (r.logs = r.logs || []).push({ at: new Date().toISOString(), type: b.status === "리턴" ? "return" : "메모",
      text: `상태 변경: ${from} → ${b.status}` + (b.reason ? ` · 사유: ${b.reason}` : "") });
    saveDb(); return { ok: true };
  },
  "POST /api/request/log": b => {
    const r = db.requests.find(x => x.id === b.id);
    if (!r) throw { code: 404, msg: "request not found" };
    if (!b.text) throw { code: 400, msg: "내용을 입력하세요" };
    (r.logs = r.logs || []).push({ at: new Date().toISOString(), type: b.type || "메모", text: b.text });
    saveDb(); return { ok: true };
  },
  "POST /api/request/convert": b => {
    const r = db.requests.find(x => x.id === b.id);
    if (!r) throw { code: 404, msg: "request not found" };
    if (b.to === "project") {
      const id = ++db.meta.projectSeq;
      db.projects.push({ id, name: r.title, dept: b.dept || r.dept || "Sales", ms: b.ms || "M1", kpi: "",
                         owner: b.owner, prio: b.prio || "P1", status: "계획", start: "", end: "" });
      db.sprints.push(nextSprint(id));
      r.status = "전환"; r.link = "PRJ-" + String(id).padStart(3, "0");
      (r.logs = r.logs || []).push({ at: new Date().toISOString(), type: "stage",
        text: `새 프로젝트 ${r.link}(으)로 전환 · 담당 ${b.owner}` });
      saveDb(); return { ok: true, link: r.link };
    }
    // 기존 프로젝트의 태스크로 전환 (백로그)
    const tid = "DT-" + (++db.meta.taskSeq);
    db.tasks.push({ id: tid, projectId: +b.projectId, sprintNo: null, title: r.title, owner: b.owner,
                    stage: 0, due: "", done: false, carry: 0, stageAt: new Date().toISOString().slice(0, 10) });
    r.status = "전환"; r.link = tid;
    (r.logs = r.logs || []).push({ at: new Date().toISOString(), type: "stage",
      text: `태스크 ${tid}(으)로 전환 (백로그) · 담당 ${b.owner}` });
    saveDb(); return { ok: true, link: tid };
  },
  "POST /api/task/advance": b => {
    const t = db.tasks.find(x => x.id === b.id);
    if (!t) throw { code: 404, msg: "task not found" };
    const fromIdx = t.stage;
    const days = stageDays(t);                 // 단계별 평균 소요시간 집계용 (FR-110)
    if (t.stage < STAGES.length - 1) { t.stage++; t.stageAt = new Date().toISOString().slice(0, 10); }
    else t.done = true;                        // 마지막 단계 완료 = 태스크 완료
    (t.logs = t.logs || []).push({ at: new Date().toISOString(), type: "stage", stageIdx: fromIdx, days,
      text: (t.done ? `${STAGES[fromIdx]} 완료 — 태스크 완료 처리` : `단계 전환: ${STAGES[fromIdx]} → ${STAGES[t.stage]}`) +
            (b.note ? ` · 산출물: ${b.note}` : "") });
    saveDb(); return { ok: true, stage: t.stage, done: t.done };
  },
  "POST /api/task/move": b => {                // 보드 드래그&드롭 단계 이동 (FR-410)
    const t = db.tasks.find(x => x.id === b.id);
    if (!t) throw { code: 404, msg: "task not found" };
    if (t.done) throw { code: 400, msg: "완료된 태스크는 이동할 수 없습니다" };
    const to = +b.stage;
    if (!(to >= 0 && to < STAGES.length)) throw { code: 400, msg: "잘못된 단계입니다" };
    if (to === t.stage) return { ok: true, stage: t.stage };
    if (to > t.stage + 1) throw { code: 400, msg: "오른쪽 한 칸(다음 단계)으로만 이동할 수 있습니다" };
    if (to < t.stage && !b.reason) throw { code: 400, msg: "이전 단계로 되돌리려면 사유가 필요합니다" };
    const from = t.stage;
    const days = to > from ? stageDays(t) : null;   // 되돌림은 소요시간 통계에서 제외
    t.stage = to; t.stageAt = new Date().toISOString().slice(0, 10);
    (t.logs = t.logs || []).push({ at: new Date().toISOString(), type: "stage",
      ...(days != null ? { stageIdx: from, days } : {}),
      text: `단계 ${to > from ? "전환" : "되돌림"}: ${STAGES[from]} → ${STAGES[to]}` +
            (b.note ? ` · 산출물: ${b.note}` : "") + (b.reason ? ` · 사유: ${b.reason}` : "") });
    saveDb(); return { ok: true, stage: t.stage };
  },
  "POST /api/task/file": b => uploadFile(db.tasks, b),
  "POST /api/request/file": b => uploadFile(db.requests, b),
  "GET /api/task/commits": async (b, q) => {   // [DT-xxx] 커밋 규약 스캔 (FR-510)
    const id = q.get("id") || "";
    if (!/^DT-\d+$/.test(id)) throw { code: 400, msg: "invalid task id" };
    const r = await git(["log", "--all", `--grep=\\[${id}\\]`, "--format=%h|%ad|%an|%s",
                         "--date=format:%Y-%m-%dT%H:%M", "-20"]);
    return { commits: r.out ? r.out.split("\n").map(l => {
      const [hash, at, by, ...s] = l.split("|");
      return { hash, at, by, msg: s.join("|") };
    }) : [] };
  },
};

/* ═══════════ HTTP ═══════════ */
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
               ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const key = `${req.method} ${url.pathname}`;
  try {
    if (API[key]) {
      let body = {};
      if (req.method === "POST") {
        const chunks = []; for await (const c of req) chunks.push(c);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      }
      const out = await API[key](body, url.searchParams);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(out));
    }
    // 업로드 파일 다운로드
    if (url.pathname.startsWith("/files/")) {
      const f = path.normalize(decodeURIComponent(url.pathname.slice(7))).replace(/^([.][.][/\\])+/, "");
      const full = path.join(FILES_DIR, f);
      if (!full.startsWith(FILES_DIR) || !fs.existsSync(full)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("404");
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream",
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(f.replace(/^.*?-\d+-/, "")) });
      return res.end(fs.readFileSync(full));
    }
    // 정적 파일
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    file = path.normalize(file).replace(/^([.][.][/\\])+/, "");
    const full = path.join(ROOT, "public", file);
    if (!full.startsWith(path.join(ROOT, "public")) || !fs.existsSync(full)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404");
    }
    res.writeHead(200, { "Content-Type": (MIME[path.extname(full)] || "application/octet-stream") + "; charset=utf-8" });
    return res.end(fs.readFileSync(full));
  } catch (e) {
    res.writeHead(e.code || 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: e.msg || String(e) }));
  }
});

loadDb();
if (process.argv.includes("--commit-now")) {
  autoCommit("manual").then(r => { console.log(r.result); process.exit(0); });
} else {
  server.listen(CFG.port, () => {
    console.log(`AI/Data North Pole ▶ http://localhost:${CFG.port}`);
    scheduleDaily();
  });
}
