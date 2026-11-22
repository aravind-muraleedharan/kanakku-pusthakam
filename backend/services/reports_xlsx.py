"""Reports as a styled Excel file (.xlsx), written with Python's own zipfile - no extra library, works offline.

Same look as the Monthly Budget export, plus real Excel charts (they read the numbers in the sheet). One workbook:
  Summary     - totals (with the period before, when it can be compared), month by month + a chart, how expenses were paid
  Categories  - expense and income per category, each with a bar chart
  Expense by month / Income by month - months x categories, shaded like the page (only when the period has 2+ months)
"""
import io
import zipfile
from datetime import date, timedelta
from xml.sax.saxutils import escape

from ..db import one
from . import reports as svc
from .budget_xlsx import FULL, INR, MON, Styles, _col, _month_label

GREEN, RED, INK, GREY, LINE_C = "3FA66B", "E0735F", "1F2A44", "7A8194", "D5D9E3"


def _date_label(d):
    y, m, dd = d.split("-")
    return f"{int(dd)} {MON[int(m) - 1]} {y}"


def _rupees(v):
    """Indian grouping for text: 151239 -> ₹1,51,239"""
    s = str(int(round(abs(v))))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return "₹" + s


# ---------------------------------------------------------------- the period before (same rules as the Reports page)

def previous_period(dfrom, dto, today):
    """(from, to, label) of the same-length period just before; None for All time or when your records don't reach back."""
    if not dfrom or not dto:
        return None
    to = min(dto, today.isoformat())
    if dfrom[8:] == "01" and dto == svc.month_bounds(dto[:7])[1]:
        n = (int(dto[:4]) - int(dfrom[:4])) * 12 + int(dto[5:7]) - int(dfrom[5:7]) + 1
        pfrom = svc.month_bounds(svc.shift_month(dfrom[:7], -n))[0]
        m = svc.shift_month(to[:7], -n)
        day = min(int(to[8:]), int(svc.month_bounds(m)[1][8:]))
        pto = f"{m}-{day:02d}"
        label = (FULL[int(m[5:]) - 1] + (f" (1–{day})" if to < dto else "")) if n == 1 else f"previous {n} months"
    else:
        a, b = date.fromisoformat(dfrom), date.fromisoformat(to)
        days = (b - a).days + 1
        pfrom, pto = (a - timedelta(days=days)).isoformat(), (a - timedelta(days=1)).isoformat()
        label = f"previous {days} days"
    first = one("SELECT MIN(date) AS d FROM entries")["d"]
    if not first or first > pfrom:
        return None
    return pfrom, pto, label


def _change(now, before, up_is_good):
    """('▲ 6%', good?) or None - the same as the pills on the page."""
    if not before or (now > 0) != (before > 0):
        return None
    pct = (now - before) * 100 / abs(before)
    if abs(pct) < 0.5:
        return "same", None
    text = f"{now / before:.1f}×" if abs(pct) >= 300 else f"{round(abs(pct))}%"
    return f"{'▲' if pct > 0 else '▼'} {text}", (pct > 0) == up_is_good


# ---------------------------------------------------------------- sheets, charts, the package

class _Sheet:
    """Rows of cells (column, "s"|"n", value, style id), plus merges, column widths, a frozen header and charts."""
    def __init__(self, name, widths):
        self.name, self.widths, self.rows, self.merges, self.freeze, self.r = name, widths, [], [], None, 0
        self.charts = []          # (chart xml, (col0, row0, col1, row1)) - zero-based cell corners

    def add(self, cells=(), height=None):
        self.r += 1
        self.rows.append((self.r, list(cells), height))
        return self.r

    def ref(self, col, r1, r2=None):
        return f"'{self.name}'!${_col(col)}${r1}" + (f":${_col(col)}${r2}" if r2 else "")

    def xml(self):
        def cell(row, col, kind, val, style):
            ref = f"{_col(col)}{row}"
            if kind == "n" and val is not None:
                v = int(val) if float(val).is_integer() else round(float(val), 4)
                return f'<c r="{ref}" s="{style}"><v>{v}</v></c>'
            if val in (None, ""):
                return f'<c r="{ref}" s="{style}"/>'
            return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(val))}</t></is></c>'
        body = "".join(f'<row r="{r}"' + (f' ht="{h}" customHeight="1"' if h else "") + ">"
                       + "".join(cell(r, *c) for c in sorted(cells, key=lambda c: c[0])) + "</row>" for r, cells, h in self.rows)
        cols = "".join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in enumerate(self.widths, 1))
        pane = (f'<pane xSplit="1" ySplit="{self.freeze}" topLeftCell="B{self.freeze + 1}" activePane="bottomRight" state="frozen"/>'
                if self.freeze else "")
        merges = (f'<mergeCells count="{len(self.merges)}">' + "".join(f'<mergeCell ref="{m}"/>' for m in self.merges)
                  + "</mergeCells>") if self.merges else ""
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
                f'<sheetViews><sheetView workbookViewId="0" showGridLines="0">{pane}</sheetView></sheetViews>'
                '<sheetFormatPr defaultRowHeight="19" customHeight="1"/>'
                f'<cols>{cols}</cols><sheetData>{body}</sheetData>{merges}'
                '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
                '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
                + ('<drawing r:id="rId1"/>' if self.charts else "") + "</worksheet>")


def _txt(size, color, bold=False):
    b = ' b="1"' if bold else ""
    return (f'<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="{size}"{b}>'
            f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-IN"/></a:p></c:txPr>')


def bar_chart(title, cats_ref, cats, series, horizontal=False, labels=False):
    """An Excel bar/column chart. series: [(name, name ref, values ref, values, colour)]."""
    def str_cache(vals):
        return f'<c:strCache><c:ptCount val="{len(vals)}"/>' + "".join(
            f'<c:pt idx="{i}"><c:v>{escape(str(v))}</c:v></c:pt>' for i, v in enumerate(vals)) + "</c:strCache>"

    def num_cache(vals):
        return f'<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{len(vals)}"/>' + "".join(
            f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(vals)) + "</c:numCache>"

    dlbls = (f'<c:dLbls><c:numFmt formatCode="{INR}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
             f'{_txt(900, "4A5168")}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>'
             '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>') if labels else ""
    sers = "".join(
        f'<c:ser><c:idx val="{i}"/><c:order val="{i}"/><c:tx><c:strRef><c:f>{name_ref}</c:f>{str_cache([name])}</c:strRef></c:tx>'
        f'<c:spPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>{dlbls}'
        f'<c:cat><c:strRef><c:f>{cats_ref}</c:f>{str_cache(cats)}</c:strRef></c:cat>'
        f'<c:val><c:numRef><c:f>{vals_ref}</c:f>{num_cache(vals)}</c:numRef></c:val></c:ser>'
        for i, (name, name_ref, vals_ref, vals, color) in enumerate(series))
    axis_line = f'<c:spPr><a:ln><a:solidFill><a:srgbClr val="{LINE_C}"/></a:solidFill></a:ln></c:spPr>'
    grid = "" if horizontal else '<c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="EEF0F5"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'
    legend = ('<c:legend><c:legendPos val="t"/><c:overlay val="0"/>' + _txt(1000, "4A5168") + "</c:legend>") if len(series) > 1 else ""
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>'
            '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-IN" sz="1200" b="1">'
            f'<a:solidFill><a:srgbClr val="{INK}"/></a:solidFill></a:rPr><a:t>{escape(title)}</a:t></a:r></a:p></c:rich></c:tx>'
            '<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>'
            f'<c:barChart><c:barDir val="{"bar" if horizontal else "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>{sers}'
            f'<c:gapWidth val="{55 if horizontal else 70}"/><c:overlap val="{0 if horizontal else -8}"/><c:axId val="101"/><c:axId val="102"/></c:barChart>'
            f'<c:catAx><c:axId val="101"/><c:scaling><c:orientation val="{"maxMin" if horizontal else "minMax"}"/></c:scaling><c:delete val="0"/>'
            f'<c:axPos val="{"l" if horizontal else "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/>'
            f'<c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>{axis_line}{_txt(900, GREY)}<c:crossAx val="102"/><c:crosses val="autoZero"/>'
            '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
            f'<c:valAx><c:axId val="102"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="{1 if horizontal else 0}"/>'
            f'<c:axPos val="{"b" if horizontal else "l"}"/>{grid}'
            f'<c:numFmt formatCode="{INR}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
            f'<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>{_txt(900, GREY)}<c:crossAx val="101"/><c:crosses val="autoZero"/>'
            f'<c:crossBetween val="between"/></c:valAx></c:plotArea>{legend}'
            '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
            f'<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="{LINE_C}"/></a:solidFill></a:ln></c:spPr>'
            '</c:chartSpace>')


def _drawing(anchors):
    parts = "".join(
        f'<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>{c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
        f'<xdr:to><xdr:col>{c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
        f'<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{i + 2}" name="Chart {i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        f'<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId{i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame>'
        '<xdr:clientData/></xdr:twoCellAnchor>' for i, (c0, r0, c1, r1) in enumerate(anchors))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            f'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{parts}</xdr:wsDr>')


def _rels(targets, kind):
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{t}"/>'
                      for i, t in enumerate(targets, 1)) + "</Relationships>")


def _package(sheets, st):
    files, ct, chart_no = {}, [], 0
    for i, s in enumerate(sheets, 1):
        files[f"xl/worksheets/sheet{i}.xml"] = s.xml()
        ct.append(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        if s.charts:
            files[f"xl/worksheets/_rels/sheet{i}.xml.rels"] = _rels([f"../drawings/drawing{i}.xml"], "drawing")
            files[f"xl/drawings/drawing{i}.xml"] = _drawing([a for _, a in s.charts])
            ct.append(f'<Override PartName="/xl/drawings/drawing{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>')
            names = []
            for xml, _ in s.charts:
                chart_no += 1
                files[f"xl/charts/chart{chart_no}.xml"] = xml
                names.append(f"../charts/chart{chart_no}.xml")
                ct.append(f'<Override PartName="/xl/charts/chart{chart_no}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>')
            files[f"xl/drawings/_rels/drawing{i}.xml.rels"] = _rels(names, "chart")
    files["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + "".join(ct) + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
    files["_rels/.rels"] = _rels(["xl/workbook.xml"], "officeDocument")
    files["xl/workbook.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + "".join(f'<sheet name="{escape(s.name)}" sheetId="{i}" r:id="rId{i}"/>' for i, s in enumerate(sheets, 1)) + "</sheets></workbook>")
    wb_rels = _rels([f"worksheets/sheet{i}.xml" for i in range(1, len(sheets) + 1)], "worksheet")
    files["xl/_rels/workbook.xml.rels"] = wb_rels.replace(
        "</Relationships>", f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    files["xl/styles.xml"] = st.xml()       # last: the sheets above hand out the style ids it lists
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


# ---------------------------------------------------------------- the workbook

def build(dfrom=None, dto=None, label="", today=None):
    """Returns (file bytes, file name), or (None, None) when the period has no transactions."""
    summ = svc.summary(dfrom, dto)
    if not summ["entries"]:
        return None, None
    t = today or date.today()
    cur = t.strftime("%Y-%m")
    months = [m for m in svc.monthly(dfrom, dto) if m["month"] <= cur or m["entries"]]
    single = len(months) <= 1
    period = (f"{_date_label(dfrom) if dfrom else 'the start'} – {_date_label(dto) if dto else 'today'}"
              if dfrom or dto else "All time")
    sub = f"{label + '  |  ' if label and label != period else ''}{period}  |  exported {t.day} {MON[t.month - 1]} {t.year}"
    prev = previous_period(dfrom, dto, t)
    before = svc.summary(prev[0], prev[1]) if prev else None
    st = Styles(vcenter=True)
    span = 4 if prev else 2                            # columns in the totals table

    def c(col, kind, val, base, row="item"):          # a table cell: light lines all round
        top = "total" if row == "total" else "thin" if row == "head" else ""
        return (col, kind, val, st(base, "thin", "thin", top, "row"))

    def plain(col, kind, val, base):
        return (col, kind, val, st(base))

    def blanks(start):
        return [c(i, "s", "", "item") for i in range(start, span + 1)]

    def heading(sh, title, width):
        sh.add([plain(1, "s", title, "title")], 30)
        sh.merges.append(f"A{sh.r}:{_col(width)}{sh.r}")
        sh.add([plain(1, "s", sub, "sub")], 18)
        sh.merges.append(f"A{sh.r}:{_col(width)}{sh.r}")
        sh.add(height=10)

    def section(sh, title):
        sh.add([plain(1, "s", title, "h2")], 24)

    def head(sh, labels):
        sh.add([c(i, "s", h, "head_l" if i == 1 else "head_r", "head") for i, h in enumerate(labels, 1)], 22)

    sheets = []

    # ---------------------------------------------------------------- Summary
    sh = _Sheet("Summary", [36, 17, 17, 14, 13, 17, 17])
    heading(sh, "Reports: Summary", 7)
    section(sh, "Totals for the period")
    head(sh, ["", "This period"] + (["Previous period", "Change"] if prev else []))
    net_inv = round(summ["invested"] - summ["redeemed_principal"], 2)

    def total_row(lbl, key, base, up_is_good, lbl_base="lbl"):
        v = summ[key]
        cells = [c(1, "s", lbl, lbl_base), c(2, "n", abs(v), "tot_neg" if v < 0 else base)]
        if prev:
            b = before[key]
            ch = _change(v, b, up_is_good)
            cells += [c(3, "n", abs(b), "neg" if b < 0 else "amt_sub"),
                      c(4, "s", ch[0], "nil" if ch[1] is None else "good" if ch[1] else "bad") if ch else c(4, "s", "", "nil")]
        sh.add(cells)

    total_row("Income", "income", "amt_in", True)
    total_row("Expense", "expense", "amt_ex", False)
    total_row("Net savings", "net", "amt_b", True, "lbl_b")
    if summ["income"] <= 0:
        sh.add([c(1, "s", "No income in this period", "note_bad")] + blanks(2))
    elif summ["net"] < 0:
        sh.add([c(1, "s", f"Spent {_rupees(-summ['net'])} more than earned", "note_bad")] + blanks(2))
    else:
        sh.add([c(1, "s", "Saved (of income)", "lbl"), c(2, "n", summ["savings_rate"] / 100, "pct")]
               + ([c(3, "n", before["savings_rate"] / 100, "pct") if before["savings_rate"] is not None and before["net"] >= 0
                   else c(3, "s", "", "nil"), c(4, "s", "", "nil")] if prev else []))
    sh.add([c(1, "s", "Net withdrawn" if net_inv < 0 else "Net invested", "lbl_b"), c(2, "n", abs(net_inv), "amt_inv")] + blanks(3))
    sh.add([c(1, "s", "▲ Put in", "sub_item"), c(2, "n", summ["invested"], "amt_sub")] + blanks(3))
    sh.add([c(1, "s", "▼ Came back", "sub_item"), c(2, "n", summ["redeemed_principal"], "amt_sub")] + blanks(3))
    if not single:
        done = [m for m in months if m["month"] < cur] or months
        for lbl, k in (("Average income a month", "income"), ("Average expense a month", "expense")):
            sh.add([c(1, "s", lbl, "lbl"), c(2, "n", round(sum(m[k] for m in done) / len(done)), "amt")] + blanks(3))
        if len(done) < len(months):
            sh.add([plain(1, "s", f"{_month_label(cur)} isn't over yet, so it's left out of the averages.", "sub")])
    if prev:
        sh.add([plain(1, "s", f"Previous period: {_date_label(prev[0])} – {_date_label(prev[1])}", "sub")])
    sh.add(height=10)

    if not single:
        section(sh, "Month by month")
        head(sh, ["Month", "Income", "Expense", "Net", "Saved %", "Invested", "Running net"])
        first = sh.r + 1
        for m in months:
            net = m["net"]
            saved = net / m["income"] if m["income"] > 0 and net >= 0 else None
            sh.add([c(1, "s", _month_label(m["month"]), "lbl"),
                    c(2, "n", m["income"], "amt_in"), c(3, "n", m["expense"], "amt_ex"),
                    c(4, "n", abs(net), "neg" if net < 0 else "amt_b"),
                    c(5, "n", saved, "pct") if saved is not None else c(5, "s", "–", "nil"),
                    c(6, "n", m["invested"], "amt_inv") if m["invested"] else c(6, "s", "–", "nil"),
                    c(7, "n", abs(m["cumulative_net"]), "neg" if m["cumulative_net"] < 0 else "amt")])
        last = sh.r
        sh.add([c(1, "s", "Total", "tot_l", "total"), c(2, "n", summ["income"], "tot_in", "total"),
                c(3, "n", summ["expense"], "tot_ex", "total"),
                c(4, "n", abs(summ["net"]), "tot_neg" if summ["net"] < 0 else "tot", "total"),
                c(5, "n", summ["savings_rate"] / 100, "tot_pct", "total") if summ["savings_rate"] is not None and summ["net"] >= 0
                else c(5, "s", "", "tot_l", "total"),
                c(6, "n", summ["invested"], "tot", "total"), c(7, "s", "", "tot_l", "total")])
        sh.add(height=10)
        # chart: income vs expense, month by month (it reads the table above)
        labels = [f"{MON[int(m['month'][5:]) - 1]} {m['month'][2:4]}" for m in months]
        chart = bar_chart("Income and expense, month by month", sh.ref(1, first, last), labels,
                          [("Income", sh.ref(2, first - 1), sh.ref(2, first, last), [m["income"] for m in months], GREEN),
                           ("Expense", sh.ref(3, first - 1), sh.ref(3, first, last), [m["expense"] for m in months], RED)])
        top = sh.r
        sh.charts.append((chart, (0, top, 7, top + 18)))
        for _ in range(19):
            sh.add()
        sh.add(height=10)

    modes = svc.group_totals("payment_mode_id", "payment_modes", dfrom, dto)
    if modes:
        section(sh, "How expenses were paid")
        head(sh, ["Payment mode", "Transactions", "Amount", "Share"])
        for x in modes:
            sh.add([c(1, "s", x["name"], "lbl"), c(2, "n", x["count"], "cnt"), c(3, "n", x["amount"], "amt"), c(4, "n", x["share"] / 100, "pct")])
        sh.add([c(1, "s", "Total", "tot_l", "total"), c(2, "n", sum(x["count"] for x in modes), "tot_cnt", "total"),
                c(3, "n", sum(x["amount"] for x in modes), "tot", "total"), c(4, "n", 1, "tot_pct", "total")])
    sheets.append(sh)

    # ---------------------------------------------------------------- Categories (each table with a bar chart beside it)
    sh = _Sheet("Categories", [36, 14, 17, 11, 3] + [10] * 9)
    heading(sh, "Reports: Categories", 4)
    for kind, title, band, amt_base, tot_base, color in (("expense", "Expense", "sec_ex", "amt_ex", "tot_ex", RED),
                                                         ("income", "Income", "sec_in", "amt_in", "tot_in", GREEN)):
        data = svc.category_totals(kind, dfrom, dto)
        if not data["items"]:
            continue
        top = sh.r
        sh.add([plain(i, "s", title if i == 1 else "", band) for i in range(1, 5)], 24)
        head(sh, ["Category", "Transactions", "Amount", "Share"])
        first = sh.r + 1
        items = data["items"]
        for x in items:
            sh.add([c(1, "s", x["name"], "lbl"), c(2, "n", x["count"], "cnt"), c(3, "n", x["amount"], amt_base), c(4, "n", x["share"] / 100, "pct")])
        last = sh.r
        sh.add([c(1, "s", f"Total {title.lower()}", "tot_l", "total"), c(2, "n", sum(x["count"] for x in items), "tot_cnt", "total"),
                c(3, "n", data["total"], tot_base, "total"), c(4, "n", 1, "tot_pct", "total")])
        if len(items) > 1:
            chart = bar_chart(f"{title} by category", sh.ref(1, first, last), [x["name"] for x in items],
                              [(title, sh.ref(3, first - 1), sh.ref(3, first, last), [x["amount"] for x in items], color)],
                              horizontal=True, labels=True)
            height = max(len(items) + 3, 12)
            sh.charts.append((chart, (5, top, 14, top + height)))
            while sh.r < top + height:
                sh.add()
        sh.add(height=14)
    sheets.append(sh)

    # ---------------------------------------------------------------- categories x months (shaded like the page)
    # one row per category, one column per month (oldest first), a Total column and a Total row
    if not single:
        for kind, title, shade, tot_base in (("expense", "Expense by month", "ex", "tot_ex"), ("income", "Income by month", "in", "tot_in")):
            g = svc.month_category_grid(dfrom, dto, kind)
            if not g["categories"]:
                continue
            rows_m = sorted(g["rows"], key=lambda r: r["month"])
            width = len(rows_m) + 2
            sh = _Sheet(title, [34] + [13] * len(rows_m) + [15])
            heading(sh, f"Reports: {title}", min(width, 8))
            sh.add([c(1, "s", "Category", "head_l", "head")]
                   + [c(i, "s", f"{MON[int(r['month'][5:]) - 1]} {r['month'][:4]}", "head_r", "head") for i, r in enumerate(rows_m, 2)]
                   + [c(width, "s", "Total", "head_r", "head")], 22)
            sh.freeze = sh.r
            top_v = max((v for r in rows_m for v in r["values"]), default=0) or 1
            for ci, cat in enumerate(g["categories"]):
                cells = [c(1, "s", cat["name"], "lbl")]
                for i, r in enumerate(rows_m, 2):
                    v = r["values"][ci]
                    level = 1 + min(2, int(3 * v / top_v)) if v else 0
                    cells.append(c(i, "n", v, f"{shade}{level}") if v else c(i, "s", "–", "nil"))
                cells.append(c(width, "n", cat["total"], "amt_b"))
                sh.add(cells)
            sh.add([c(1, "s", "Total", "tot_l", "total")] + [c(i, "n", r["total"], "tot", "total") for i, r in enumerate(rows_m, 2)]
                   + [c(width, "n", g["grand_total"], tot_base, "total")])
            sheets.append(sh)

    data = _package(sheets, st)
    name = "reports_" + (f"{dfrom or 'start'}_to_{dto or t.isoformat()}" if dfrom or dto else "all_time") + ".xlsx"
    return data, name
