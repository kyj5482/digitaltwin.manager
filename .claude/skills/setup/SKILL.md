---
name: setup
description: AI/Data North Pole 최초 셋업 스킬. 저장소를 새로 clone해 운영을 시작할 때 사용자가 /setup을 실행하거나 "초기 설정", "온보딩", "부문(Product)·Goal 선정", "KPI 설정/등록", "시드 데이터를 우리 조직 데이터로 교체" 등을 요청할 때 사용. 부문(Product)과 Goal을 선정하고 KPI 트리를 설정해 /ticket으로 프로젝트를 시작할 수 있는 상태를 만든다.
---

# /setup — 최초 Product & Goal 선정과 KPI 설정

새로 clone한 AI/Data North Pole을 실운영 상태로 만드는 온보딩 스킬이다.
산출물은 두 가지: ① 부문(Product)별 Goal·마일스톤 (`data/products/`),
② KPI 트리 (`data/kpis/`). 이 둘이 있어야 `/ticket` 스킬이 프로젝트를
올바른 계층(KPI 기여 연결, 마일스톤 소속)에 등록할 수 있다.
배경 철학은 `docs/01-vision-and-goals.md`, KPI 분해 예시는 `docs/08-kpi-bp-catalog.md`.

## 0. 시드 데이터 확인 — 가장 먼저

첫 실행(`node server.js`) 시 검토용 시드 데이터(부문 5개, 트윈 KPI 14개,
프로젝트·태스크)가 자동 생성된다. 셋업 전에 사용자에게 확인한다:

- **시드를 참고용으로 두고 위에 덮어쓰기(권장)** — 부문 파일은 실제 조직으로
  수정, 불필요한 시드 KPI·프로젝트는 삭제 API(`/api/kpi/delete` 등)로 정리.
- **완전 초기화** — `data/`의 `meta.json`과 티켓 디렉터리를 지우면 재시작 시
  시드가 다시 생성되므로, 초기화 후에는 시드 정리 → 실데이터 등록 순으로 진행.

## 1. 쓰기 경로 결정 (`/ticket`과 동일)

```bash
PORT=$(node -p "require('./config.json').port")
curl -s -m 2 "localhost:$PORT/api/state?lang=ko" > /dev/null && echo "서버 ON — API 모드" || echo "서버 OFF — 파일 모드"
```

서버 ON이면 반드시 API로만 쓴다(실행 중 파일 직접 수정 금지 — 메모리가 덮어쓴다).
서버 OFF면 파일을 직접 쓰고 `data/meta.json`의 `kpiSeq`를 올린다.

## 2. Product & Goal 선정 — 인터뷰

사용자에게 물어 채운다. 기본 5부문(Sales/Finance/Marketing/Product Planning/Service)은
예시일 뿐 — 사용자의 실제 조직 단위로 정의한다.

| 항목 | 질문 | 규칙 |
|---|---|---|
| 부문 목록 | "관리 단위(부문)를 무엇으로 나누나?" | 부문 = Product, 각각 Goal·마일스톤 보유 |
| owner | 부문별 책임자 | 필수 — 추측 금지 |
| goal | 연간 목표 문장 | **미완성이어도 등록** — status로 성숙도 표현 |
| status | 초안 | draft / shaping / fixed 3단계 |
| ms | 분기·반기 이정표 | `M1, M2…` 자동 채번, due는 `YYYY-Qn` |

- 생성: `POST /api/product/create` `{name, owner, goal, kpi, status}`
- Goal 수정: `POST /api/goal/save` `{product, goal, kpi, status, why}` — **why(변경 사유) 필수**, 이력에 남는다
- 마일스톤: `POST /api/milestone/save` `{product, name, due}` (code 없으면 추가) · 삭제는 `/api/milestone/delete` `{product, code}` (관련 프로젝트는 연결만 해제)
- 파일 모드: `data/products/<부문명>.json` — `{"name","status","owner","goal","kpi","ms":[{"code":"M1","name","due"}],"history":[],"order":<숫자>}`

## 3. KPI 설정 — 트리 구조로

Goal 문장을 측정 가능한 지표로 분해한다. 상위 KPI → 하위 드라이버(subs) 트리이며,
프로젝트는 상위·하위 어느 노드에든 기여 연결할 수 있다.

| 항목 | 규칙 |
|---|---|
| area | 재무 / 사업 / 지속경영 중 하나 (서버가 강제) |
| code | 임의 작성 금지 — API가 `K##` 채번 (트윈 이식 KPI-\*·ND-\* 코드와 별도) |
| direction | `+`(높을수록 좋음) / `-`(낮을수록 좋음) / `~`(목표 근접) |
| target·unit·weight | 목표값·단위·영역 내 가중치(기본 1) |
| source | 데이터 출처. **미연동 지표는 연동 프로젝트를 만들도록 안내** (kpi.html의 ⛓미연동 규약) |

- 상위 KPI: `POST /api/kpi/save` `{area, name, unit, direction, target, weight, source}`
- 하위 지표: `POST /api/kpi/sub/save` `{parent:<상위 code>, name, group, unit, direction, target, weight, source}`
- 초기 측정값(있으면): `POST /api/kpi/measure` `{code, value, at}` — append-only
- 시드 정리: `POST /api/kpi/delete` `{code}` (연결된 프로젝트의 kpi도 서버가 해제)
- 파일 모드: `data/kpis/<코드>.json` — `{"code","area","name","unit","direction","target","weight":1,"source":"","measures":[],"subs":[],"order":<맨뒤>}` + `meta.json`의 `kpiSeq` +1

## 4. 원칙

- **Goal은 미완성이어도 등록한다** — draft로 시작해 프로젝트를 진행하며 구체화 (연 4분기 확정 사이클).
- **원문은 한 언어로만** 작성 (한국어 권장). `i18n` 필드는 직접 만들지 말고 `/translate` 스킬 안내.
- ID·코드·사람 이름은 번역·변형 금지. 서비스명은 항상 "AI/Data North Pole" 전체 표기.
- 프로젝트·스프린트·태스크·요청 등록은 이 스킬의 범위가 아니다 → `/ticket`으로 넘긴다.

## 5. 마무리 보고

등록 결과를 표로 보고한다: 부문(owner·status·마일스톤 수) / KPI(code·area·target·하위 수).
확인 화면: `/kpi.html`(KPI 모니터링), `/products.html`(Product & Goal).
다음 단계로 "`/ticket`으로 첫 프로젝트를 만들고 기여 KPI를 연결하라"고 안내한다.
git 커밋·push는 사용자가 요청할 때만 한다 (자동 커밋·push 기능 없음).
