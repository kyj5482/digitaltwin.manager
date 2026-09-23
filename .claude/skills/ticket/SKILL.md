---
name: ticket
description: AI/Data North Pole 티켓(Request·Project·Sprint·Task·KPI) 생성·업데이트 스킬. 사용자가 /ticket을 실행하거나 "티켓 만들어", "태스크 등록", "프로젝트 생성", "요청 접수", "스프린트 시작/종료", "KPI 측정값 기록" 등을 요청할 때 사용. 사용자의 자연어 요구를 올바른 티켓 타입·계층·필드로 변환해 등록한다.
---

# /ticket — 클로드 코드로 티켓 작성하기

AI/Data North Pole의 티켓은 **1건 = 파일 1개**로 `data/` 아래 계층 구조에 저장된다
(레이아웃·규칙: `store.js` 상단 주석, 워크플로: `docs/09-ticket-guide.md`).
이 스킬은 사용자의 요구를 티켓으로 변환해 등록하고, 결과(ID·경로·화면 링크)를 보고한다.

## 0. 쓰기 경로 결정 — 가장 먼저 확인

```bash
PORT=$(node -p "require('./config.json').port")
curl -s -m 2 "localhost:$PORT/api/state?lang=ko" > /dev/null && echo "서버 ON — API 모드" || echo "서버 OFF — 파일 모드"
```

- **서버 ON → 반드시 API로만 쓴다.** 서버가 db를 메모리에 들고 있어, 실행 중 파일을
  직접 고치면 다음 저장 때 덮여 사라진다.
- **서버 OFF → 파일 모드**: 티켓 파일을 직접 쓰고 `data/meta.json` 시퀀스를 올린다(3장).
- 어느 모드든 ID는 임의로 짓지 말 것 — API는 서버가 채번, 파일 모드는 meta.json이 기준.

## 1. 사용자 요구 → 티켓 타입 판별

| 사용자가 말하는 것 | 티켓 | 판별 힌트 |
|---|---|---|
| "…팀에서 …해달라고 한다", 문의·의뢰 | **Request** | 외부에서 들어온 일은 무조건 Request부터 (기록 원칙) |
| "…분석/자동화/모델 과제를 시작하자" | **Project** | 여러 스프린트가 필요한 덩어리. 기여 KPI를 반드시 물어 연결 |
| "다음 스프린트 준비/시작/종료" | **Sprint** | 프로젝트당 진행중 1개 규칙 |
| "…작업 추가해줘", 할 일 단위 | **Task** | 소속 프로젝트·스프린트(또는 백로그) 필요 |
| "지표 등록/측정값 기록" | **KPI / 측정** | 측정값은 append-only |

빠진 필드는 곧바로 묻지 말고 **먼저 등록된 Product & Goal·KPI 데이터에서 자동
채움(1.5장)을 시도**한다. 그래도 못 채우는 필수 정보(담당자, 소속 프로젝트,
기여 KPI 등)만 사용자에게 묻는다 — 근거 없는 추측은 금지.
우선순위(P1)·마일스톤(M1)·시작일(오늘)은 관례 기본값 사용 가능.

## 1.5 자동 채움 — KPI·Product & Goal에서 나머지 필드 유추

`/setup`으로 등록한 데이터가 자동 채움의 원천이다. 서버 ON이면 `GET /api/state`,
OFF면 `data/products/*.json`·`data/kpis/*.json`을 읽는다. 사용자가 KPI(또는 부문)만
말해도 프로젝트 티켓의 나머지를 이렇게 채운다:

| 필드 | 유추 규칙 |
|---|---|
| `dept` | 지목된 KPI에 기여 중인 기존 프로젝트들의 부문, 또는 Goal·`kpi` 요약 문장에 해당 지표가 언급된 부문 |
| `owner` | 해당 부문 product의 `owner` (프로젝트 담당자를 따로 말하지 않았을 때 제안값) |
| `ms` | 부문 마일스톤 중 프로젝트 목적과 맞고 `due`가 프로젝트 기간을 덮는 것 |
| `kpiRole` | KPI `source`가 미연동이면 "연동", 이미 연동·측정 중이면 "개선" |
| `start`·`end` | 오늘 · 선택한 마일스톤의 `due` 분기 말일 |
| `impacts` | `docs/08-kpi-bp-catalog.md`의 상충 패턴(예: 인센티브 절감 ↔ 판매량) 참고해 후보 제시 |

자동 채움한 값은 **확정으로 단정하지 말고 근거와 함께 제시**해 사용자 확인 후
등록한다 (예: "dept=Sales — KPI-ASP 기여 프로젝트가 모두 Sales 소속"). 후보가
여럿이거나 근거가 약하면 그때 묻는다.

## 2. API 모드 (서버 실행 중 — 표준 경로)

`docs/09-ticket-guide.md` 3장의 curl 예시를 그대로 사용한다. 요약:

| 작업 | 엔드포인트 | 필수 필드 |
|---|---|---|
| 요청 접수 | `POST /api/request/create` | title, requester (+channel, dept, note) |
| 요청 리턴/전환 | `POST /api/request/return` · `/convert` | id / id, to:"project"·projectId, owner |
| 프로젝트 생성 | `POST /api/project/create` | name, dept, owner (+kpi, kpiRole:연동·개선, impacts[], ms, prio, start, end) |
| 프로젝트 수정 | `POST /api/project/update` | id (+변경 필드) |
| 스프린트 생성/시작/종료 | `POST /api/sprint/create` · `/start` · `/close` | projectId / sprintId / sprintId, carry:"next"·"backlog", retro |
| 태스크 생성 | `POST /api/task/create` | projectId, title, owner (+sprintNo — 없으면 백로그, due, deliverable) |
| 태스크 진행/이동 | `POST /api/task/advance` · `/move` | id (+note 산출물) / id, stage (되돌림은 reason 필수) |
| KPI 정의/하위/측정 | `POST /api/kpi/save` · `/sub/save` · `/measure` | area·name / parent·name / code·value |

서버가 강제하는 규칙(409·400 에러)은 `docs/09-ticket-guide.md` 4장 표 참고.
에러가 나면 규칙 위반을 사용자에게 설명하고 대안(예: 진행중 스프린트 먼저 종료)을 제시.

## 3. 파일 모드 (서버 정지 시 — 직접 작성)

1. `data/meta.json`을 읽어 해당 시퀀스를 +1 하고 저장한다:
   `taskSeq`(→`DT-###`) · `projectSeq`(→PRJ 디렉터리 번호) · `reqSeq`(→`REQ-YYYY-###`) · `kpiSeq`(→`K##`)
2. 티켓 파일을 계층 위치에 쓴다 (경로의 PRJ는 3자리, S는 2자리 0패딩):

| 티켓 | 경로 | 최소 스키마 (JSON) |
|---|---|---|
| Request | `data/requests/REQ-2026-###.json` | `{"id","title","channel","requester","dept","status":"접수","note","createdAt":"YYYY-MM-DD","link":null}` |
| Project | `data/projects/PRJ-###/project.json` | `{"id":<숫자>,"name","dept","ms":"M1","owner","prio":"P1","status":"계획","start","end","kpi","kpiRole","impacts":[]}` |
| Sprint | `data/projects/PRJ-###/sprints/S-##.json` | `{"id":"<projectId>:<no>","projectId":<숫자>,"no":<숫자>,"name":"Sprint 2026-##","start","end","status":"planned","retro":""}` |
| Task | `data/projects/PRJ-###/tasks/DT-###.json` | `{"id":"DT-###","projectId":<숫자>,"sprintNo":<숫자·null>,"title","owner","stage":0,"due","done":false,"carry":0,"deliverable","stageAt":"YYYY-MM-DD","logs":[]}` |
| KPI | `data/kpis/<코드>.json` | `{"code","area":"재무·사업·지속경영","name","unit","direction":"+·-·~","target","weight":1,"source":"","measures":[],"subs":[],"order":<맨뒤 숫자>}` |

3. 정합성 체크리스트 — 파일 모드에서 서버 검증이 없으므로 직접 지킨다:
   - `projectId`·`sprintNo`가 실제 존재하는 프로젝트/스프린트를 가리키는가
   - 프로젝트의 `kpi` 코드가 `data/kpis/`에 존재하는가 (하위 지표 코드 포함)
   - 새 프로젝트에는 첫 스프린트(S-01, planned)를 함께 만든다 (서버 API와 동일 동작)
   - 진행중(active) 스프린트를 프로젝트당 2개 만들지 않는다
   - 상태·단계 토큰은 한국어 원문 그대로: 계획/진행중/보류/완료, 접수/리턴/전환/반려
4. 검증: 서버를 켜고 `curl -s localhost:$PORT/api/state?lang=ko`에 티켓이 나오는지 확인.
   서버가 곧바로 트리를 다시 저장하며 포맷을 정규화한다.

## 4. 작성 원칙 (모드 공통)

- **계층에서 출발**: 모든 일은 Request 또는 KPI에서 시작한다. 프로젝트를 만들 때
  기여 KPI(`kpi`)와 기여 유형(`kpiRole`: 연동/개선)을 연결하고, 다른 지표를 희생시킬
  수 있으면 `impacts:[{kpi,effect:"-",note}]`로 상충을 선언한다.
- **분해 요청 처리**: "이 프로젝트 태스크로 쪼개줘" 류의 요청은 ① 6단계(Intake 협의→
  데이터 준비→EDA→모델링→파이프라인→서비스 개발)를 참고해 태스크 목록 초안을 만들고
  ② 사용자에게 목록을 보여 확인받은 뒤 ③ 일괄 생성한다. 태스크마다 `deliverable`
  (산출물 정의)을 채운다.
- **원문은 한 언어로만** 작성한다 (한국어 권장). `i18n` 필드를 직접 만들지 말 것 —
  생성 후 "번역은 `/translate` 스킬로 채울 수 있다"고 안내한다.
- **ID·코드·사람 이름은 번역·변형 금지**. 서비스명은 항상 "AI/Data North Pole" 전체 표기.

## 5. 마무리 보고

생성·변경한 티켓을 표로 보고한다: ID · 타입 · 제목 · 파일 경로 · 확인 화면
(`/projects.html`, `/sprint.html?project=ID`, `/requests.html`, `/kpi.html`).
커밋은 사용자가 요청할 때만 — 단, `data/`는 매일 자동 커밋된다는 점을 알린다.
태스크 관련 코드 작업 시 커밋 메시지에 `[DT-###]`를 넣으면 활동 로그에 자동 연결된다.
