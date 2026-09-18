# 09. 티켓 생성·운영 가이드 — 데모 데이터 기반 실동작

이 문서는 AI/Data North Pole의 **티켓(Request · Project · Sprint · Task · KPI 측정)을
현재 구조 그대로 생성·업데이트해 실제로 동작시키는 방법**을 정의한다.
데모 버전이지만 화면은 정적 HTML이 아니라 전부 서버 데이터로 렌더링되므로,
아래 절차대로 티켓을 만들면 대시보드·KPI 트리·병목 분석에 즉시 반영된다.
직접 작성하는 대신 **`/ticket` 클로드 스킬**에 자연어로 요청해도 된다
(스킬이 티켓 타입 판별 → API 또는 파일 작성 → 결과 보고까지 수행).

## 1. 전제 — 데모 데이터는 정적 화면이 아니다

```
시드 생성(server.js seed·migrateKpiV1~V7)          최초 1회, 데이터가 없을 때만
        ↓
data/ 계층 티켓 파일 트리                            티켓 1건 = 파일 1개 (store.js, git이 백업·이력)
  ├ meta.json · products/ · kpis/ · requests/
  └ projects/PRJ-###/{project.json, sprints/, tasks/}
        ↓
GET /api/state                                      서버가 트리를 조립해 파생값 계산 후 응답
        ↓
public/*.html                                       모든 화면이 이 응답만으로 렌더링
```

- 화면의 모든 숫자 — KPI 달성률·신호등, 프로젝트 진행률, 마일스톤 %, 단계별
  소요시간, 병목 — 는 **서버 파생 계산**이다(BR-040, BR-061, BR-064).
  화면에 하드코딩된 값은 없다.
- 따라서 티켓 하나를 생성·이동·완료하면 관련된 모든 집계가 다음 조회에서 바뀐다.
  예: 태스크 완료 → 프로젝트 진행률 ↑ → 마일스톤 % ↑ → 연결 KPI의 태스크 집계 ↑.
- 검증 방법: 아래 3장의 curl 한 줄을 실행하고 브라우저를 새로고침하면 된다.

> 포트는 `config.json`의 `port`(현재 8789)를 따른다. 이 문서의 예시는 8789 기준.
> [docs/04-backend-requirements.md](04-backend-requirements.md)의 `/api/northpole/...`
> 경로는 기존 서비스 편입 시의 목표 스펙이고, **현재 구현 경로는 `/api/...`** 이다.

## 2. 티켓 종류와 계층

```
Product(부문) ─ Goal(연간) ─ Milestone(M1·M2·…)
                                  └─ Project(PRJ, KPI 연결 필수)
                                        └─ Sprint(프로젝트당 진행중 1개)
                                              └─ Task(DT-###, 6단계)
Request(REQ-YYYY-###) ──리턴 또는──▶ Project / Task로 전환
KPI(K#·KPI-*·ND-*) ◀─ 프로젝트가 연동(⚡)/개선(▲)으로 기여, 측정값은 별도 기록
```

| 티켓 | ID 규칙 (자동 채번) | 생성 화면 | 생성 API |
|---|---|---|---|
| Request | `REQ-2026-###` (meta.reqSeq) | `/requests.html` | `POST /api/request/create` |
| Project | 숫자 id, 표시 `PRJ-###` (meta.projectSeq) | `/projects.html` | `POST /api/project/create` |
| Sprint | `프로젝트id:회차` | `/sprint.html?project=ID` | `POST /api/sprint/create` |
| Task | `DT-###` (meta.taskSeq) — **git 연동 키** | `/sprint.html` 보드 | `POST /api/task/create` |
| KPI / 하위 지표 | `K#` 수동 채번 · `KPI-*`/`ND-*` 트윈 코드 | `/kpi.html` | `POST /api/kpi/save`, `/api/kpi/sub/save` |
| KPI 측정값 | 지표 코드에 append-only | `/kpi.html` | `POST /api/kpi/measure` |

ID 채번 기준은 `data/meta.json`의 시퀀스다. API 사용 시 서버가 채번하고,
파일 직접 작성 시(서버 정지 상태 한정)에도 이 시퀀스를 올려서 쓴다 — 임의 ID 금지.
각 티켓 파일의 저장 위치는 2장 계층 다이어그램의 디렉터리를 따른다.

## 3. 표준 워크플로 — 티켓 하나를 끝까지 굴리기

모든 일은 **Request(요청) 또는 KPI(지표)에서 출발**한다. 아래는 요청 접수부터
태스크 완료·KPI 측정까지의 전체 사이클이며, 각 단계는 UI와 API 어느 쪽으로도 가능하다.

### ① 요청 접수 — 무엇이든 먼저 기록

```bash
curl -X POST http://localhost:8789/api/request/create -H 'Content-Type: application/json' \
  -d '{"title":"딜러 재고 리포트 자동화 문의","channel":"이메일","requester":"영업기획 김OO","dept":"Sales","note":"주간 수작업 4시간"}'
# → {"ok":true,"id":"REQ-2026-046"}
```

- 단순 요청이면 회신 후 **리턴**: `POST /api/request/return {id, note}` — 소요 이력이 남는다.
- 분석 과제면 **전환**: `POST /api/request/convert {id, to:"project", dept, owner}`
  (새 프로젝트 + 첫 스프린트 자동 생성) 또는 `{id, projectId, owner}` (기존 프로젝트 백로그 태스크로).

### ② 프로젝트 생성 — 기여 KPI 연결이 원칙

```bash
curl -X POST http://localhost:8789/api/project/create -H 'Content-Type: application/json' \
  -d '{"name":"딜러 재고 리포트 자동화","dept":"Sales","ms":"M2","owner":"김유진","prio":"P1",
       "kpi":"ND-DS","kpiRole":"개선",
       "impacts":[{"kpi":"KPI-RECUR","effect":"-","note":"초기 구축 비용"}]}'
# → {"ok":true,"id":36}   · 첫 스프린트(planned)가 자동 준비된다
```

- `kpi`: 기여할 KPI 또는 하위 지표 코드. `kpiRole`: `연동`(데이터 파이프라인 구축) / `개선`(지표 개선).
- **미연동(⛓) 지표에는 `연동` 프로젝트가 필수**로 이어져야 한다(BR-064) — `/kpi.html` 배너가 강제 노출.
- 다른 지표를 희생시키는 과제는 `impacts[]`로 **상충을 선언**한다(BR-065) — 가드레일 배지·상충 테이블에 반영.

### ③ 스프린트 시작

```bash
curl -X POST http://localhost:8789/api/sprint/start -H 'Content-Type: application/json' \
  -d '{"sprintId":"36:1"}'
```

프로젝트당 진행중(active) 스프린트는 1개만 허용 — 위반 시 409.

### ④ 태스크(DT-###) 생성

```bash
curl -X POST http://localhost:8789/api/task/create -H 'Content-Type: application/json' \
  -d '{"projectId":36,"sprintNo":1,"title":"딜러 재고 원천 데이터 적재 배치","owner":"김유진",
       "due":"2026-09-25","deliverable":"일배치 적재 파이프라인"}'
# → {"ok":true,"id":"DT-122"}
```

`sprintNo`를 생략(null)하면 백로그로 들어간다. `deliverable`(산출물 정의)은 목표 스펙상 필수(BR-010).

### ⑤ 단계 이동 — 병목 분석의 원천

Task는 6단계를 지난다: `Intake 협의 → 데이터 준비 → EDA → 모델링 → 파이프라인 → 서비스 개발`.

```bash
# 다음 단계로 (마지막 단계에서 호출하면 완료 처리)
curl -X POST http://localhost:8789/api/task/advance -H 'Content-Type: application/json' \
  -d '{"id":"DT-122","note":"필드 매핑 정의서"}'
# 보드 드래그&드롭과 동일한 지정 이동 — 오른쪽 한 칸만, 되돌림은 reason 필수
curl -X POST http://localhost:8789/api/task/move -H 'Content-Type: application/json' \
  -d '{"id":"DT-122","stage":0,"reason":"요건 재협의 필요"}'
```

전환마다 단계 체류일이 자동 로깅되고, 대시보드의 단계별 평균 소요시간·병목 표시가 이 로그에서 나온다(BR-011).

### ⑥ Git 커밋을 티켓에 연결

커밋 메시지에 `[DT-122]`를 넣으면 태스크 활동 로그에 자동 연결된다(BR-030).
브랜치 규약은 `feature/DT-122-<slug>`. 태스크 상세의 커밋 목록은
`GET /api/task/commits?id=DT-122`가 git log를 스캔해 보여준다.

### ⑦ 스프린트 종료 — 미완료는 반드시 이월 또는 백로그

```bash
curl -X POST http://localhost:8789/api/sprint/close -H 'Content-Type: application/json' \
  -d '{"sprintId":"36:1","carry":"next","retro":"적재 배치 완료, 검증 이월"}'
```

미완료 태스크는 다음 스프린트 이월(`carry:"next"`, ↻횟수 누적) 또는 백로그 이동 — 조용히 사라지는 태스크는 없다(BR-015).

### ⑧ KPI 측정값 기록 — 성과를 닫기

```bash
curl -X POST http://localhost:8789/api/kpi/measure -H 'Content-Type: application/json' \
  -d '{"code":"ND-DS","value":58,"at":"2026-10-31","note":"리밸런싱 1차 반영"}'
```

측정값은 append-only(BR-060). 달성률·신호등·영역 롤업은 서버가 다시 계산한다(BR-061).
연동(⚡) 지표는 향후 시스템이 자동 기록하는 것이 원칙이고, 이 API가 그 수기 대체 경로다.

## 4. 서버가 강제하는 규칙 (티켓 작성 시 겪게 되는 에러)

| 규칙 | 위반 시 |
|---|---|
| 프로젝트당 진행중 스프린트 1개 | 409 `이미 진행중인 스프린트가 있습니다` |
| 단계는 오른쪽 한 칸씩만, 건너뛰기 불가 | 400 `오른쪽 한 칸(다음 단계)으로만 이동할 수 있습니다` |
| 이전 단계 되돌림은 `reason` 필수 | 400 `이전 단계로 되돌리려면 사유가 필요합니다` |
| 완료된 태스크는 이동 불가 | 400 |
| Goal 수정은 변경 사유와 함께 이력 기록 | history 자동 append (BR-050) |
| Request 반려는 `reason` 필수, 삭제는 불가(리턴/반려만) | 400 (BR-020, BR-022) |
| KPI 영역은 재무/사업/지속경영만 | 400 (BR-063) |
| KPI 측정값은 숫자만 | 400 (BR-060) |
| KPI 삭제 시 연결 프로젝트의 kpi 코드 자동 해제 | 서버가 일괄 처리 (BR-062) |
| 첨부파일 10MB 이하 | 400 |

## 5. 데모 데이터 관리

### 초기화
`data/`의 `meta.json`과 티켓 디렉터리(products·kpis·projects·requests)를 지우고
서버를 재시작하면 시드가 다시 생성된다(kpiSchema v7까지 마이그레이션 자동 적용).
git 이력에 남아 있으므로 언제든 복원 가능. 구버전 단일 `db.json`이 남아 있으면
서버가 최초 1회 트리로 자동 이관한다(원본은 `db.json.migrated`로 보존).

### 시드 확장 (데모 시나리오 추가)
운영 중 티켓은 3장의 API 또는 `/ticket` 스킬로 만들되, **처음부터 깔린 데모
데이터**를 늘리려면 `server.js`의 마이그레이션 패턴을 따른다: `migrateKpiV8()`을
추가하고 `db.meta.kpiSchema` 버전을 검사해 **멱등하게** 시드를 주입한 뒤 버전을
올린다. 기존 데이터를 가진 환경도 재시작만으로 같은 데모 데이터를 받는다.

### 파일 직접 편집 규칙
티켓 파일은 사람이 읽고 고칠 수 있는 개별 JSON이지만, **서버 실행 중에는 직접
수정하지 않는다** — 서버가 메모리의 db를 다음 저장 때 그대로 다시 써서 변경이
사라진다. 파일 편집은 서버 정지 상태에서만 하고, `meta.json` 시퀀스·참조 정합성
체크리스트는 `.claude/skills/ticket/SKILL.md` 3장을 따른다.

### 데모 → 실운영 전환
1. `data/db.json` 삭제 후 재시작 — 또는 데모 위에 실데이터를 쌓다가 `[샘플]` 표기 레코드만 정리.
2. `/products.html`에서 실제 부문·Goal·마일스톤 등록 (`POST /api/product/create`, `/api/goal/save`, `/api/milestone/save`).
3. `/kpi.html`에서 실제 KPI 정의·데이터 소스 연결 → 미연동 지표마다 연동 프로젝트 생성.
4. 이후는 3장의 워크플로 그대로. `data/`는 매일 `config.json`의 `autoCommit.time`에 자동 커밋·푸시된다.

## 6. 이중 언어 — 티켓은 한 언어로만 쓰면 된다

티켓의 제목·메모·산출물은 한국어든 영어든 **원문 한 언어로만** 작성한다.
반대 언어 번역은 `/translate` 클로드 스킬이 `i18n` 사이드카에 채우며
(`node scripts/i18n-scan.js`로 미번역 필드 탐지), API 응답은 `?lang=`에 따라
치환된다. 티켓 생성 시 `i18n` 필드를 직접 만들지 않는다.
상세: [docs/07-i18n.md](07-i18n.md).
