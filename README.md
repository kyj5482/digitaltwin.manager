<img src="public/assets/logo-wordmark.svg" alt="AI/Data North Pole" width="300">

# AI/Data North Pole — 진행 관리·투명 공유 허브

**AI/Data North Pole**은 AI/Data TFT에서 진행되는 모든 일을 한 곳에서 관리하고
조직 전체에 투명하게 공유하기 위한 실행형 서비스다. 북극성처럼 모두가 같은
기준점으로 목표와 진행 상황을 확인한다는 뜻을 담았다.
(네이밍·로고 규칙: [docs/06-brand.md](docs/06-brand.md))

회사를 데이터 기반 의사결정(Data-driven Decision Making) 조직으로 전환하기 위한
Product(부문) → Goal → Milestone → Project → Sprint → Task(6단계 파이프라인) 관리 도구이며,
기존 서비스(Digital Twin Manager)의 세부 메뉴로 편입한다.

- **한국어·영어 이중 언어** — 상단바 버튼으로 전환. 원문은 어느 언어로 작성해도 되고,
  반대 언어 번역은 `/translate` 클로드 스킬이 채운다 ([docs/07-i18n.md](docs/07-i18n.md))
- 외부 패키지 의존성 **0** — Node.js 내장 모듈만 사용 (`npm install` 불필요)
- 데이터는 **티켓 1건 = 파일 1개**의 계층 트리(`data/`) — 로컬 git이 백업·이력 수단.
  디렉터리가 곧 계층: `projects/PRJ-###/{project.json, sprints/, tasks/}` (레이아웃: `store.js`)
- 최초 셋업은 `/setup` 클로드 스킬로 — clone 후 부문(Product)·Goal 선정과 KPI 트리 설정
- 티켓 작성은 `/ticket` 클로드 스킬로 — 자연어 요구를 올바른 티켓 타입·계층·필드로 변환해
  등록하고, 등록된 KPI·Product & Goal 데이터에서 나머지 필드를 자동 채움
- 첫 실행 시 검토용 시드 데이터가 자동 생성된다
- 자동 git 커밋·push 기능은 **없다** — 데이터 커밋·push 여부와 시점은 전적으로 운영자가
  수동으로 결정한다 (원격 저장소로 데이터가 자동 전송되지 않는다)

## 1. 실행

사전 준비: Git, Node.js LTS(18+).

```bash
node server.js
#  → AI/Data North Pole ▶ http://localhost:8788
```

브라우저에서 `http://localhost:8788` 접속. 포트는 `config.json`의 `port`로 변경한다.

## 2. 화면

| 경로 | 화면 |
|---|---|
| `/` | 대시보드 — KPI, 단계별 소요시간, 부문별 진행 파이프라인(진행중·계획 스냅숏 — 완료 누적 제외), 병목, 최근 활동 |
| `/kpi.html` | KPI 모니터링 — **트윈(digitaltwin.retail.vehicle) 실질 KPI 트리 이식**(`data/governance/ceo_tree.csv` 정본): 3영역(재무 37·사업 35·지속경영 25) × 14 KPI(ASP, 경상이익률, 합산손익 등) × 하위 드라이버 노드, 이 지표들을 기반으로 하위 프로젝트 생성·연결. AI/Data 과제 지표(K1~K7)도 실질 KPI 하위에 매칭(예: 월 결산 소요일→경상이익률). 지표마다 **데이터 연동 상태**(⚡연동/◌진행중/⛓미연동 — 미연동은 연동 프로젝트 필수, 트윈 bind 규약), 달성률 신호등(자체 실측 우선·하위 롤업 폴백), **끊김 없는 계층 추적**([▾ 세부] — KPI → 하위 지표 → 프로젝트(기여 유형 ⚡연동/▲개선) → 진행중 스프린트 → 태스크 인라인), **상충 관리**(프로젝트가 다른 지표에 미치는 영향 ± 선언 → ⇄ 가드레일 배지·상충 테이블), 미측정·미연결·미연동·상충 관리 배너 |
| `/products.html` | Product & Goal — Goal 편집(변경 사유 필수), 마일스톤 추가/수정/삭제([⋯] 행 메뉴), 마일스톤 클릭 → 관련 프로젝트 |
| `/projects.html` | 프로젝트 목록·생성 (생성 시 첫 스프린트 자동 준비, 기여 KPI 연결) — 이름 클릭 → 스프린트 보드 |
| `/sprint.html?project=ID` | 스프린트 보드 — 프로젝트 스코프, 스프린트 다중 선택, 생성/시작/종료(미완료 이월·↻ 횟수 누적), 태스크 생성·단계 이동 |
| `/requests.html` | 요청 Intake — 채널별 요청 등록, 단순 요청 ↩리턴, 분석 요청 →전환(새 프로젝트 / 백로그 태스크), 행별 [⋯] 수정·삭제 |

## 3. API 요약

`GET /api/state`
`POST /api/goal/save` · `POST /api/milestone/save|delete` · `POST /api/kpi/save|measure|delete` · `POST /api/kpi/sub/save|delete`
`POST /api/project/create`
`POST /api/sprint/create|start|close` · `POST /api/task/create|advance`
`POST /api/request/create|update|delete|convert|return`

비즈니스 규칙: 프로젝트당 진행중 스프린트 1개, 스프린트 종료 시 미완료 태스크는
다음 스프린트 이월(횟수 누적) 또는 백로그 이동, 마일스톤 진행률은 소속 프로젝트
태스크 완료율의 가중 평균으로 서버가 계산.

## 4. 핵심 개념

- **부문 = Product**: Sales / Finance / Marketing / Product Planning / Service.
  각 부문은 연도별 Goal을 갖고, Goal은 미완성(초안)이어도 등록해 프로젝트를
  진행하며 구체화한다.
- **Task 6단계**: Intake 협의 → 데이터 준비 → EDA → 모델링 → 파이프라인 →
  서비스 개발. 단계 전환이 자동 로깅되어 병목 분석의 원천이 된다.
- **요청은 전부 기록**: 이메일/전화/회의/요청서 무엇이든 Request로 등록.
  단순 회신도 리턴 일시·소요 시간을 남겨 보이지 않는 업무량을 데이터화한다.
- **Git이 1차 로그**: 커밋 메시지 `[DT-###]` 규약으로 태스크 활동 로그에 자동 연결.

## 5. 문서

| 문서 | 내용 |
|---|---|
| [docs/01-vision-and-goals.md](docs/01-vision-and-goals.md) | 빅픽처, 부문=Product 모델, Goal 연간 구체화 사이클, 운영 원칙 |
| [docs/02-data-model.md](docs/02-data-model.md) | ERD, 엔티티 정의, 상태 머신, Git 로깅 규약, 집계 뷰 |
| [docs/03-frontend-requirements.md](docs/03-frontend-requirements.md) | 화면별 기능 요구사항 (FR-###), 비기능 요구사항 |
| [docs/04-backend-requirements.md](docs/04-backend-requirements.md) | API 스펙, 비즈니스 규칙 (BR-###), webhook, 알림 |
| [docs/05-design-guide.md](docs/05-design-guide.md) | 디자인 토큰, 컴포넌트 규칙, 차트 규칙, 접근성 |
| [docs/06-brand.md](docs/06-brand.md) | 네이밍, 로고, 표기 규칙 |
| [docs/07-i18n.md](docs/07-i18n.md) | 한국어·영어 이중 언어 아키텍처, /translate 스킬 워크플로 |
| [docs/08-kpi-bp-catalog.md](docs/08-kpi-bp-catalog.md) | 미국 자동차 판매법인 BP 기반 KPI 분해·프로젝트 카탈로그 (J.D. Power CSI/SSI 드라이버, NADA·NHTSA·리드 응답 15분 룰) |
| [docs/09-ticket-guide.md](docs/09-ticket-guide.md) | 티켓 생성·운영 가이드 — 데모 데이터 구조, Request→Project→Sprint→Task 실동작 워크플로, API 예시, 데모→실운영 전환 |

`prototype/`는 Phase 0에서 화면·데이터 구조 확정용으로 검토한 정적 HTML이다
(빌드·서버 없이 브라우저로 열람). 실행형 서비스가 이를 대체하며, 기록용으로 보존한다.

## 6. 데이터 저장 구조·초기화

티켓은 파일 1개씩 계층 디렉터리에 저장된다 (구버전 단일 `data/db.json`은 서버가
최초 1회 자동 이관하고 `db.json.migrated`로 보존):

```
data/
  meta.json                      시퀀스·스키마 버전 (ID 채번 기준)
  products/<부문명>.json         Goal·마일스톤·변경 이력 포함
  kpis/<코드>.json               하위 지표(subs) 트리 포함
  projects/PRJ-###/project.json  + sprints/S-##.json + tasks/DT-###.json
  requests/REQ-YYYY-###.json
  files/                         첨부파일
```

초기화: `data/`의 `meta.json`과 티켓 디렉터리들을 지우고 서버를 재시작하면 시드
데이터로 다시 시작한다 (git 이력에 남아 있으므로 언제든 복원 가능).
⚠ 서버 실행 중에는 파일을 직접 수정하지 말 것 — 서버 메모리가 덮어쓴다. API 또는
서버 정지 후 파일 편집(`/ticket` 스킬이 자동 판별)을 사용한다.
