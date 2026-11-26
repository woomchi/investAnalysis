# StockScore AI

Node.js 20 이상이 필요합니다. npm 패키지 설치는 필요하지 않습니다.

## 로컬 실행

```powershell
Copy-Item .env.example .env
npm start
```

그 뒤 브라우저에서 http://localhost:3000 을 엽니다. 샘플 종목 데이터는 없습니다. 서버는 SEC 공시 데이터를 조회하며, Toss 자격증명이 없으면 현재가와 밸류에이션은 비어 있습니다.

## Vercel 배포

저장소를 Vercel 프로젝트에 연결하고 기본 설정으로 배포하면 루트의 `index.html`이 정적 페이지로 제공되고 `api/` 아래 함수가 API를 처리합니다. `/api/health`와 `/api/analysis/[ticker]`는 Vercel Node.js Functions로 배포됩니다. 별도의 `PORT` 설정이나 `npm start` 실행은 필요하지 않습니다.

SEC API 요청에 사용할 실제 연락처가 포함된 `SEC_USER_AGENT`를 Vercel 프로젝트의 Environment Variables에 등록하세요. Toss 시세를 사용하려면 `TOSS_CLIENT_ID`와 `TOSS_CLIENT_SECRET`도 등록하고, 설정 변경 후 다시 배포해야 합니다. Toss 자격증명이 없어도 SEC 재무 데이터 분석은 가능합니다.

### 서버리스 함수 로그 확인

Vercel 프로젝트의 **Logs**에서 `scope: "stockscore-api"`로 필터링하세요. 각 요청은 `requestId`로 연결되며, `request_started` 다음의 `provider_request_started` / `provider_response_received` 항목으로 SEC 또는 Toss 요청의 진행과 HTTP 상태를 확인할 수 있습니다. 실패 응답의 JSON에도 `requestId`가 포함됩니다. 인증 토큰과 요청 헤더는 로그에 기록하지 않습니다.

현재 데이터 모드는 `live`입니다. Toss Securities Open API의 `client_id`와 `client_secret`을 `.env`에 설정하면 현재가를 추가로 조회합니다. SEC 공개 API는 API 키 대신 실제 연락처가 포함된 `SEC_USER_AGENT` 값을 사용합니다. 자격 증명은 브라우저 코드가 아닌 `.env`에만 둡니다.

## 주요 파일

- `package.json`: 실행 스크립트 (`npm start`)
- `server.mjs`: 공용 API 로직 및 로컬 API 서버
- `api/`: Vercel 서버리스 API 함수
- `index.html`: 서버와 연동되는 웹앱
- `.env.example`: 환경 설정 템플릿


SEC 공시에는 사업 요약/해자 분석이 포함되지 않으므로 해당 항목은 비워 둡니다. LLM 요약 기능은 아직 연결하지 않았습니다.
