"""Inline the libraries and app script into a single self-contained index.html."""
from pathlib import Path

ROOT = Path(__file__).parent
VENDOR = ROOT / "node_modules"


def safe(js: str) -> str:
    # A literal "</script" inside inline JS would end the script tag early.
    return js.replace("</script", "<\\/script")


template = (ROOT / "src" / "template.html").read_text(encoding="utf-8")
supabase_js = (VENDOR / "@supabase/supabase-js/dist/umd/supabase.js").read_text(encoding="utf-8")
qrcode_js = (VENDOR / "qrcode-generator/dist/qrcode.js").read_text(encoding="utf-8")
app_js = (ROOT / "src" / "app.js").read_text(encoding="utf-8")

html = (
    template.replace("/*__SUPABASE__*/", safe(supabase_js))
    .replace("/*__QRCODE__*/", safe(qrcode_js))
    .replace("/*__APP__*/", safe(app_js))
)

out = ROOT / "index.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({len(html) // 1024} KB)")
