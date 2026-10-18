"""Inline the deck into one HTML file (the hosted demo). Usage: python tools/build_demo.py OUT.html"""
import re, sys
from pathlib import Path
web = Path(__file__).resolve().parent.parent / "web"
s = (web / "index.html").read_text("utf-8")
s = s.replace('<link rel="stylesheet" href="css/deck.css">', "<style>\n" + (web / "css/deck.css").read_text("utf-8") + "\n</style>")
s = re.sub(r'<script src="(js/[^"]+)"></script>', lambda m: "<script>\n" + (web / m.group(1)).read_text("utf-8") + "\n</script>", s)
head = s[s.index("<head>") + 6: s.index("</head>")]
body = s[s.index("<body>") + 6: s.index("</body>")]
drop = ['<meta charset="utf-8">', '<meta name="viewport"', '<link rel="manifest"', '<link rel="icon"', '<link rel="apple-touch-icon"', "apple-mobile-web-app", "mobile-web-app-capable"]
head = "\n".join(l for l in head.splitlines() if not any(d in l for d in drop))
Path(sys.argv[1]).write_text(head.strip() + "\n" + body.strip() + "\n", "utf-8")
print("wrote", sys.argv[1], len(head) + len(body), "bytes")
