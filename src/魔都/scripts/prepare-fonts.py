from pathlib import Path
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor
from fontTools import subset
from fontTools.ttLib import TTFont
import re
import base64
import json
import hashlib

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '_probe' / 'design-reference'
FONTS = [
    ('Abril Fatface', 'Mato Latin', 400, 'abrilfatface'),
    ('Noto Sans SC', 'Mato Sans', 400, 'notosanssc'),
    ('Noto Serif SC', 'Mato Mincho', 600, 'notoserifsc'),
]
CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600&family=Noto+Sans+SC:wght@400&family=Abril+Fatface&display=swap'
css = urlopen(Request(CSS_URL, headers={'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36'}), timeout=60).read().decode()
urls = re.findall(r'url\((https://fonts.gstatic.com/[^)]+)\)', css)
assert len(urls) == 3, 'Unexpected Google Fonts response; inspect font-source.css'
(CACHE / 'font-source.css').write_text(css, encoding='utf-8')
characters = set(chr(i) for i in range(32, 127))
for lead in range(0xB0, 0xF8):
    for trail in range(0xA1, 0xFF):
        try:
            characters.update(bytes([lead, trail]).decode('gb2312'))
        except UnicodeDecodeError:
            pass
characters.update(chr(i) for i in range(0x3000, 0x3100))
characters.update('，。！？：；「」『』【】《》——…·％（）／◆七魔都精兵的奴隶')
for path in (ROOT / 'src').rglob('*'):
    if path.suffix in ('.tsx', '.ts') and path.name != 'assets.ts':
        characters.update(path.read_text(encoding='utf-8-sig'))

def prepare(item):
    (original, family, weight, directory), url = item
    local = CACHE / (directory + '.ttf')
    if not local.exists():
        local.write_bytes(urlopen(url, timeout=90).read())
    font = TTFont(local)
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    worker = subset.Subsetter(options=options)
    worker.populate(text=''.join(characters) if directory != 'abrilfatface' else ''.join(chr(i) for i in range(32, 127)))
    worker.subset(font)
    # OFL reserved names: give modified subsets an independent family name.
    for record in font['name'].names:
        if record.nameID in (1, 4, 6, 16, 17):
            value = family.replace(' ', '') if record.nameID == 6 else family
            record.string = value.encode(record.getEncoding(), errors='replace')
    font.flavor = 'woff2'
    dest = ROOT / 'src' / 'assets' / (directory + '.woff2')
    font.save(dest)
    license_url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/' + directory + '/OFL.txt'
    license_bytes = urlopen(license_url, timeout=60).read()
    (ROOT / 'src' / 'assets' / (directory + '-OFL.txt')).write_bytes(license_bytes)
    data = dest.read_bytes()
    print(f'{family}: {len(data):,} bytes, {len(font.getBestCmap())} codepoints', flush=True)
    return ("@font-face { font-family: '" + family + "'; font-style: normal; font-weight: " + str(weight) + "; font-display: swap; src: url(data:font/woff2;base64," + base64.b64encode(data).decode() + ") format('woff2'); }", {'family': family, 'sourceFamily': original, 'source': url, 'license': license_url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'glyphs': len(font.getBestCmap())})

result = list(ThreadPoolExecutor(3).map(prepare, zip(FONTS, urls)))
(ROOT / 'src' / 'fonts.css').write_text('\n'.join(r[0] for r in result), encoding='utf-8')
(CACHE / 'font-receipt.json').write_text(json.dumps([r[1] for r in result], indent=2, ensure_ascii=False), encoding='utf-8')
