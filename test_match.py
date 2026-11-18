import os
import cv2
from cv_module.preprocessor import Preprocessor
from cv_module.matcher import Matcher

pre = Preprocessor()
matcher = Matcher("templates")
ids = sorted(matcher.templates.keys())

print("사진", *["거리_" + str(i) for i in ids], sep="\t")

for file in sorted(os.listdir("template_photos")):
    if not file.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    frame = cv2.imread(os.path.join("template_photos", file))
    mask, status = pre.make_mask(frame)
    if mask is None:
        print(file, status, sep="\t")
        continue
    row = [file]
    for i in ids:
        row.append(str(round(matcher.distance(mask, i), 4)))
    print(*row, sep="\t")