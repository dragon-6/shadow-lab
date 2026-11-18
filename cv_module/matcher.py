import os
import cv2
import numpy as np


class Matcher:
    def __init__(self, template_dir="templates"):
        self.templates = {}
        self.norm_templates = {}
        self.load_templates(template_dir)

    def get_contour(self, mask):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) == 0:
            return None
        return max(contours, key=cv2.contourArea)

    def normalize(self, mask, size=128):
        x, y, w, h = cv2.boundingRect(mask)
        crop = mask[y:y + h, x:x + w]
        side = max(w, h)
        square = np.zeros((side, side), np.uint8)
        ox = (side - w) // 2
        oy = (side - h) // 2
        square[oy:oy + h, ox:ox + w] = crop
        return cv2.resize(square, (size, size), interpolation=cv2.INTER_AREA)

    def load_templates(self, template_dir):
        for file in sorted(os.listdir(template_dir)):
            if not file.endswith(".png"):
                continue
            topic_id = int(file.split("_")[0])
            mask = cv2.imread(os.path.join(template_dir, file), cv2.IMREAD_GRAYSCALE)
            _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
            contour = self.get_contour(mask)
            if contour is not None:
                self.templates[topic_id] = contour
                self.norm_templates[topic_id] = self.normalize(mask)

    def distance(self, mask, topic_id):
        if topic_id not in self.templates:
            return None
        contour = self.get_contour(mask)
        if contour is None:
            return None
        return cv2.matchShapes(self.templates[topic_id], contour, cv2.CONTOURS_MATCH_I1, 0)

    def iou(self, mask, topic_id):
        if topic_id not in self.norm_templates:
            return None
        a = self.norm_templates[topic_id] > 127
        b = self.normalize(mask) > 127
        inter = np.logical_and(a, b).sum()
        union = np.logical_or(a, b).sum()
        if union == 0:
            return 0.0
        return float(inter / union)