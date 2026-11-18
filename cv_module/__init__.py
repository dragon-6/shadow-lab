import random

class CVModule:

    @classmethod
    def process_mask(cls, base64_str: str) -> str:
        # 실구현: 입력 이미지를 실시간 이진화(마스킹)하여 Base64로 반환
        # 개발용: 그대로 반환
        return base64_str

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