# StockScore AI 로컬 실행 폴더

Node.js 20 이상이 필요합니다. npm 패키지 설치는 필요하지 않습니다.

## Windows PowerShell에서 실행

```powershell
Copy-Item .env.example .env
npm start
```

그 뒤 브라우저에서 http://localhost:3000 을 엽니다. 샘플 종목 데이터는 없습니다. 서버는 SEC 공시 데이터를 조회하며, Toss 자격증명이 없으면 현재가와 밸류에이션은 비어 있습니다.

현재 데이터 모드는 `live`입니다. Toss Securities Open API의 `client_id`와 `client_secret`을 `.env`에 설정하면 현재가를 추가로 조회합니다. SEC 공개 API는 API 키 대신 실제 연락처가 포함된 `SEC_USER_AGENT` 값을 사용합니다. 자격 증명은 브라우저 코드가 아닌 `.env`에만 둡니다.

## 주요 파일

- `package.json`: 실행 스크립트 (`npm start`)
- `server.mjs`: 로컬 API 서버
- `index.html`: 서버와 연동되는 웹앱
- `.env.example`: 환경 설정 템플릿


SEC 공시에는 사업 요약/해자 분석이 포함되지 않으므로 해당 항목은 비워 둡니다. LLM 요약 기능은 아직 연결하지 않았습니다.
