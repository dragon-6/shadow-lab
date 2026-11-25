import asyncio
import uuid
import time
import random
from typing import Any, Dict, List, Optional
from enum import Enum

from game import Player 
from .scheduler import scheduler
from cv_module import CVModule
from network import ws_module

class GameManager:
    class GameState(Enum):
        IN_LOBBY = "IN_LOBBY"
        IN_GAME = "IN_GAME"

    class RoundPhase(Enum):
        WAITING = "WAITING"
        TOPIC_SHOW = "TOPIC_SHOW"
        STREAMING = "STREAMING"
        RESULT = "RESULT"
        TRANSITIONING = "TRANSITIONING"

    class Error(Enum):
        ROOM_FULL = "방 정원이 가득 찼습니다."
        GAME_IN_PROGRESS = "이미 게임이 진행 중입니다."
        PREV_UUID_IS_NONE = "이전 세션 정보가 없습니다."
        EXPIRED_SESSION = "만료되었거나 존재하지 않는 세션입니다."
        NOT_READY = "모든 플레이어가 준비되지 않았거나 인원이 부족합니다."
        NOT_PERMISSION = "권한이 부족합니다. 방장이 맞는지 확인해주세요."
        DENIED = "비정상적인 접근입니다. 새로고침을 권장합니다."

    MAX_PLAYERS = 4
    MIN_PLAYERS = 2
    LOBBY_TIMEOUT_SECONDS = 10

    def __init__(self):
        self.players: Dict[str, Player] = {}
        self.round_scores: Dict[str, float] = {}
        self.accumulated_scores: Dict[str, float] = {}

        self.Topic = Enum("Topic", CVModule.get_topics())
        self.topic = next(iter(self.Topic))
        self.topic_queue: List = []

        self.game_state = self.GameState.IN_LOBBY
        self.round_phase = self.RoundPhase.WAITING
        self.current_round = 0
        self.streaming_start_time = 0.0

        ## GAME SETTING
        self.total_rounds = 5
        self.play_time_seconds = 20

        ## FRAME SEIITNG
        self.target_fps = 10
        self.width = 320
        self.height = 240

    def get_users_list(self) -> List[dict]:
        return [p.to_dict() for p in self.players.values()]

    def update_host(self): # 접속상태에 따른 Host 최신화 (가장 빠른 접속)
        connected = [p for p in self.players.values() if p.is_connected]
        if connected and not any(p.is_host for p in connected):
            connected[0].is_host = True

    def _remove_player(self, uuid_str: str):
        scheduler.cancel(f"disconnect:{uuid_str}")
        self.players.pop(uuid_str, None)
        self.accumulated_scores.pop(uuid_str, None)

    def _pick_next_topic(self):
        if not self.topic_queue: # 큐 리셋
            pool = list(self.Topic)
            random.shuffle(pool)
            # 주제가 2개 이상일 때 이전 라운드 주제와 연속으로 겹치는 경우 순서 교체
            if len(pool) > 1 and pool[0] == self.topic:
                pool[0], pool[-1] = pool[-1], pool[0]
            self.topic_queue = pool

        return self.topic_queue.pop(0)

    def _reset_room(self):
        scheduler.cancel_all()
        self.players.clear()
        self.accumulated_scores.clear()
        self.round_scores.clear()
        self.game_state = self.GameState.IN_LOBBY
        self.round_phase = self.RoundPhase.WAITING
        self.current_round = 0

    # --- 세션 입장 / 재접속 / 퇴장 ---
    async def register_new_player(self, websocket: Any):
        if ws_module.get_uuid_by_ws(websocket):
            return 

        if len(self.players) >= self.MAX_PLAYERS:
            await ws_module.send_error(websocket, self.Error.ROOM_FULL)
            return
        if self.game_state == self.GameState.IN_GAME:
            await ws_module.send_error(websocket, self.Error.GAME_IN_PROGRESS)
            return

        scheduler.cancel("empty_room")

        new_uuid = f"u-{str(uuid.uuid4())[:8]}"
        is_host = len(self.players) == 0
        player = Player(new_uuid, is_host)

        self.players[new_uuid] = player
        self.accumulated_scores[new_uuid] = 0.0
        ws_module.register(new_uuid, websocket)

        await ws_module.send(new_uuid, "CONNECTED", {
            "myUuid": new_uuid,
            "isHost": is_host,
        })
        await ws_module.send(new_uuid, "GAME_OPTIONS_UPDATED", {
            "totalRounds": self.total_rounds,
            "playTimeSeconds": self.play_time_seconds
        })

    async def handle_reconnect(self, websocket: Any, prev_uuid: Optional[str]):
        if not prev_uuid:
            await ws_module.send_error(websocket, self.Error.PREV_UUID_IS_NONE)
            return
        if prev_uuid not in self.players:
            await ws_module.send_error(websocket, self.Error.EXPIRED_SESSION)
            return

        scheduler.cancel(f"disconnect:{prev_uuid}")
        scheduler.cancel("empty_room")

        player = self.players[prev_uuid]
        player.is_connected = True
        ws_module.register(player.uuid, websocket)

        remaining = 0
        if self.round_phase == self.RoundPhase.STREAMING:
            elapsed = time.time() - self.streaming_start_time
            remaining = max(0, int(self.play_time_seconds - elapsed))

        await ws_module.send(player.uuid, "RECONNECT_SUCCESS", {
            "myUuid": player.uuid,
            "isHost": player.is_host,
            "gameState": self.game_state.name,
            "currentRound": self.current_round,
            "totalRounds": self.total_rounds,
            "playTimeSeconds": self.play_time_seconds,
            "topic": self.topic.name,
            "roundPhase": self.round_phase.name,
            "remainingSeconds": remaining,
            "users": self.get_users_list(),
            "roundScores": self.round_scores,
            "accumulatedScores": self.accumulated_scores
        })

        await ws_module.broadcast("ROOM_USERS_UPDATE", {
            "users": self.get_users_list()
        }, exclude_uuid=player.uuid)

    async def handle_disconnect_by_ws(self, websocket: Any):
        disconnected_uuid = ws_module.get_uuid_by_ws(websocket)
        if not disconnected_uuid:
            return

        ws_module.unregister(disconnected_uuid)
        player = self.players.get(disconnected_uuid)
        if not player:
            return

        player.is_connected = False

        if self.game_state == self.GameState.IN_LOBBY:
            scheduler.schedule_once(
                f"disconnect:{player.uuid}",
                self.LOBBY_TIMEOUT_SECONDS,
                self._on_lobby_disconnect_timeout,
                player.uuid
            )

        await ws_module.broadcast("ROOM_USERS_UPDATE", {
            "users": self.get_users_list()
        })
        await self._check_all_round_acked()

        if not any(p.is_connected for p in self.players.values()):
            scheduler.schedule_once(
                "empty_room",
                self.LOBBY_TIMEOUT_SECONDS,
                self._on_empty_room_timeout
            )

    # --- 플레이어 액션 및 게임 설정 ---
    async def set_nickname(self, player: Player, nickname: str):
        player.nickname = nickname[:12] if nickname else "Player"
        await ws_module.broadcast("ROOM_USERS_UPDATE", {
            "users": self.get_users_list()
        })
        await ws_module.send(player.uuid, "CHECK_WEBCAM_REQ", {})

    async def set_webcam_ready(self, player: Player, webcam_ready: bool):
        player.webcam_ready = webcam_ready
        await ws_module.broadcast("ROOM_USERS_UPDATE", {
            "users": self.get_users_list()
        })

    async def update_game_options(self, player: Player, total_rounds: Optional[int], play_time_seconds: Optional[int]):
        if not player.is_host:
            await ws_module.send_error(player.uuid, self.Error.NOT_PERMISSION)
            return
        if self.game_state != self.GameState.IN_LOBBY:
            await ws_module.send_error(player.uuid, self.Error.DENIED)
            return
        if total_rounds is None and play_time_seconds is None:
            await ws_module.send_error(player.uuid, self.Error.DENIED, "변경할 옵션이 없습니다.")
            return

        if total_rounds is not None:
            if not isinstance(total_rounds, int) or isinstance(total_rounds, bool) or not (1 <= total_rounds <= 10):
                await ws_module.send_error(player.uuid, self.Error.DENIED, "라운드는 1부터 10까지 지정 가능합니다.")
                return

        if play_time_seconds is not None:
            if not isinstance(play_time_seconds, int) or isinstance(play_time_seconds, bool) or not (5 <= play_time_seconds <= 60):
                await ws_module.send_error(player.uuid, self.Error.DENIED, "시간은 5초부터 60초까지 지정 가능합니다.")
                return

        if total_rounds is not None:
            self.total_rounds = total_rounds
        if play_time_seconds is not None:
            self.play_time_seconds = play_time_seconds

        await ws_module.broadcast("GAME_OPTIONS_UPDATED", {
            "totalRounds": self.total_rounds,
            "playTimeSeconds": self.play_time_seconds
        })

    async def start_game(self, player: Player):
        if not player.is_host or self.game_state == self.GameState.IN_GAME:
            return

        connected = [p for p in self.players.values() if p.is_connected]
        # if len(connected) < self.MIN_PLAYERS or not all(p.nickname and p.webcam_ready for p in connected):
        if len(connected) < self.MIN_PLAYERS:
            await ws_module.send_error(player.uuid,self.Error.NOT_READY)
            return

        scheduler.cancel_prefix("disconnect:")
        self.game_state = self.GameState.IN_GAME
        self.current_round = 0
        self.round_scores = {}
        for uid in self.accumulated_scores:
            self.accumulated_scores[uid] = 0.0

        scheduler.run_task("round_loop", self.run_next_round())

    async def process_player_frame(self, player: Player, image_base64: str):
        if self.round_phase != self.RoundPhase.STREAMING:
            return

        player.last_frame = image_base64

        if player.is_processing:
            return

        player.is_processing = True
        try:
            masked_image = await asyncio.to_thread(CVModule.process_mask, image_base64)
            await ws_module.broadcast("BROADCAST_MASKED_STREAM", {
                "targetUuid": player.uuid,
                "maskedImageBase64": masked_image
            })
        finally:
            player.is_processing = False

    async def ack_round_end(self, player: Player):
        if self.round_phase != self.RoundPhase.RESULT:
            return
        player.round_ack = True
        await self._check_all_round_acked()

    # --- 라운드 루프 및 채점 ---
    async def _check_all_round_acked(self):
        if self.round_phase != self.RoundPhase.RESULT:
            return

        connected = [p for p in self.players.values() if p.is_connected]
        if connected and all(p.round_ack for p in connected):
            self.round_phase = self.RoundPhase.TRANSITIONING
            if self.current_round >= self.total_rounds:
                scheduler.run_task("round_loop", self.finish_game())
            else:
                scheduler.run_task("round_loop", self.run_next_round())

    async def _evaluate_frame(self, frame: str, topic_id: int) -> float:
        if not frame:
            return 0.0
        try:
            return await asyncio.to_thread(CVModule.calculate_score, frame, topic_id)
        except Exception as e:
            print(f"[CV Score Error] {e}")
            return 0.0

    async def run_next_round(self):
        self.current_round += 1
        self.round_phase = self.RoundPhase.TOPIC_SHOW
        self.topic = self._pick_next_topic()

        for p in self.players.values():
            p.round_ack = False
            p.last_frame = ""

        await ws_module.broadcast("ROUND_START", {
            "currentRound": self.current_round,
            "totalRounds": self.total_rounds,
            "topic": self.topic.name
        })
        await asyncio.sleep(3)

        self.round_phase = self.RoundPhase.STREAMING
        self.streaming_start_time = time.time()
        await ws_module.broadcast("START_STREAMING", {
            "currentRound": self.current_round,
            "playTimeSeconds": self.play_time_seconds,
            "targetFps": self.target_fps,
            "width": self.width,
            "height": self.height
        })
        await asyncio.sleep(self.play_time_seconds)

        self.round_phase = self.RoundPhase.RESULT
        await ws_module.broadcast("FRAME_RECEIVED_WAIT", {
            "message": "영상 분석 진행 중입니다."
        })

        uids = list(self.players.keys())
        tasks = [
            self._evaluate_frame(self.players[uid].last_frame, self.topic.value)
            for uid in uids
        ]
        scores = await asyncio.gather(*tasks)

        self.round_scores = {}
        for uid, score in zip(uids, scores):
            self.round_scores[uid] = score
            self.accumulated_scores[uid] = round(self.accumulated_scores.get(uid, 0.0) + score, 1)

        await asyncio.sleep(1)
        await ws_module.broadcast("ROUND_RESULT", {
            "currentRound": self.current_round,
            "roundScores": self.round_scores
        })

    async def finish_game(self):
        sorted_scores = sorted(self.accumulated_scores.items(), key=lambda x: x[1], reverse=True)
        rankings = [
            {
                "rank": rank,
                "uuid": uid,
                "nickname": self.players[uid].nickname if uid in self.players else "알 수 없음",
                "score": score
            }
            for rank, (uid, score) in enumerate(sorted_scores, 1)
        ]
        await ws_module.broadcast("GAME_OVER", {
            "finalScores": self.accumulated_scores,
            "rankings": rankings
        })

        offline_uids = [uid for uid, p in self.players.items() if not p.is_connected]
        for uid in offline_uids:
            self._remove_player(uid)
        self.update_host()

        self.game_state = self.GameState.IN_LOBBY
        self.round_phase = self.RoundPhase.WAITING
        self.current_round = 0
        self.round_scores.clear()

        for uid in self.accumulated_scores:
            self.accumulated_scores[uid] = 0.0
        for p in self.players.values():
            p.round_ack = False
            p.last_frame = ""

        if self.players:
            await ws_module.broadcast("ROOM_USERS_UPDATE", {
                "users": self.get_users_list()
            })

    # --- 스케줄러 콜백 ---
    async def _on_lobby_disconnect_timeout(self, uuid_str: str):
        player = self.players.get(uuid_str)
        if player and not player.is_connected and self.game_state == self.GameState.IN_LOBBY:
            self._remove_player(uuid_str)
            self.update_host()
            await ws_module.broadcast("ROOM_USERS_UPDATE", {
                "users": self.get_users_list()
            })

    async def _on_empty_room_timeout(self):
        if not any(p.is_connected for p in self.players.values()):
            self._reset_room()