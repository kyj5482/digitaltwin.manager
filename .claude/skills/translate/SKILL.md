---
name: translate
description: AI/Data North Pole 이중 언어(한국어·영어) 번역 스킬. 사용자가 /translate를 실행하거나 "번역", "영어 지원", "translation"을 요청할 때 사용. 한국어로 작성된 데이터·문서는 영어로, 영어로 작성된 것은 한국어로 번역해 양방향 이중 언어를 유지한다.
---

# /translate — 이중 언어 번역 채우기

AI/Data North Pole은 UI·데이터·문서를 한국어/영어로 제공한다. 원문은 어느 언어로든
작성할 수 있고, 반대 언어 번역은 이 스킬이 채운다. 원문 언어는 텍스트의 한글 포함
여부로 자동 판별된다(한글 있음→한국어 원문→영어로 번역, 없음→영어 원문→한국어로 번역).

번역 아키텍처는 `docs/07-i18n.md` 참고. 세 영역을 순서대로 처리한다.

## 1. 데이터 (data/ 계층 티켓 파일 — 사용자 작성 콘텐츠)

⚠ `--apply`는 티켓 파일을 직접 고쳐 쓴다 — 서버가 떠 있으면 메모리와 어긋날 수
있으니 적용 전에 서버를 내리거나, 적용 후 서버를 재시작한다.

1. 미번역·낡은 번역 목록 추출:
   ```bash
   node scripts/i18n-scan.js --list
   ```
   각 항목: `{col, key, nested?, nkey?, field, from, to, src, stale}`.
   빈 배열이면 이 단계는 완료.

2. 각 항목의 `src`를 `to` 언어로 번역한다. 규칙:
   - 업무 도구의 짧은 레이블·제목이므로 간결하게. 존댓말 불필요.
   - 고유명사·ID·코드(`DT-101`, `PRJ-…`, `M1`, KPI 수치, 사람 이름)는 그대로 둔다.
     사람 이름의 한↔영 표기는 로마자 표기(예: 김유진 → Yujin Kim)로.
   - 도메인 용어 통일: 부문=department, 마일스톤=milestone, 이월=carry-over,
     리턴=return, 접수=received, 수주=order(s)/bookings(문맥), 단계=stage.
   - `stale: true`는 원문이 수정되어 기존 번역이 낡은 경우 — 새로 번역한다.

3. 결과를 임시 JSON 파일로 저장한다 — `--list` 출력의 각 항목에 `text` 필드(번역문)만
   추가한 배열 형태. 그리고 적용:
   ```bash
   node scripts/i18n-scan.js --apply /tmp/translations.json
   ```
   `skip` 경고가 나오면 해당 항목의 원문이 그새 바뀐 것 — `--list`부터 다시 실행.

4. 검증: `node scripts/i18n-scan.js --list` 가 `[]`를 출력해야 한다.
   서버가 떠 있으면 `curl -s "http://localhost:8788/api/state?lang=en"`으로
   번역 치환이 응답에 반영되는지 확인.

## 2. UI 문자열 사전 (public/assets/i18n-dict.js)

새 화면·기능이 추가되면 UI의 한국어 문자열이 사전에 없어 영어 모드에서 한국어로
남는다. 후보 추출:
```bash
node scripts/i18n-scan.js --ui
```
출력은 러프한 후보 목록이다(오탐 있음 — JS 주석, 코드 조각 등은 무시).
실제 사용자에게 보이는 문자열만 골라 `public/assets/i18n-dict.js`에 추가한다:
- 고정 문자열 → `exact`에 `"한국어": "English"` 항목
- 수치·이름이 끼는 동적 문자열 → `patterns`에 정규식 항목
  (상태·단계 같은 데이터 토큰이 그룹에 끼면 함수형 치환으로 `G(m[n])` 재번역)
추가 후 `node --check public/assets/i18n-dict.js`로 문법 확인.

## 3. 문서 (README.md, docs/*.md)

영어본이 없거나 원문보다 오래된 문서 확인:
```bash
node scripts/i18n-scan.js --docs
```
- `README.md` → 영어본 `README.en.md`
- `docs/<파일>.md` → 영어본 `docs/en/<파일>.md`
번역 시 상단에 원문 링크 한 줄을 넣는다: `> 한국어 원문: [<경로>](상대경로)`
원문(한국어) 문서 상단에도 영어본 링크가 없으면 추가: `> English: [<경로>](상대경로)`
마크다운 구조·코드 블록·표·FR/BR ID는 그대로 유지하고 산문만 번역한다.
문서 양이 많으면 항목별 서브에이전트로 병렬 번역해도 된다.

## 마무리

- 변경 파일을 요약 보고한다 (데이터 n건 / 사전 n항목 / 문서 n편).
- 커밋은 사용자가 요청할 때만.
