import sys
import cv2
from cv_module.preprocessor import Preprocessor

path = sys.argv[1]
frame = cv2.imread(path)
if frame is None:
    print("사진을 못 읽음:", path)
    sys.exit()

pre = Preprocessor()

points = pre.find_points(frame)
if points is None:
    print("손을 못 찾음")
    sys.exit()

view = frame.copy()
for x, y in points:
    cv2.circle(view, (x, y), 5, (0, 255, 0), -1)
cv2.imwrite("out/points.png", view)

mask, status = pre.make_mask(frame)
print("상태:", status)
if mask is not None:
    cv2.imwrite("out/mask.png", mask)
print("저장 완료: out/ 폴더 확인")