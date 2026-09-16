"""把两个来源的素材整理成前端能直接 `?url` 内联的成品。

来源 A：Kenney Particle Pack（CC0 1.0）
  https://kenney.nl/assets/particle-pack
  那个包是**单张贴图**，且绝大多数是"柔和辉光"，只有少数几张贴我们的平面黑红。
  现在只保留真正在用的两三张（冲击波环、刮痕），其余删掉不再内联。

来源 B：フリー素材サイトギャラリーハウス「赤い斬撃エフェクトAPNGアニメーション」
  https://tokidokiame.com/galleryhouse/?p=8952
  这是**真序列帧**：13 帧 / 429ms / 30fps / 1080×1080 / RGBA。
  条款：商用可、加工自由、クレジット不要、"作品の一部に使用する場合は可"、
  **禁止直链，必须下载**。条款原文见同目录 LICENSE-galleryhouse.txt。
  ⚠️ 条款同时禁止用于「過激な性表現」——这张卡的整体定位是否触及，由项目方判断。

序列帧的用法：横向拼成一张 strip，前端用
`background-size: 1300% 100%` + `background-position-x` 的 steps 动画逐帧推进，
不需要 JS 逐帧 setState（见 ImpactFX.css 里的说明）。

跑法：python 魔都/scripts/prepare-fx-assets.py
"""

import glob
import io
import os
import urllib.request

from PIL import Image

TEMP = os.environ["TEMP"]
KENNEY_SRC = os.path.join(TEMP, "mato-assets", "kenney")
JP_SRC = os.path.join(TEMP, "mato-assets", "jp")
DST = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "assets", "fx"))

EDGE = 256
JP_EDGE = 384
JP_URL = "https://tokidokiame.com/galleryhouse/wp-content/uploads/2026/07/zangeki2-apng.png"

# ── 来源 A：仍然要用的（其余不再内联）──
KENNEY_PICKS = {
    "ring-a": "circle_01.png",
    "claw": "scratch_01.png",
}

LICENSE_TEXT = """素材来源与授权
================================================================

A) Kenney Particle Pack
   https://kenney.nl/assets/particle-pack
   License: Creative Commons Zero (CC0 1.0)
   http://creativecommons.org/publicdomain/zero/1.0/
   可商用、可修改、无需署名。
   本目录下由它派生的文件：ring-a.png, claw.png, LICENSE-kenney-particle-pack.txt

B) フリー素材サイトギャラリーハウス
   「赤い斬撃エフェクトAPNGアニメーション【商用可・フリー素材】」
   https://tokidokiame.com/galleryhouse/?p=8952
   原文件：zangeki2-apng.png（1080x1080 / 13 帧 / 429ms / RGBA）
   本目录下由它派生的文件：slash-sweep.png（横向 strip，384px 一帧）

   条款要点（原文见项目文档引用）：
     - 个人 / 法人 / 商用 / 非商用 均可使用
     - 作为**作品的一部分**使用可以；把素材本身拿到别的素材站再配布或贩卖禁止
     - 加工自由
     - クレジット表記不要（不强制署名）
     - **禁止直链，必须下载后使用**
     - 禁止用于公序良俗に反する目的 / 反社会的 / 過激な性表現 / 犯罪行為

================================================================
"""


def locate_kenney(basename):
    hits = glob.glob(os.path.join(KENNEY_SRC, "**", basename), recursive=True)
    return hits[0] if hits else None


def load_apng(path):
    im = Image.open(path)
    frames = []
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        frames.append(im.convert("RGBA").copy())
    return frames


def main():
    os.makedirs(DST, exist_ok=True)
    os.makedirs(JP_SRC, exist_ok=True)
    total = 0

    # ── A) Kenney ──
    for out_name, src_name in KENNEY_PICKS.items():
        path = locate_kenney(src_name)
        if not path:
            raise SystemExit(f"缺 Kenney 素材：{src_name}")
        im = Image.open(path).convert("RGBA").resize((EDGE, EDGE), Image.LANCZOS)
        target = os.path.join(DST, out_name + ".png")
        im.save(target, format="PNG", optimize=True)
        total += os.path.getsize(target)
        print(f"  [kenney] {out_name:16} ← {src_name:18} {os.path.getsize(target) // 1024:>3} KB")

    kenney_license = os.path.join(KENNEY_SRC, "License.txt")
    if os.path.exists(kenney_license):
        with open(kenney_license, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        with open(os.path.join(DST, "LICENSE-kenney-particle-pack.txt"), "w", encoding="utf-8") as fh:
            fh.write(text)

    # ── B) 日本序列帧斩击 ──
    apng_path = os.path.join(JP_SRC, os.path.basename(JP_URL))
    if not os.path.exists(apng_path):
        print("  下载日本斩击 APNG ...")
        urllib.request.urlretrieve(JP_URL, apng_path)

    frames = load_apng(apng_path)
    smalls = [f.resize((JP_EDGE, JP_EDGE), Image.LANCZOS) for f in frames]
    strip = Image.new("RGBA", (JP_EDGE * len(smalls), JP_EDGE), (0, 0, 0, 0))
    for i, f in enumerate(smalls):
        strip.paste(f, (i * JP_EDGE, 0))
    strip_target = os.path.join(DST, "slash-sweep.png")
    strip.save(strip_target, format="PNG", optimize=True)
    size = os.path.getsize(strip_target)
    total += size
    print(f"  [jp]     slash-sweep      ← {len(frames)} 帧 strip        {size // 1024:>3} KB")

    with open(os.path.join(DST, "LICENSE-galleryhouse.txt"), "w", encoding="utf-8") as fh:
        fh.write(LICENSE_TEXT)

    b64 = (total + 2) // 3 * 4
    print(f"\n合计 {total // 1024} KB → base64 内联约 {b64 // 1024} KB")
    print(f"strip 尺寸 {JP_EDGE}px × {len(frames)} 帧 = {JP_EDGE * len(frames)}×{JP_EDGE}")


if __name__ == "__main__":
    main()
