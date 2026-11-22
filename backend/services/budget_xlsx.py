"""Monthly Budget as a styled Excel file (.xlsx), written with Python's own zipfile - no extra library, works offline.

One sheet: a title, then for each month that has entries three columns (Amount, Paid, Note); Income and Expenses
sections with their items and totals, then Paid / Still to pay / Income - expenses. Amounts use Indian grouping (1,23,456).
"""
import io
import zipfile
from datetime import date
from xml.sax.saxutils import escape

from . import budget as svc

MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
        "November", "December"]


def _month_label(m):
    y, mo = m.split("-")
    return f"{FULL[int(mo) - 1]} {y}"


def _col(n):  # 1 -> A, 27 -> AA
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


# ---- styles. A cell's look = a base (font / fill / number format / alignment) + its borders; the combinations are
# collected while the sheet is written, so each cell can carry column lines without a long fixed list.
INR = '[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0;&quot;₹&quot;##,##0'
INR_NEG = '&quot;-₹&quot;##,##0'
FONTS = ['<sz val="11"/><name val="Calibri"/>',
         '<b/><sz val="16"/><color rgb="FF1F2A44"/><name val="Calibri"/>',
         '<sz val="10"/><color rgb="FF7A8194"/><name val="Calibri"/>',
         '<b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/>',
         '<b/><sz val="10"/><color rgb="FF4A5168"/><name val="Calibri"/>',
         '<b/><sz val="11"/><color rgb="FF1E7F4F"/><name val="Calibri"/>',
         '<b/><sz val="11"/><color rgb="FFB3362B"/><name val="Calibri"/>',
         '<i/><sz val="10"/><color rgb="FF7A8194"/><name val="Calibri"/>',
         '<b/><sz val="11"/><name val="Calibri"/>',
         '<sz val="11"/><color rgb="FF1E7F4F"/><name val="Calibri"/>',      # 9 income
         '<sz val="11"/><color rgb="FFB3362B"/><name val="Calibri"/>',      # 10 expense
         '<sz val="11"/><color rgb="FF9A6B00"/><name val="Calibri"/>',      # 11 invested
         '<b/><sz val="12"/><color rgb="FF1F2A44"/><name val="Calibri"/>']  # 12 section title
FILLS = [None, "gray125", "FF2F4A7A", "FFEEF0F5", "FFE6F4EC", "FFFBE9E7", "FFF4F1E6",
         "FFFDF1EF", "FFF8D9D3", "FFF0B5AA", "FFEFF8F2", "FFD5EDDE", "FFB0DCC0"]   # 7-9 expense shades, 10-12 income shades
# base looks: (numFmt, font, fill, alignment xml)
BASE = {
    "text": (0, 0, 0, ""), "title": (0, 1, 0, ""), "sub": (0, 2, 0, ""),
    "month": (0, 3, 2, '<alignment horizontal="center" vertical="center"/>'),
    "head": (0, 4, 3, '<alignment horizontal="center"/>'),
    "sec_in": (0, 5, 4, ""), "sec_ex": (0, 6, 5, ""), "sec_sum": (0, 8, 6, ""),
    "item": (0, 0, 0, '<alignment indent="1"/>'), "amt": (164, 0, 0, ""),
    "paid": (0, 5, 0, '<alignment horizontal="center"/>'), "unpaid": (0, 2, 0, '<alignment horizontal="center"/>'),
    "note": (0, 7, 0, '<alignment wrapText="1" vertical="center"/>'),
    "tot_l": (0, 8, 0, ""), "tot": (164, 8, 0, ""), "tot_in": (164, 5, 0, ""), "tot_ex": (164, 6, 0, ""),
    "bal_ok": (164, 5, 4, ""), "bal_bad": (165, 6, 5, ""), "lbl_ok": (0, 5, 4, '<alignment horizontal="center"/>'),
    "lbl_bad": (0, 6, 5, '<alignment horizontal="center"/>'),
    # used by the Reports export
    "head_l": (0, 4, 3, ""), "head_r": (0, 4, 3, '<alignment horizontal="right"/>'), "head_w": (0, 4, 3, '<alignment horizontal="right" vertical="center" wrapText="1"/>'), "h2": (0, 12, 0, ""),
    "cnt": (3, 0, 0, ""), "pct": (166, 0, 0, ""), "tot_cnt": (3, 8, 0, ""), "tot_pct": (166, 8, 0, ""),
    "amt_in": (164, 9, 0, ""), "amt_ex": (164, 10, 0, ""), "amt_inv": (164, 11, 0, ""), "amt_b": (164, 8, 0, ""),
    "neg": (165, 10, 0, ""), "tot_neg": (165, 6, 0, ""), "nil": (0, 2, 0, '<alignment horizontal="center"/>'),
    "lbl": (0, 0, 0, '<alignment indent="1"/>'), "lbl_b": (0, 8, 0, '<alignment indent="1"/>'),
    "sub_item": (0, 2, 0, '<alignment indent="3"/>'), "amt_sub": (164, 2, 0, ""),
    "good": (0, 5, 0, '<alignment horizontal="right"/>'), "bad": (0, 6, 0, '<alignment horizontal="right"/>'),
    "note_bad": (0, 6, 0, '<alignment indent="1"/>'), "band_h": (0, 3, 2, '<alignment indent="1"/>'),
    "ex1": (164, 0, 7, ""), "ex2": (164, 0, 8, ""), "ex3": (164, 0, 9, ""),
    "in1": (164, 0, 10, ""), "in2": (164, 0, 11, ""), "in3": (164, 0, 12, ""),
}
LINE = {"thin": '<{0} style="thin"><color rgb="FFD5D9E3"/></{0}>', "month": '<{0} style="medium"><color rgb="FF2F4A7A"/></{0}>',
        "row": '<{0} style="thin"><color rgb="FFE1E4EC"/></{0}>', "total": '<{0} style="thin"><color rgb="FF9AA1B5"/></{0}>'}


class Styles:
    """Hands out cellXfs indexes for (base, left, right, top, bottom) and writes styles.xml at the end."""
    def __init__(self, vcenter=False):
        self.borders, self.xfs, self.vcenter = [("", "", "", "")], [("text", 0)], vcenter

    def __call__(self, base, left="", right="", top="", bottom=""):
        key = (left, right, top, bottom)
        if key not in self.borders:
            self.borders.append(key)
        x = (base, self.borders.index(key))
        if x not in self.xfs:
            self.xfs.append(x)
        return self.xfs.index(x)

    def xml(self):
        side = lambda tag, kind: LINE[kind].format(tag) if kind else f"<{tag}/>"
        borders = "".join(f"<border>{side('left', l)}{side('right', r)}{side('top', t)}{side('bottom', b)}<diagonal/></border>"
                          for l, r, t, b in self.borders)
        fills = "".join("<fill><patternFill patternType=\"none\"/></fill>" if f is None else
                        "<fill><patternFill patternType=\"gray125\"/></fill>" if f == "gray125" else
                        f'<fill><patternFill patternType="solid"><fgColor rgb="{f}"/></patternFill></fill>' for f in FILLS)
        xfs = ""
        for base, bid in self.xfs:
            nf, font, fill, align = BASE[base]
            if self.vcenter and "vertical=" not in align:
                align = align.replace("<alignment ", '<alignment vertical="center" ') if align else '<alignment vertical="center"/>'
            tail = ' applyAlignment="1">' + align + "</xf>" if align else "/>"
            xfs += (f'<xf numFmtId="{nf}" fontId="{font}" fillId="{fill}" borderId="{bid}" applyNumberFormat="1" applyFont="1" '
                    f'applyFill="1" applyBorder="1"{tail}')
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f'<numFmts count="3"><numFmt numFmtId="164" formatCode="{INR}"/><numFmt numFmtId="165" formatCode="{INR_NEG}"/>'
                '<numFmt numFmtId="166" formatCode="0.0%"/></numFmts>'
                f'<fonts count="{len(FONTS)}">' + "".join(f"<font>{f}</font>" for f in FONTS) + "</fonts>"
                f'<fills count="{len(FILLS)}">{fills}</fills><borders count="{len(self.borders)}">{borders}</borders>'
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                f'<cellXfs count="{len(self.xfs)}">{xfs}</cellXfs>'
                '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')


def _months_with_entries(sheet):
    """Only months that have something in them: an amount on any item."""
    keep = []
    for c in sheet["months"]:
        m = c["month"]
        if any((r["cells"].get(m) or {}).get("amount") not in (None, 0) for k in ("income", "expense") for r in sheet[k]):
            keep.append(c)
    return keep


def build(today=None):
    """Returns (file bytes, file name), or (None, None) when no month has entries."""
    sheet = svc.sheet(today)
    M = _months_with_entries(sheet)
    if not M:
        return None, None
    st = Styles(vcenter=True)               # same look as the Reports export: taller rows, text centred in them
    rows, merges = [], []     # rows: (row number, kind, [(column, "s"|"n", value, base style)], height)
    r = 0
    last_col = 1 + 3 * len(M)

    def add(kind, cells, height=None):
        nonlocal r
        r += 1
        rows.append((r, kind, cells, height))

    def spread(base, first_label=""):          # a full-width band (section heading)
        return [(1, "s", first_label, base)] + [(c, "s", "", base) for c in range(2, last_col + 1)]

    t = today or date.today()
    span = _month_label(M[0]["month"]) + (f" – {_month_label(M[-1]['month'])}" if len(M) > 1 else "")
    add("plain", [(1, "s", "Monthly Budget", "title")], 30)
    merges.append(f"A{r}:{_col(last_col)}{r}")
    add("plain", [(1, "s", f"{span}  |  exported {t.day} {MON[t.month - 1]} {t.year}", "sub")], 18)
    merges.append(f"A{r}:{_col(last_col)}{r}")
    add("plain", [], 10)
    add("head", [(1, "s", "", "month")] + [x for i, c in enumerate(M) for x in
        ((2 + 3 * i, "s", _month_label(c["month"]), "month"), (3 + 3 * i, "s", "", "month"), (4 + 3 * i, "s", "", "month"))], 22)
    merges += [f"{_col(2 + 3 * i)}{r}:{_col(4 + 3 * i)}{r}" for i in range(len(M))]
    head_row = r
    add("head", [(1, "s", "Item", "head")] + [x for i in range(len(M)) for x in
        ((2 + 3 * i, "s", "Amount", "head"), (3 + 3 * i, "s", "Paid", "head"), (4 + 3 * i, "s", "Note", "head"))], 22)

    def section(kind, title, band):
        add("band", spread(band, title), 24)
        for it in sheet[kind]:
            vals = [it["cells"].get(c["month"]) or {} for c in M]
            if all(v.get("amount") in (None, 0) and not v.get("note") for v in vals):
                continue                      # nothing in any exported month
            cells = [(1, "s", it["name"], "item")]
            for i, v in enumerate(vals):
                a, amt = 2 + 3 * i, v.get("amount")
                cells.append((a, "n", amt, "amt") if amt not in (None, "") else (a, "s", "", "amt"))
                if kind == "expense" and amt not in (None, "", 0):
                    cells.append((a + 1, "s", "✓" if v.get("done") else "–", "paid" if v.get("done") else "unpaid"))
                else:
                    cells.append((a + 1, "s", "", "item"))
                cells.append((a + 2, "s", v.get("note") or "", "note"))
            add("item", cells)
        add("total", [(1, "s", f"Total {title.lower()}", "tot_l")] + [x for i, c in enumerate(M) for x in
            ((2 + 3 * i, "n", c[kind], "tot_in" if kind == "income" else "tot_ex"), (3 + 3 * i, "s", "", "tot_l"), (4 + 3 * i, "s", "", "tot_l"))])
        add("gap", [], 10)

    section("income", "Income", "sec_in")
    section("expense", "Expenses", "sec_ex")
    add("band", spread("sec_sum", "Summary"), 24)
    for label, key in (("Paid", "paid"), ("Still to pay", "still_to_pay")):
        add("item", [(1, "s", label, "item")] + [x for i, c in enumerate(M) for x in
            ((2 + 3 * i, "n", c[key], "amt"), (3 + 3 * i, "s", "", "item"), (4 + 3 * i, "s", "", "item"))])
    cells = [(1, "s", "Income − expenses", "tot_l")]
    for i, c in enumerate(M):
        a, bal = 2 + 3 * i, c["balance"]
        cells += [(a, "n", abs(bal), "bal_bad" if bal < 0 else "bal_ok"),
                  (a + 1, "s", "Short" if bal < 0 else "Spare", "lbl_bad" if bal < 0 else "lbl_ok"), (a + 2, "s", "", "tot_l")]
    add("total", cells)

    # every table row gets its column lines: a strong line where each month starts, light lines inside it
    def style(kind, col, base):
        if kind == "plain":
            return st(base)
        if col == 1:
            left, right = "", "month"
        else:
            pos = (col - 2) % 3
            left = "month" if pos == 0 else "thin"
            right = "month" if col == last_col else ""
        top = "total" if kind == "total" else ""
        bottom = "row" if kind in ("item", "head") else ""
        return st(base, left, right, top, bottom)

    def fill_row(kind, cells):
        if kind in ("plain",):
            return cells
        have = {c[0] for c in cells}
        blank = "item" if kind != "gap" else "text"
        return sorted(cells + [(c, "s", "", blank) for c in range(1, last_col + 1) if c not in have])

    rows = [(row, kind, [(c, k, v, style(kind, c, base)) for c, k, v, base in fill_row(kind, cells)], h)
            for row, kind, cells, h in rows]

    # ---- sheet XML
    def cell_xml(row, col, kind, val, style):
        ref = f"{_col(col)}{row}"
        if kind == "n" and val is not None:
            v = int(val) if float(val).is_integer() else round(float(val), 2)
            return f'<c r="{ref}" s="{style}"><v>{v}</v></c>'
        if val in (None, ""):
            return f'<c r="{ref}" s="{style}"/>'
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(val))}</t></is></c>'

    body = []
    for row, _kind, cells, height in rows:
        ht = f' ht="{height}" customHeight="1"' if height else ""
        body.append(f'<row r="{row}"{ht}>' + "".join(cell_xml(row, *c) for c in cells) + "</row>")
    cols = ['<col min="1" max="1" width="34" customWidth="1"/>']
    for i in range(len(M)):
        a = 2 + 3 * i
        cols += [f'<col min="{a}" max="{a}" width="14" customWidth="1"/>',
                 f'<col min="{a + 1}" max="{a + 1}" width="7" customWidth="1"/>',
                 f'<col min="{a + 2}" max="{a + 2}" width="26" customWidth="1"/>']
    sheet_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                 '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
                 f'<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="{head_row + 1}" '
                 f'topLeftCell="B{head_row + 2}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
                 '<sheetFormatPr defaultRowHeight="19" customHeight="1"/>'
                 f'<cols>{"".join(cols)}</cols><sheetData>{"".join(body)}</sheetData>'
                 f'<mergeCells count="{len(merges)}">' + "".join(f'<mergeCell ref="{m}"/>' for m in merges) + "</mergeCells>"
                 '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
                 '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>')
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        "xl/styles.xml": st.xml(),
        "xl/worksheets/sheet1.xml": sheet_xml,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text)
    first, last = M[0]["month"], M[-1]["month"]
    name = f"budget_{first}" + (f"_to_{last}" if last != first else "") + ".xlsx"
    return buf.getvalue(), name
