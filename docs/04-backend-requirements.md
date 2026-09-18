# 04. 백엔드 기능 요구사항 & API 스펙

## 1. 아키텍처 전제

- 기존 서비스(Digital Twin Manager)의 백엔드에 **`/api/northpole/*` 네임스페이스**로 편입.
- 인증·세션·사용자는 기존 서비스 것을 그대로 사용 (BR-000).
- 저장소: 기존 서비스와 같은 RDB(PostgreSQL 가정)에 `northpole` 스키마 분리.
- 첨부는 기존 오브젝트 스토리지 재사용.
- Git 연동은 webhook 수신 방식 (사내 GitHub/GitLab).

## 2. API 목록

공통: 인증 필수, 응답 JSON, 목록은 `?page,size,sort,q,filter…`, 표준 에러
`{code, message, field?}`.

### Product / Goal
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/northpole/products | 부문 목록 (+연도 파라미터로 해당 연도 Goal·마일스톤·프로젝트 요약 포함) |
| POST | /api/northpole/products | 부문 생성 (관리자) |
| GET | /api/northpole/products/{id}/goals?year= | 연도별 Goal |
| PUT | /api/northpole/goals/{id} | Goal 수정 — 변경 diff·사유를 goal_history에 자동 기록 |
| GET | /api/northpole/goals/{id}/history | 변경 이력 |
| POST | /api/northpole/goals/{id}/milestones | 마일스톤 생성 (PUT/DELETE 동일 계열) |

### KPI (전사 측정 지표 — 영역 소속, 부서 독립)

| Method | Path | 설명 |
|---|---|---|
| POST | /api/northpole/kpi/save | KPI 정의 생성/수정 `{area, code?, name, unit, direction, target?, weight, source?}` — area는 재무/사업/지속경영 검증(BR-063), code 없으면 `Kn` 전사 자동 채번(최대 번호+1, 삭제와 충돌 방지) |
| POST | /api/northpole/kpi/sub/save | 하위 지표 생성/수정 `{parent, code?, group, name, unit, direction, target?, weight, source?}` — code 없으면 `Kn-m` 자동 채번 |
| POST | /api/northpole/kpi/sub/delete | 하위 지표 삭제 — 연결 프로젝트 kpi_code 해제 후 삭제 |
| POST | /api/northpole/kpi/measure | 측정값 기록 `{code, value, at?, note?}` — KPI·하위 지표 공용(코드로 트리 탐색), value 숫자 검증(BR-060) |
| POST | /api/northpole/kpi/delete | KPI 삭제 — 하위 지표 포함, 부서 불문 연결 프로젝트의 kpi_code를 해제 후 삭제 |

달성률·신호등·영역 롤업(`kpiAreas`)·KPI별 기여 프로젝트/태스크 집계·**데이터 연동
상태(`dataState`: linked/in_progress/unlinked)**는 저장하지 않고 `/api/state` 응답에서
서버가 파생 계산한다(BR-061, BR-064). 프로젝트 생성/수정 API는 `kpi`(기여 KPI 또는
하위 지표 코드, **부서 무관**, 빈 값 허용)와 `kpiRole`(개선/연동, kpi 없으면 빈 값)을 받는다.

### Project
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/northpole/projects | 필터: product, priority, status, owner, q |
| POST | /api/northpole/projects | 생성. milestone_id·owner·priority 필수. origin_request_id 연결 시 요청 상태 `converted` 처리 |
| GET/PUT | /api/northpole/projects/{id} | 상세/수정. 상태를 on_hold/cancelled로 바꿀 때 reason 필수 |
| GET | /api/northpole/projects/{id}/tasks | 소속 태스크 |

### Sprint / Task
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET/POST | /api/northpole/sprints | 스프린트 목록/생성. 생성 시 이름 자동 채번(ISO 주차), 종료일 미지정 시 시작일+10영업일 |
| PUT | /api/northpole/sprints/{id} | 기간·상태 수정. `closed` 스프린트는 수정 거부(409). 변경 사유 필수, 이력 기록 |
| POST | /api/northpole/sprints/{id}/close | 종료 처리 `{carry_over: next_sprint\|backlog\|per_task, retro_note?}` — 미완료 태스크 일괄 이월(태스크의 carry_over_count 증가) 후 status=closed |
| GET | /api/northpole/sprints/{id}/board | 칸반용: 단계별 태스크 + 체류일 + 지연 플래그 |
| POST | /api/northpole/tasks | 생성. project, assignee, start/target_end, **deliverable 필수**. 응답에 git_branch 제안 포함 |
| GET/PUT | /api/northpole/tasks/{id} | 상세/수정 |
| POST | /api/northpole/tasks/{id}/stage-transitions | `{to_stage, note, direction: forward\|rollback\|skip, reason?}` — StageLog 기록, 마지막 단계 완료 시 task.status=done |
| GET | /api/northpole/tasks/{id}/timeline | ActivityLog 병합 타임라인 (커서 페이지네이션) |
| POST | /api/northpole/tasks/{id}/logs | 수동 로그 (첨부 포함 multipart) |

### Request (Intake)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/northpole/requests | 필터: channel, status, product. 응답에 처리 소요/경과 시간 계산값 포함 |
| POST | /api/northpole/requests | 등록. received_at은 클라이언트 지정(소급 허용) |
| GET/PUT | /api/northpole/requests/{id} | 상세/수정 |
| POST | /api/northpole/requests/{id}/return | 단순 리턴 완료 `{returned_at, note}` + 회신 첨부. 소요시간 확정 |
| POST | /api/northpole/requests/{id}/status | 상태 전이 `{to, reason?}` — 전이 규칙 검증(BR-022), 이력 자동 기록. `rejected`는 reason 필수 |
| POST | /api/northpole/requests/{id}/logs | 처리 이력 수동 기록 `{type: note\|reply_sent\|phone_reply\|meeting, body}` + 첨부 (ActivityLog parent=request) |
| POST | /api/northpole/requests/{id}/convert | `{to: task\|project\|product, payload}` — 생성 + 양방향 링크 + 상태 전환 |

### 첨부 / 통계
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/northpole/attachments | multipart 업로드 (parent_type/parent_id). 허용: .eml .msg .pdf .xlsx .docx .png 등, 최대 25MB |
| GET | /api/northpole/attachments/{id}/download | 서명 URL 발급 |
| GET | /api/northpole/stats/stage-duration?days=90&product= | 단계별 평균 소요·표본수 (v_stage_duration) |
| GET | /api/northpole/stats/bottlenecks | 체류 초과 태스크 (v_bottleneck_tasks) |
| GET | /api/northpole/stats/overview | 대시보드 KPI 5종 + 부문별 상태 분포 |
| GET | /api/northpole/stats/requests | 채널별 처리량·평균 소요 (v_request_throughput) |

### Git Webhook
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /api/northpole/webhooks/git | push 이벤트 수신 (서명 검증) |

## 3. 비즈니스 규칙

| ID | 규칙 |
|---|---|
| BR-000 | 인증/권한은 기존 서비스 상속. 조회는 전 사용자, 쓰기는 소속 확인, Goal 확정/Product 생성은 오너·관리자 |
| BR-010 | Task 생성 시 deliverable 빈 값 거부 (400) |
| BR-011 | Stage 전환은 인접 단계로만. rollback/skip은 reason 필수, StageLog에 event로 구분 기록 |
| BR-012 | 마지막 단계(service_dev) 완료 → task.status=done, 원천 요청이 있으면 "최종 리턴 필요" 플래그를 요청에 세움 |
| BR-015 | 스프린트 종료는 close API로만 가능. 미완료 태스크가 있으면 carry_over 지정 없이는 거부(422). 이월 시 task.carry_over_count += 1 |
| BR-020 | Request는 어떤 상태에서도 삭제 불가(반려만 가능) — 기록 보존 원칙 |
| BR-021 | returned_at ≥ received_at 검증. 처리 소요시간은 서버가 계산해 응답에 포함(클라이언트 계산 금지) |
| BR-022 | Request 상태 전이 규칙: received→reviewing→converted/returned/rejected. returned/rejected에서 재개는 reviewing으로만(사유 필수). rejected는 reason 필수. 모든 전이는 ActivityLog(type=status_change)로 기록 |
| BR-030 | 커밋 메시지에서 `\[DT-(\d+)\]` 패턴을 파싱해 ActivityLog 생성. 존재하지 않는 태스크 번호는 무시 + 관리 로그 |
| BR-031 | commit author email은 user_git_identity로 매핑, 미매핑 시 raw email 보존·"미매핑" 표시 |
| BR-032 | webhook은 멱등 처리 (같은 commit hash 중복 수신 시 무시) |
| BR-040 | 프로젝트 진행률 = done 태스크 / (cancelled 제외 전체). 마일스톤 진행률 = 소속 프로젝트의 태스크 수 가중 평균 |
| BR-041 | 단계 소요 영업일 계산은 주말·공휴일 제외 (공휴일 테이블 필요) |
| BR-050 | Goal UPDATE는 트리거/서비스 레이어에서 goal_history 강제 기록 |
| BR-060 | KPI 측정값은 숫자만 허용(400). 측정 이력은 삭제 불가(append-only), 측정일 기준 정렬 |
| BR-061 | KPI 달성률 = 방향 반영(`+` 실적/목표, `-` 목표/실적, `~` 1-\|실적-목표\|/목표), 0~1.3 클램프. 신호등 ≥0.98 good / ≥0.92 warn / 미만 crit / null na. 영역 점수 = 측정된 KPI만 가중 평균 — 모두 서버 파생 계산(클라이언트 계산 금지) |
| BR-062 | KPI 삭제 시 해당 code를 참조하는 **모든 부서의** 프로젝트 kpi_code를 먼저 해제 |
| BR-063 | KPI 영역은 재무/사업/지속경영만 허용(400). 프로젝트↔KPI 연결에 부서 제약을 두지 않는다 (부서간 협업 허용이 원칙) |
| BR-064 | 지표 데이터 연동 상태 파생: source 명시 → `linked`, 미연동이나 kpi_role=`연동` 프로젝트(완료 제외)가 존재 → `in_progress`, 그 외 → `unlinked`(데이터 연동 프로젝트 필수 — 화면 배너 강제 노출). 하위 지표 보유 KPI의 달성률은 측정된 하위 지표의 가중 롤업 |
| BR-065 | 프로젝트 impacts(사이드 이펙트)는 `{kpi, effect(+/−), note}` 배열로 저장. 수정 시 무변경 항목(원문 또는 기존 번역본과 동일)은 원문·i18n 사이드카를 보존 병합. 지표별 sideEffects·conflicts(진행중·계획 상태의 − 영향 수)는 서버 파생 계산 |

## 4. 알림 (Phase 2)

| 트리거 | 수신자 | 채널 |
|---|---|---|
| 단계 체류 평균 ×1.5 초과 | 담당자·프로젝트 오너 | 인앱 + 이메일 요약(일 1회) |
| 요청 대기 3일 초과 | 부문 오너 | 인앱 |
| 태스크 완료 & 최종 리턴 미기록 3일 | 담당자 | 인앱 |
| 스프린트 종료 D-2 미완료 태스크 존재 | 담당자 | 인앱 |

## 5. 데이터 마이그레이션 / 초기값

- Product 5건(Sales, Finance, Marketing, Product Planning, Service) 시드.
- Stage enum·공휴일 테이블 시드.
- 표시 코드 채번 시퀀스: PRJ, DT, REQ(연도별 리셋).

## 6. 감사·보존

- 모든 쓰기 API는 감사 로그(actor, ip, before/after) 기록 — 기존 서비스 감사 체계 재사용.
- Request·ActivityLog·StageLog·goal_history는 삭제 금지(soft delete도 불가), 보존 기한 없음 — 연간 회고의 원천 데이터.
