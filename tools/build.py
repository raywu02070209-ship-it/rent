"""把 Claude 版紀錄簿（rental-log.html）轉成網站版 index.html。
用法：python3 tools/build.py ../rental-log.html index.html"""
import re, sys, pathlib
src, out = sys.argv[1], sys.argv[2]
s = pathlib.Path(src).read_text(encoding="utf8")

# 1) 檔案網址：/_blob/<id> 改成 BL(id)（Firebase 的檔案直接存完整網址）
s, n1 = re.subn(r'/_blob/\$\{esc\(([^()]*(?:\([^()]*\))?[^()]*)\)\}', r'${esc(BL(\1))}', s)
s, n2 = re.subn(r'"/_blob/" \+ ([\w.\[\]]+)', r'BL(\1)', s)
assert "/_blob/" not in s, "還有沒轉換的 /_blob/"

# 2) 拆出 <title>/<link>/<style>（放 head）與其餘內容（放 body）
title = re.search(r"<title>.*?</title>", s, re.S).group(0)
s = s.replace(title, "", 1)
head_links = "".join(re.findall(r'<link[^>]*>\n?', s.split("<style>")[0]))
for l in re.findall(r'<link[^>]*>\n?', s.split("<style>")[0]): s = s.replace(l, "", 1)

# 3) 在紀錄簿程式最前面加 BL()
s = s.replace("<script>", '<script>\nconst BL = id => /^https?:/.test(id||"") ? id : "/_blob/" + id;\n', 1)

shell = pathlib.Path(__file__).with_name("shell.html").read_text(encoding="utf8")
html = (shell.replace("{{TITLE}}", title).replace("{{HEAD_LINKS}}", head_links).replace("{{APP}}", s))
pathlib.Path(out).write_text(html, encoding="utf8")
print("ok", n1, n2)
