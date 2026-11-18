import cv2
import numpy as np
import mediapipe as mp

BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
RunningMode = mp.tasks.vision.RunningMode


class Preprocessor:
    def __init__(self, model_path="models/hand_landmarker.task"):
        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=RunningMode.IMAGE,
            num_hands=2,
        )
        self.landmarker = HandLandmarker.create_from_options(options)

    def find_box(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(image)
        if len(result.hand_landmarks) == 0:
            return None
        h, w = frame.shape[:2]
        xs = []
        ys = []
        for hand in result.hand_landmarks:
            for p in hand:
                xs.append(int(p.x * w))
                ys.append(int(p.y * h))
        pad = 30
        x1 = max(min(xs) - pad, 0)
        x2 = min(max(xs) + pad, w)
        y1 = max(min(ys) - pad, 0)
        y2 = min(max(ys) + pad, h)
        if x2 <= x1 or y2 <= y1:
            return None
        return x1, y1, x2, y2

    def crop_hand(self, frame):
        box = self.find_box(frame)
        if box is None:
            return None
        x1, y1, x2, y2 = box
        return frame[y1:y2, x1:x2]

    def fix_light(self, gray):
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        return clahe.apply(gray)

    def to_binary(self, img):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = self.fix_light(gray)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        kernel = np.ones((5, 5), np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        return binary

    def run(self, frame):
        hand = self.crop_hand(frame)
        if hand is None:
            return None
        return self.to_binary(hand)