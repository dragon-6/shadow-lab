import os
import cv2
from cv_module.preprocessor import Preprocessor

pre = Preprocessor()
os.makedirs("templates", exist_ok=True)

for file in sorted(os.listdir("template_photos")):
    if not file.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    frame = cv2.imread(os.path.join("template_photos", file))
    if frame is None:
        print("못 읽음:", file)
        continue
    mask, status = pre.make_mask(frame)
    if mask is None:
        print("마스크 실패:", file, status)
        continue
    name = os.path.splitext(file)[0]
    cv2.imwrite(os.path.join("templates", name + ".png"), mask)
    print("저장:", name)