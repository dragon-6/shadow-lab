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
            min_hand_detection_confidence=0.3,
            min_hand_presence_confidence=0.3,
        )
        self.landmarker = HandLandmarker.create_from_options(options)

    def find_points(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(image)
        if len(result.hand_landmarks) == 0:
            return None
        h, w = frame.shape[:2]
        points = []
        for hand in result.hand_landmarks:
            for p in hand:
                x = min(max(int(p.x * w), 0), w - 1)
                y = min(max(int(p.y * h), 0), h - 1)
                points.append((x, y))
        return points

    def skin_mask(self, frame, points):
        blur = cv2.GaussianBlur(frame, (5, 5), 0)
        ycrcb = cv2.cvtColor(blur, cv2.COLOR_BGR2YCrCb)
        samples = np.array([ycrcb[y, x] for x, y in points])
        center = np.median(samples, axis=0)
        low = np.clip(center - [255, 10, 10], 0, 255).astype(np.uint8)
        high = np.clip(center + [255, 10, 10], 0, 255).astype(np.uint8)
        mask = cv2.inRange(ycrcb, low, high)
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        return mask

    def keep_hand(self, mask, points):
        count, labels = cv2.connectedComponents(mask)
        votes = {}
        for x, y in points:
            label = labels[y, x]
            if label != 0:
                votes[label] = votes.get(label, 0) + 1
        out = np.zeros_like(mask)
        if len(votes) == 0:
            return out
        best = max(votes, key=votes.get)
        out[labels == best] = 255
        contours, _ = cv2.findContours(out, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(out, contours, -1, 255, thickness=cv2.FILLED)
        return out

    def make_mask(self, frame):
        points = self.find_points(frame)
        if points is None:
            return None, "no_hand"
        mask = self.skin_mask(frame, points)
        mask = self.keep_hand(mask, points)
        x, y, w, h = cv2.boundingRect(mask)
        if w == 0 or h == 0:
            return None, "invalid_mask"
        pad = 10
        x1 = max(x - pad, 0)
        y1 = max(y - pad, 0)
        x2 = min(x + w + pad, mask.shape[1])
        y2 = min(y + h + pad, mask.shape[0])
        return mask[y1:y2, x1:x2], "ok"

    def run(self, frame):
        mask, status = self.make_mask(frame)
        return mask