import os
import sys
import cv2
from cv_module.preprocessor import Preprocessor
from cv_module.matcher import Matcher

folder = "test_images"
if len(sys.argv) > 1:
    folder = sys.argv[1]

pre = Preprocessor()
matcher = Matcher("templates")
ids = sorted(matcher.templates.keys())

head = ["사진"]
for i in ids:
    head.append("hu_" + str(i))
for i in ids:
    head.append("iou_" + str(i))
head.append("hu가까운")
head.append("iou가까운")
head.append("정답")
print(*head, sep="\t")

for file in sorted(os.listdir(folder)):
    if not file.lower().endswith((".jpg", ".jpeg", ".png")):
        continue
    frame = cv2.imread(os.path.join(folder, file))
    mask, status = pre.make_mask(frame)
    if mask is None:
        print(file, status, sep="\t")
        continue
    hus = [matcher.distance(mask, i) for i in ids]
    ious = [matcher.iou(mask, i) for i in ids]
    row = [file]
    for v in hus:
        row.append(str(round(v, 3)))
    for v in ious:
        row.append(str(round(v, 3)))
    row.append(str(ids[hus.index(min(hus))]))
    row.append(str(ids[ious.index(max(ious))]))
    row.append(file.split("_")[0])
    print(*row, sep="\t")