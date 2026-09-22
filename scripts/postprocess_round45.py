#!/usr/bin/env python3
"""Post-process Persona OS report docx:
1. Remove empty <w:pgNumType/> from document.xml (WPS compatibility).
2. Patch footer PAGE fields: front-matter section -> \\* ROMAN, body section -> \\* arabic.
"""
import re, sys, zipfile, shutil

DOCX = "/home/z/my-project/download/Persona-OS-Red-Team-Report-Rounds-4-5.docx"
TMP = DOCX + ".tmp"

with zipfile.ZipFile(DOCX, "r") as z:
    names = z.namelist()
    files = {n: z.read(n) for n in names}

doc_xml = files["word/document.xml"].decode("utf-8")

# 1. Remove empty pgNumType (self-closing, no attributes)
before = doc_xml.count("<w:pgNumType/>")
doc_xml = doc_xml.replace("<w:pgNumType/>", "")
print(f"Removed {before} empty <w:pgNumType/> tags")

# 2. Locate sectPr blocks in document order
sect_blocks = re.findall(r"<w:sectPr\b[\s\S]*?</w:sectPr>", doc_xml)
print(f"Found {len(sect_blocks)} sectPr blocks")

def footer_ids(block):
    return re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', block)

rels_xml = files["word/_rels/document.xml.rels"].decode("utf-8")
def rel_target(rid):
    m = re.search(r'<Relationship[^>]*Id="%s"[^>]*Target="([^"]+)"' % re.escape(rid), rels_xml)
    if not m:  # attribute order may differ
        m = re.search(r'<Relationship[^>]*Target="([^"]+)"[^>]*Id="%s"' % re.escape(rid), rels_xml)
    return ("word/" + m.group(1)) if m else None

cover_sect, front_sect, body_sect = sect_blocks[0], sect_blocks[1], sect_blocks[2]
front_footers = [rel_target(r) for r in footer_ids(front_sect)]
body_footers = [rel_target(r) for r in footer_ids(body_sect)]
cover_footers = [rel_target(r) for r in footer_ids(cover_sect)]
print("cover footers:", cover_footers, "| front footers:", front_footers, "| body footers:", body_footers)

def patch_footer(path, fmt):
    xml = files[path].decode("utf-8")
    new_xml, n = re.subn(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        r"\1 PAGE \\* %s \\* MERGEFORMAT \2" % fmt,
        xml,
    )
    files[path] = new_xml.encode("utf-8")
    print(f"Patched {path}: {n} PAGE field(s) -> \\* {fmt}")

for f in set(front_footers):
    if f: patch_footer(f, "ROMAN")
for f in set(body_footers):
    if f and f not in front_footers: patch_footer(f, "arabic")

files["word/document.xml"] = doc_xml.encode("utf-8")

with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as z:
    for n in names:
        z.writestr(n, files[n])
shutil.move(TMP, DOCX)
print("OK: post-processing complete")
