from enum import Enum
from typing import Optional, Callable, Awaitable
from fastapi import WebSocket

from game import game_manager, Player
from network import ws_module


class MessageRouter:
    class Error(Enum):
        INVALID_FORMAT = "잘못된 메시지 형식입니다."
        UNAUTHORIZED = "유효하지 않거나 만료된 사용자 UUID입니다."
        UNKNOWN_TYPE = "지원하지 않는 메시지 타입입니다."

    def __init__(self):
        self.handlers: dict[str, Callable[[Player, dict], Awaitable[None]]] = {
            "SET_NICKNAME": self._on_set_nickname,
            "CHECK_WEBCAM_RES": self._on_check_webcam_res,
            "UPDATE_GAME_OPTIONS": self._on_update_game_options,
            "GAME_START_REQ": self._on_game_start_req,
            "SEND_FRAME": self._on_send_frame,
            "ROUND_END_ACK": self._on_round_end_ack,
        }

    async def route(self, data: dict, websocket: WebSocket):
        if not isinstance(data, dict):
            await ws_module.send_error(websocket, self.Error.INVALID_FORMAT, "메시지는 JSON 객체여야 합니다.")
            return

        msg_type: Optional[str] = data.get("type")
        sender_uuid: Optional[str] = data.get("senderUuid")
        raw_payload = data.get("payload")

        if not msg_type or (raw_payload is not None and not isinstance(raw_payload, dict)):
            await ws_module.send_error(websocket, self.Error.INVALID_FORMAT)
            return

        payload: dict = raw_payload or {}

        if msg_type == "RECONNECT_REQ":
            await game_manager.handle_reconnect(websocket, payload.get("prevUuid"))
            return

        if msg_type == "JOIN_REQ":
            await game_manager.register_new_player(websocket)
            return

        if not sender_uuid or sender_uuid not in game_manager.players:
            await ws_module.send_error(websocket, self.Error.UNAUTHORIZED)
            return

        handler = self.handlers.get(msg_type)
        if not handler:
            await ws_module.send_error(websocket, self.Error.UNKNOWN_TYPE, f"지원하지 않는 메시지 타입입니다: {msg_type}")
            return

        await handler(game_manager.players[sender_uuid], payload)

    async def on_disconnect(self, websocket: WebSocket):
        await game_manager.handle_disconnect_by_ws(websocket)

    # --- 개별 메시지 페이로드 파싱 ---
    async def _on_set_nickname(self, player: Player, payload: dict):
        nickname = str(payload.get("nickname", "")).strip()
        await game_manager.set_nickname(player, nickname)

    async def _on_check_webcam_res(self, player: Player, payload: dict):
        webcam_ready = bool(payload.get("webcamReady", False))
        await game_manager.set_webcam_ready(player, webcam_ready)

    async def _on_update_game_options(self, player: Player, payload: dict):
        await game_manager.update_game_options(
            player,
            total_rounds=payload.get("totalRounds"),
            play_time_seconds=payload.get("playTimeSeconds"),
        )

    async def _on_game_start_req(self, player: Player, payload: dict):
        await game_manager.start_game(player)

    async def _on_send_frame(self, player: Player, payload: dict):
        image_base64 = payload.get("imageBase64", "")
        if image_base64:
            await game_manager.process_player_frame(player, image_base64)

    async def _on_round_end_ack(self, player: Player, payload: dict):
        await game_manager.ack_round_end(player)