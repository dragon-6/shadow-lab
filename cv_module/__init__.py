import random
import base64
import cv2
import numpy as np

class CVModule:

    @classmethod
    def process_mask(cls, base64_str: str) -> str:
        # 실구현: 입력 이미지를 실시간 이진화(마스킹)하여 Base64로 반환
        # 개발용: 그대로 반환
        return base64_str

    @classmethod
    def get_topic_frame_image(
        cls,
        topic_id: int,
        width: int = 320,
        height: int = 240
    ) -> str:
        """주제 ID와 지정된 해상도(width, height)에 맞는 테스트용 더미 가이드 이미지를 PNG Base64로 반환"""
        # OpenCV는 BGRA 순서 사용 (A=0: 완전 투명 배경)
        img = np.zeros((height, width, 4), dtype=np.uint8)

        # 색상 정의 (B, G, R, Alpha) - 시안(하늘색) 및 노란색 반투명
        border_color = (255, 255, 0, 220)   # 시안색 테두리
        guide_color = (0, 255, 255, 180)    # 노란색 중앙 가이드
        cx, cy = width // 2, height // 2

        # 1. 외곽 테두리 (캔버스 크기 및 정렬 일치 확인용)
        cv2.rectangle(img, (2, 2), (width - 3, height - 3), border_color, 2)

        # 2. 중앙 실루엣 가이드 영역 (원 + 십자선)
        radius = min(width, height) // 3
        cv2.circle(img, (cx, cy), radius, guide_color, 2)
        cv2.line(img, (cx - 15, cy), (cx + 15, cy), guide_color, 1)
        cv2.line(img, (cx, cy - 15), (cx, cy + 15), guide_color, 1)

        # 3. 라운드별 topic_id 변경 확인용 텍스트 (OpenCV 기본 폰트는 영문/숫자만 지원)
        cv2.putText(
            img,
            f"DUMMY TOPIC: {topic_id}",
            (12, 26),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            border_color,
            2,
            cv2.LINE_AA
        )

        _, buffer = cv2.imencode(".png", img)
        b64_str = base64.b64encode(buffer.tobytes()).decode("utf-8")
        return f"data:image/png;base64,{b64_str}"

    @classmethod
    def calculate_score(cls, base64_str: str, topic_id: int) -> float:
        """주제와 마스킹 이미지를 비교하여 0.0 ~ 5.0 점수 산출"""
        # 실제 개발 시 cv2.HuMoments() 기반 비교 로직으로 replacement
        score = round(random.uniform(1.0, 5.0), 1)
        return score
    
    @classmethod
    def get_topics(cls) -> dict:
        """주제 리스트와 ID 반환"""
        topics = { "강아지" : 1, "토끼" : 2, "새" : 3,
                    "여우" : 4, "나비" : 5, "공룡" : 6, "달팽이" : 7}
        return topics