class Player:
    def __init__(self, uuid_str: str, is_host: bool = False):
        self.uuid = uuid_str
        self.nickname = ""
        self.is_host = is_host
        self.is_connected = True
        self.webcam_ready = False

        # 라운드 종료 단계 체크용
        self.round_ack = False
        
        # 프레임 처리용
        self.last_frame = ""
        self.is_processing = False

    def to_dict(self) -> dict:
        return {
            "uuid": self.uuid,
            "nickname": self.nickname,
            "isHost": self.is_host,
            "isConnected": self.is_connected,
            "webcamReady": self.webcam_ready
        }