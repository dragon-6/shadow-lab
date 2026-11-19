# 🌒 그림자 연구소 (SHADOW LAB) - Frontend

OpenCV 기반 실시간 실루엣 유사도 측정 게임 **"그림자 연구소(Shadow Lab)"**의 웹 프론트엔드 클라이언트입니다.  
별도의 무거운 프레임워크 없이 순수 브라우저 표준 기술(HTML5, Vanilla JS, ES6 Modules, Canvas API, WebSocket API)을 기반으로 구현되었습니다.

---

## 📁 디렉터리 구조

```text
그림자 연구소 Codes/
├── index.html               # 단일 화면 무스크롤(100vh) UI 마크업 및 스타일
├── README.md                # 프로젝트 안내 및 실행 가이드
└── js/
    ├── main.js              # 앱 진입점, 웹소켓 메시지 라우터 및 전역 이벤트 바인딩
    ├── core/                # [코어 모듈] 상태 관리, 소켓 통신, 타이머, 세션 복구
    │   ├── socket.js        # 웹소켓 연결, 메시지 송수신, 자동 재접속 관리
    │   ├── state.js         # 클라이언트 전역 상태 관리 (Session/Local Storage)
    │   ├── ticker.js        # 백그라운드 탭 스로틀링 방지용 Web Worker 타이머
    │   └── restore.js       # 재접속(RECONNECT_SUCCESS) 시 인게임 상태 복구
    ├── media/               # [미디어 모듈] 웹캠 캡처 및 실시간 영상 스트리밍
    │   ├── webcam.js        # 웹캠 권한 획득, 스트림 연결, 오프스크린 Canvas 캡처
    │   ├── streaming.js     # 10fps SEND_FRAME 송신 루프 및 카운트다운 타이머
    │   └── masked.js        # 마스킹 브로드캐스트 스트림 렌더링
    └── stages/              # [스테이지 모듈] 게임 진행 단계별 로직
        ├── screens.js       # 화면 전환 헬퍼 (Lobby / Game / Result / GameOver)
        ├── lobby.js         # 대기실, 닉네임 설정, 방장 옵션 설정, 게임 시작
        ├── game.js          # 라운드 시작 및 스트리밍 트리거
        ├── result.js        # 라운드 결과 점수 연출 및 ROUND_END_ACK 전송
        └── gameover.js      # 최종 순위 렌더링 및 게임 종료 처리
```

---

## 🚀 로컬 실행 방법 (중요)

본 프로젝트는 **ES6 모듈(`import / export`)**과 **웹캠 미디어 API(`getUserMedia`)**를 사용하므로, `index.html` 파일을 로컬 파일 시스템에서 직접 더블클릭(`file://`)하여 열면 브라우저 보안 정책(CORS 및 보안 컨텍스트)에 의해 정상 동작하지 않습니다. 반드시 로컬 웹 서버 환경에서 구동해야 합니다.

### 1. 로컬 웹 서버 실행

프로젝트 폴더(`그림자 연구소 Codes/`) 경로에서 터미널을 열고 아래 명령어 중 하나를 실행합니다.

* **Python 3 환경:**
  ```bash
  python -m http.server 3000
  ```
* **Node.js (`npx serve`) 환경:**
  ```bash
  npx serve -l 3000 .
  ```
* **VS Code 환경:**  
  `Live Server` 확장 프로그램을 설치한 후 `index.html` 우클릭 ➔ **Open with Live Server** 실행

### 2. 브라우저 접속

웹 브라우저를 열고 다음 주소로 접속합니다:
```text
http://localhost:3000
```

> **⚠️ 웹캠 접근 권한 주의사항**:  
> 브라우저 미디어 API 보안 정책상 웹캠 권한은 **`localhost`** 또는 **`HTTPS`** 환경에서만 정상 허용됩니다. 다른 PC에서 접속할 때도 로컬 환경에서 구동하거나 HTTPS 환경을 구축해야 합니다.

---

## 🌐 백엔드 서버 연결 설정

웹소켓 통신 주소는 `js/core/socket.js`에 설정되어 있으며, 코드 수정 없이 브라우저 URL 쿼리 파라미터를 통해 실시간 오버라이드가 가능합니다.

1. **기본 주소 설정**:
   * `js/core/socket.js` 파일 상단의 `DEFAULT_BACKEND_WS` 변수에서 기본 서버 주소를 설정합니다.
2. **URL 파라미터 오버라이드 (추천)**:
   * 코드를 직접 수정하지 않고 브라우저 주소창 뒤에 `?ws=` 파라미터를 붙여 접속 대상 서버를 즉시 변경할 수 있습니다:
     ```text
     http://localhost:3000/?ws=ws://[백엔드_IP]:8000/ws
     ```

---

## 🎮 게임 진행 흐름

1. **대기실 (Lobby)**
   * 접속 직후 서버로부터 고유 UUID를 발급받습니다 (`JOIN_REQ` ➔ `CONNECTED`).
   * 닉네임을 설정하면 유저 목록이 실시간으로 동기화됩니다 (`SET_NICKNAME` ➔ `ROOM_USERS_UPDATE`).
   * 웹캠 준비 상태를 서버와 확인합니다 (`CHECK_WEBCAM_REQ` ➔ `CHECK_WEBCAM_RES`).
   * 방장은 총 라운드 수 및 제한시간을 설정할 수 있으며, 조건(2~4인 준비 완료) 충족 시 게임을 시작합니다 (`UPDATE_GAME_OPTIONS`, `GAME_START_REQ`).
2. **인게임 (Game)**
   * 라운드가 시작되면 제시어를 확인합니다 (`ROUND_START`).
   * 스트리밍 시작 신호 수신 즉시 웹캠 화면을 `10fps (320x240)`로 캡처하여 서버로 전송합니다 (`START_STREAMING` ➔ `SEND_FRAME`).
   * 서버(OpenCV)에서 마스킹 처리된 참가자들의 실시간 실루엣 영상을 수신하여 화면에 렌더링합니다 (`BROADCAST_MASKED_STREAM`).
3. **라운드 결과 (Result)**
   * 프레임 전송 완료 후 대기 상태를 거쳐 서버 분석 점수(0~5점)를 화면에 표시합니다 (`FRAME_RECEIVED_WAIT` ➔ `ROUND_RESULT`).
   * 연출 완료 후 서버에 동기화 신호를 전송합니다 (`ROUND_END_ACK`).
4. **게임 종료 (Game Over)**
   * 설정된 모든 라운드가 끝나면 최종 순위 및 점수가 표시됩니다 (`GAME_OVER`).

---

## 🛡️ 안정성 및 예외 처리

* **무스크롤(No-Scroll) 반응형 레이아웃**: `100vh` 단일 화면 고정 레이아웃으로, 브라우저 창 크기에 맞춰 대기실, 플레이어 목록, 4인 마스킹 타일이 스크롤 없이 배치됩니다.
* **비정상 종료 및 재접속 (Reconnect)**: 연결이 끊기더라도 브라우저 스토리지를 활용해 10초 유예 시간 내 재접속 시 기존 UUID와 진행 상태를 복구합니다 (`RECONNECT_REQ` ➔ `RECONNECT_SUCCESS`).
* **백그라운드 탭 타이머 유지**: 탭이 비활성화되어 브라우저 스로틀링이 걸려도 Web Worker 기반 Ticker를 통해 스트리밍 프레임 드랍을 방어합니다.