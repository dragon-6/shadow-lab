from .message_router import MessageRouter
from .websocket_module import WebSocketModule

ws_module = WebSocketModule()
message_router = MessageRouter()

__all__ = ["message_router", "ws_module"]