from pathlib import Path

path = Path("src/extension/ocrCalibration.ts")
text = path.read_text()
old = '''  const wordWidth = word.x1 - word.x0;
  const wordHeight = word.y1 - word.y0;
  const targetWidth = Math.min(imageWidth, Math.max(imageWidth * 0.34, wordWidth * 2.2));
  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.22, wordHeight * 2.4));'''
new = '''  const wordHeight = word.y1 - word.y0;
  // Fixed cell dimensions are intentional: centering width on the token itself
  // made Ready/Active/149s produce different rectangles. The Skill value cell
  // is right-aligned, so its capture geometry must not depend on token width.
  const targetWidth = Math.min(imageWidth, imageWidth * 0.42);
  const targetHeight = Math.min(imageHeight, Math.max(imageHeight * 0.22, wordHeight * 2.4));'''
if text.count(old) != 1:
    raise SystemExit(f"expected one variable-width state-cell block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("state-cell crop made width-stable")
