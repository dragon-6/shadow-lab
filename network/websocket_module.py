from typing import Dict, Optional
from fastapi import WebSocket
from enum import Enum

class WebSocketModule:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    ## uuid : websocket 매핑
    def register(self, uuid_str: str, websocket: WebSocket):
        self.active_connections[uuid_str] = websocket

    def unregister(self, uuid_str: str):
        self.active_connections.pop(uuid_str, None)

    def get_uuid_by_ws(self, websocket: WebSocket) -> Optional[str]:
        """웹소켓 객체로 매핑된 플레이어 UUID 역조회"""
        for uuid_str, ws in self.active_connections.items():
            if ws == websocket:
                return uuid_str
        return None

    ## 메시지 제어 및 송신
    def _create_message(self, msg_type: str, payload: dict, sender_uuid: str = "SERVER") -> dict:
        return {
            "type": msg_type,
            "senderUuid": sender_uuid,
            "payload": payload
        }

    async def _send_raw(self, websocket: WebSocket, msg_type: str, payload: dict, sender_uuid: str = "SERVER"):
        """UUID 발급 전(미등록 소켓) 응답 전송"""
        message = self._create_message(msg_type, payload, sender_uuid)
        try:
            await websocket.send_json(message)
        except Exception as e:
            print(f"[WS Raw Send Error] {e}")

    async def _send_to(self, target_uuid: str, msg_type: str, payload: dict, sender_uuid: str = "SERVER"):
        if target_uuid in self.active_connections:
            ws = self.active_connections[target_uuid]
            message = self._create_message(msg_type, payload, sender_uuid)
            try:
                await ws.send_json(message)
            except Exception as e:
                print(f"[WS Send Error] target={target_uuid}: {e}")

    async def broadcast(
        self,
        msg_type: str,
        payload: dict,
        exclude_uuid: Optional[str] = None,
        sender_uuid: str = "SERVER"
    ):
        message = self._create_message(msg_type, payload, sender_uuid)
        for uuid_str, ws in list(self.active_connections.items()):
            if exclude_uuid and uuid_str == exclude_uuid:
                continue
            try:
                await ws.send_json(message)
            except Exception as e:
                print(f"[WS Broadcast Error] target={uuid_str}: {e}")

    async def send(self, target: str | WebSocket, msg_type: str, payload: dict, sender_uuid: str = "SERVER"):
            if isinstance(target, str):
                await self._send_to(target, msg_type, payload, sender_uuid)
            else:
                await self._send_raw(target, msg_type, payload, sender_uuid)

    async def send_error(self, target: str | WebSocket, error: Enum, detail: Optional[str] = None, sender_uuid: str = "SERVER"):
        payload = {
            "code": error.name,
            "message": detail or str(error.value)
        }
        await self.send(target, "ERROR", payload, sender_uuid)

        print(f"{WebSocket} : {error}")