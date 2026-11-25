# 웹소켓 메시지 정리

> **기준 일시**: 2026년 11월 25일 11시  
> **버전**: `1.1`

### 1.1 ver 주요 변경 사항
1. `START_STREAMING`에 `topicFrameImageBase64` 항목이 추가됩니다.<br>
 `topicFrameImageBase64`은 클라이언트에서 `maskedImageBase64`와 합쳐져서 화면에 나오게 됩니다.

---

## 1. 공통 메시지 포맷

```json
{
  "type": "MESSAGE_TYPE",
  "senderUuid": "u-a1b2c3d4",
  "payload": {}
}
```

---

## 2. 전체 메시지 목록

### Client ➔ Server (8개)

| 메시지 타입 (`type`) | 설명 |
| :--- | :--- |
| [`JOIN_REQ`](#join_req) | 처음 room 접속 시 |
| [`RECONNECT_REQ`](#reconnect_req) | 재연결 시 (만료되지 않은 UUID 보유 시) |
| [`SET_NICKNAME`](#set_nickname) | 닉네임 설정 시 |
| [`CHECK_WEBCAM_RES`](#check_webcam_res) | 웹캠 가동 여부 응답 |
| [`UPDATE_GAME_OPTIONS`](#update_game_options) | 게임 설정 변경 (Host 권한) |
| [`GAME_START_REQ`](#game_start_req) | 게임 시작 요청 (Host 권한) |
| [`SEND_FRAME`](#send_frame) | 실시간 프레임 전송 |
| [`ROUND_END_ACK`](#round_end_ack) | 라운드 결과 화면 확인 |

### Server ➔ Client (12개)

| 메시지 타입 (`type`) | 설명 |
| :--- | :--- |
| [`CONNECTED`](#connected) | 연결 성공 (UUID 부여) |
| [`RECONNECT_SUCCESS`](#reconnect_success) | 재접속 성공 및 진행 상황 반환 |
| [`ROOM_USERS_UPDATE`](#room_users_update) | 유저 정보 업데이트 |
| [`CHECK_WEBCAM_REQ`](#check_webcam_req) | 웹캠 가동 확인 요청 |
| [`GAME_OPTIONS_UPDATED`](#game_options_updated) | 게임 설정 변경 업데이트 |
| [`ROUND_START`](#round_start) | 라운드 시작 (제시어 전달) |
| [`START_STREAMING`](#start_streaming) | 프레임 전송 시작 (프레임 규격 반환) |
| [`BROADCAST_MASKED_STREAM`](#broadcast_masked_stream) | 플레이어의 마스킹 프레임 반환 |
| [`FRAME_RECEIVED_WAIT`](#frame_received_wait) | 프레임 전송 종료 및 대기 요청 |
| [`ROUND_RESULT`](#round_result) | 라운드 결과 반환 |
| [`GAME_OVER`](#game_over) | 게임 종료 및 최종 결과 반환 |
| [`ERROR`](#error) | 연결, 재연결, 게임 시작 등에 대한 오류 |

---

## 3. 상세 메시지 규격

### Client ➔ Server

#### `JOIN_REQ`
```json
{
  "type": "JOIN_REQ",
  "senderUuid": null,
  "payload": {}
}
```

#### `RECONNECT_REQ`
```json
{
  "type": "RECONNECT_REQ",
  "senderUuid": "u-a1b2c3d4",
  "payload": {
    "prevUuid": "u-a1b2c3d4"
  }
}
```

#### `SET_NICKNAME`
```json
{
  "type": "SET_NICKNAME",
  "senderUuid": "u-a1b2c3d4",
  "payload": {
    "nickname": "그림자마스터"
  }
}
```

#### `CHECK_WEBCAM_RES`
```json
{
  "type": "CHECK_WEBCAM_RES",
  "senderUuid": "u-a1b2c3d4",
  "payload": {
    "webcamReady": true
  }
}
```

#### `UPDATE_GAME_OPTIONS`
```json
{
  "type": "UPDATE_GAME_OPTIONS",
  "senderUuid": "u-a1b2c3d4",
  "payload": {
    "totalRounds": 5,
    "playTimeSeconds": 20
  }
}
```

#### `GAME_START_REQ`
```json
{
  "type": "GAME_START_REQ",
  "senderUuid": "u-a1b2c3d4",
  "payload": {}
}
```

#### `SEND_FRAME`
```json
{
  "type": "SEND_FRAME",
  "senderUuid": "u-a1b2c3d4",
  "payload": {
    "currentRound": 1,
    "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
  }
}
```

#### `ROUND_END_ACK`
```json
{
  "type": "ROUND_END_ACK",
  "senderUuid": "u-a1b2c3d4",
  "payload": {
    "currentRound": 1
  }
}
```

---

### Server ➔ Client

#### `CONNECTED`
```json
{
  "type": "CONNECTED",
  "senderUuid": "SERVER",
  "payload": {
    "myUuid": "u-a1b2c3d4",
    "isHost": true
  }
}
```

#### `RECONNECT_SUCCESS`
```json
{
  "type": "RECONNECT_SUCCESS",
  "senderUuid": "SERVER",
  "payload": {
    "myUuid": "u-a1b2c3d4",
    "isHost": true,
    "gameState": "IN_GAME",
    "currentRound": 2,
    "totalRounds": 5,
    "playTimeSeconds": 20,
    "topic": "토끼",
    "roundPhase": "STREAMING",
    "remainingSeconds": 14,
    "users": [
      { "uuid": "u-a1b2c3d4", "nickname": "그림자마스터", "isHost": true, "isConnected": true, "webcamReady": true }
    ],
    "roundScores": { "u-a1b2c3d4": 4.5 },
    "accumulatedScores": { "u-a1b2c3d4": 4.5 }
  }
}
```

#### `ROOM_USERS_UPDATE`
```json
{
  "type": "ROOM_USERS_UPDATE",
  "senderUuid": "SERVER",
  "payload": {
    "users": [
      { "uuid": "u-a1b2c3d4", "nickname": "그림자마스터", "isHost": true, "isConnected": true, "webcamReady": true },
      { "uuid": "u-e5f6g7h8", "nickname": "초보자", "isHost": false, "isConnected": true, "webcamReady": false }
    ]
  }
}
```

#### `CHECK_WEBCAM_REQ`
```json
{
  "type": "CHECK_WEBCAM_REQ",
  "senderUuid": "SERVER",
  "payload": {}
}
```

#### `GAME_OPTIONS_UPDATED`
```json
{
  "type": "GAME_OPTIONS_UPDATED",
  "senderUuid": "SERVER",
  "payload": {
    "totalRounds": 5,
    "playTimeSeconds": 20
  }
}
```

#### `ROUND_START`

```json
{
  "type": "ROUND_START",
  "senderUuid": "SERVER",
  "payload": {
    "currentRound": 1,
    "totalRounds": 5,
    "topic": "토끼"
  }
}
```

#### `START_STREAMING`
```json
{
  "type": "START_STREAMING",
  "senderUuid": "SERVER",
  "payload": {
    "currentRound": 1,
    "playTimeSeconds": 20,
    "targetFps": 10,
    "width": 320,
    "height": 240,
    "topicFrameImageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUh..."
  }
}
```

#### `BROADCAST_MASKED_STREAM`
```json
{
  "type": "BROADCAST_MASKED_STREAM",
  "senderUuid": "SERVER",
  "payload": {
    "targetUuid": "u-a1b2c3d4",
    "maskedImageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUh..."
  }
}
```

#### `FRAME_RECEIVED_WAIT`
```json
{
  "type": "FRAME_RECEIVED_WAIT",
  "senderUuid": "SERVER",
  "payload": {
    "message": "영상 분석 진행 중입니다."
  }
}
```

#### `ROUND_RESULT`
```json
{
  "type": "ROUND_RESULT",
  "senderUuid": "SERVER",
  "payload": {
    "currentRound": 1,
    "roundScores": {
      "u-a1b2c3d4": 4.5,
      "u-e5f6g7h8": 3.0
    }
  }
}
```

#### `GAME_OVER`
```json
{
  "type": "GAME_OVER",
  "senderUuid": "SERVER",
  "payload": {
    "finalScores": {
      "u-a1b2c3d4": 22.5,
      "u-e5f6g7h8": 15.0
    },
    "rankings": [
      { "rank": 1, "uuid": "u-a1b2c3d4", "nickname": "그림자마스터", "score": 22.5 },
      { "rank": 2, "uuid": "u-e5f6g7h8", "nickname": "초보자", "score": 15.0 }
    ]
  }
}
```

#### `ERROR`
> 입장, 재접속, 게임 시작 등 요청 실패 통합 (`RECONNECT_FAIL` 등 기존 개별 실패 타입 대체)  
> 서버에서 에러 코드(`code`)와 사용자 안내용 상세 문구(`message`)를 함께 반환합니다.

```json
{
  "type": "ERROR",
  "senderUuid": "SERVER",
  "payload": {
    "code": "ROOM_FULL",
    "message": "방 정원이 가득 찼습니다."
  }
}
```

**기존 에러 코드 변경 사항**
- ~~`RECONNECT_FAIL`~~ (**삭제** — `ERROR` 타입으로 통합)
- `PREV_UUID_IS_NONE`: 재접속 요청 시 `prevUuid` 누락
- `EXPIRED_SESSION`: 세션 만료 또는 존재하지 않는 UUID

**신규 추가된 에러 코드**
- `INVALID_FORMAT`: 잘못된 JSON 구조 또는 필수 필드 형식 오류
- `UNAUTHORIZED`: 등록되지 않았거나 만료된 `senderUuid`
- `UNKNOWN_TYPE`: 정의되지 않은 메시지 `type`
- `ROOM_FULL`: 방 정원(4명) 초과
- `GAME_IN_PROGRESS`: 이미 게임이 진행 중일 때 입장 시도
- `NOT_READY`: 인원 부족(2인 미만) 또는 미준비 유저 존재
- `NOT_PERMISSION`: 권한 부족 (방장이 아닌 유저의 옵션 변경·게임 시작 요청)
- `DENIED`: 비정상적인 입력값 또는 현재 게임 진행 단계에 맞지 않는 요청