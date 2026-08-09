"""Build a single self-contained copy of the homepage (run from docs/).

Inline the homepage into one file so it renders inside an artifact, where
requests to any other host are blocked. Same CSS, same module, same model —
only the transport changes."""
import base64, re, os

# The artifact shell supplies its own <head>, so a <meta charset> of ours never
# survives. Emitting pure ASCII removes the question: markup becomes numeric
# entities, and the few typographic characters in CSS/JS comments become plain
# ASCII (entities are not decoded inside <style>/<script>, so they cannot go there).
PUNCT = {'\u2014': '--', '\u2013': '-', '\u2022': '*', '\u00b7': '.',
         '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
         '\u2026': '...', '\u2192': '->', '\u2265': '>=', '\u2264': '<=',
         '\u00d7': 'x', '\u00b0': ' deg', '\u2212': '-', '\u00a0': ' '}

def asciify_code(t):
    for k, v in PUNCT.items():
        t = t.replace(k, v)
    return t.encode('ascii', 'replace').decode('ascii')

def asciify_markup(t):
    return t.encode('ascii', 'xmlcharrefreplace').decode('ascii')

MIME = {'.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary'}

def datauri(path, mime=None):
    mime = mime or MIME.get(os.path.splitext(path)[1].lower(), 'application/octet-stream')
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())

def js_uri(text):
    return 'data:text/javascript;base64,' + base64.b64encode(text.encode()).decode()

html = open('index.html').read()

# --- css, with its fonts and background images folded in -------------------
css = open('assets/site.css').read()
def css_url(m):
    rel = m.group(1).strip('\'"')
    if rel.startswith('data:'):
        return m.group(0)
    p = os.path.normpath(os.path.join('assets', rel))
    return "url('%s')" % datauri(p) if os.path.exists(p) else m.group(0)
css = re.sub(r"url\(([^)]+)\)", css_url, css)
css = asciify_code(css)

# --- the module chain: three <- hand <- page script ------------------------
hand = asciify_code(open('assets/hand.js').read())
hand = hand.replace("from './vendor/three-slim.min.js'",
                    "from '%s'" % js_uri(open('assets/vendor/three-slim.min.js').read()))
hand = hand.replace("asset('models/hand-rigged.glb')", "'%s'" % datauri('assets/models/hand-rigged.glb'))
for rel in ('skin-normal.jpg', 'skin-rough.jpg'):
    hand = hand.replace("asset('img/%s')" % rel, "'%s'" % datauri('assets/img/' + rel))

site = asciify_code(open('assets/site.js').read()).replace("import('./hand.js')", "import('%s')" % js_uri(hand))

# --- images: only real <img> tags, never a script's src --------------------
def img_src(m):
    rel = m.group(2)
    p = os.path.normpath(rel)
    return m.group(1) + datauri(p) + m.group(3) if os.path.exists(p) else m.group(0)
html = re.sub(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', img_src, html)

LINK = '<link rel="stylesheet" href="assets/site.css">'
SCRIPT = '<script src="assets/site.js" defer></script>'
assert LINK in html and SCRIPT in html, 'head/script tags not found'
html = html.replace(LINK, '<style>\n%s\n</style>' % css)
html = html.replace(SCRIPT, '<script>\n%s\n</script>' % site)
# the case study page is not part of this bundle
html = html.replace('href="airmouse/"', 'href="https://github.com/RadislavDenisenko/AirMouse"')

head = html.split('<head>', 1)[1].split('</head>', 1)[0]
body = html.split('<body>', 1)[1].rsplit('</body>', 1)[0]
title = re.search(r'<title>(.*?)</title>', head).group(1)
style = re.search(r'<style>.*?</style>', head, re.S).group(0)

out = '<title>%s</title>\n%s\n%s' % (asciify_markup(title), style, asciify_markup(body))
assert out.isascii(), 'non-ascii survived'
open('/tmp/preview.html', 'w', encoding='ascii').write(out)
print('bundled: %.2f MB' % (os.path.getsize('/tmp/preview.html') / 1e6))
