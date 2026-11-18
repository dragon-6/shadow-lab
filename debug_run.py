import sys
import cv2
from cv_module.preprocessor import Preprocessor

path = sys.argv[1]
frame = cv2.imread(path)
if frame is None:
    print("사진을 못 읽음:", path)
    sys.exit()

pre = Preprocessor()

hand = pre.crop_hand(frame)
if hand is None:
    print("손을 못 찾음")
    sys.exit()

gray = cv2.cvtColor(hand, cv2.COLOR_BGR2GRAY)
binary = pre.to_binary(hand)

cv2.imwrite("out/1_crop.png", hand)
cv2.imwrite("out/2_gray.png", gray)
cv2.imwrite("out/3_binary.png", binary)
print("저장 완료: out/ 폴더 확인")
