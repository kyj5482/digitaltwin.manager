# 06. 브랜드 아이덴티티 — AI/Data North Pole

<img src="../public/assets/logo-wordmark.svg" alt="AI/Data North Pole" width="300">

## 1. 네이밍

| 구분 | 표기 | 용도 |
|---|---|---|
| 제품명 | **AI/Data North Pole** | 공식 명칭 — 문서, 발표, 외부 보고, 화면 타이틀 |
| 락업(2줄) | AI/DATA (윗줄) + North Pole (아랫줄) | 사이드바 등 좁은 공간의 로고 락업 |

줄임말(예: 약어로 된 조직·방법론 명칭)은 제품명·문서에 쓰지 않는다.
필요한 개념은 풀어서 쓴다 — 예: "데이터 기반 의사결정(Data-driven Decision Making)".

**의미** — 북극성은 위치가 변하지 않아 누구나 같은 기준으로 방향을 잡는 별이다.
AI/Data North Pole은 AI/Data TFT의 목표(Goal)와 진행 상황을 조직 전체가
**같은 기준점으로, 투명하게** 확인하는 곳이라는 뜻을 담는다.

## 2. 로고

| 파일 | 용도 |
|---|---|
| `public/assets/logo.svg` | 앱 마크 — 사이드바, 파비콘, 아이콘 단독 사용 |
| `public/assets/logo-wordmark.svg` | 워드마크 — README, 발표 자료, 문서 헤더 |

**모티프** — 4방위 나침반 별(북극성). 북쪽 광선을 다른 방향보다 길게 뻗어
"기준 방향"을 강조하고, 주변의 크고 작은 점들은 별을 향해 정렬되는
**데이터 포인트**를 상징한다.

**색** — 배경 `#2a78d6` (서비스 액센트 `--accent`와 동일, `docs/05-design-guide`
검증 팔레트의 시리즈1 blue), 심볼 `#ffffff`.
워드마크의 "AI/DATA" 아이브로우는 액센트 블루, "North Pole"은
라이트 `#0b0b0b` / 다크 `#ffffff` (미디어 쿼리 자동 전환).

**사용 규칙**
- 마크는 자체 라운드 사각 배경을 포함하므로 별도 배경·테두리를 덧대지 않는다.
- 최소 크기: 마크 16px(파비콘), 워드마크 폭 180px.
- 색 변형 금지 — 액센트 색을 바꿀 때는 `:root` 토큰과 로고 SVG를 함께 교체한다.

## 3. 표기 규칙

- 사이드바 브랜드: 마크 + `AI/DATA`(아이브로우, 액센트색) + `North Pole`(볼드)
- 페이지 타이틀: `{화면명} — AI/Data North Pole`
- 브레드크럼: `AI/Data North Pole / {화면명}`
- 서버 기동 배너: `AI/Data North Pole ▶ http://localhost:{port}`
- API 네임스페이스·라우팅·스키마 등 코드 식별자: `northpole`
  (예: `/api/northpole/*`, `northpole` 스키마)
