# 순댕이 관리자

순댕이 본사이트와 분리해서 배포하는 관리자 사이트입니다.

## 기능

- 본사이트 `ADMIN_SECRET`으로 관리자 API 연결
- 신규 회원 승인/거절/대기 처리
- 전체 회원, 상품, 키워드 현황 확인
- 전체 순위 조회 실행
- 전체 7일 리포트 엑셀 다운로드
- 전체 7일 리포트 이메일 발송

## Render 설정

- Runtime: `Node`
- Build Command: 비워두기
- Start Command: `node server.js`

환경변수:

```txt
MAIN_APP_URL=https://soondaeng-live.onrender.com
```

관리자 화면에서 입력하는 비밀키는 본사이트 Render 환경변수 `ADMIN_SECRET` 값과 같아야 합니다.
