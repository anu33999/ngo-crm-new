#!/usr/bin/env python3
"""
Ingest the two reference files into Prisma seed data.

    ./reference/Aurelius-Service-Catalogue.pdf        -> prisma/seed-data/catalogue.json
    ./reference/NGO_Packages_Kreatif_Atelier.xlsx     -> prisma/seed-data/packages.json

Run:  python3 -I scripts/ingest_reference.py     (or: npm run ingest)

Requires: pdfplumber, openpyxl   (pip install pdfplumber openpyxl)

The script is a strict parser, not a best-effort one. It exits non-zero if:
  * the catalogue does not contain exactly 206 services across 11 practice areas,
  * a practice area's parsed count differs from the count printed on the PDF contents page,
  * a service code appears twice or has an empty name,
  * a tier price in the workbook disagrees between sheets,
  * a service code referenced by a tier or add-on is not in the catalogue,
  * a tier's per-line delivery hours do not add up to its stated hours.

Nothing is invented: every value written to the JSON files comes from a cell or a
word in the reference files.  The workbook's "Economics" sheet is marked INTERNAL
by its author; it is written to a separate `internalEconomics` key so the seed can
keep it in internal-only tables.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import openpyxl
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "reference"
OUT = ROOT / "prisma" / "seed-data"
PDF_PATH = REF / "Aurelius-Service-Catalogue.pdf"
XLSX_PATH = REF / "NGO_Packages_Kreatif_Atelier.xlsx"

AREA_CODES = ["DM", "PR", "PRO", "SEO", "BR", "AD", "AN", "LG", "FM", "TP", "AV"]
CODE_RE = re.compile(r"^(" + "|".join(AREA_CODES) + r")-(\d{2})$")
EXPECTED_SERVICES = 206
EXPECTED_AREAS = 11
TIERS = ["SILVER", "GOLD", "PLATINUM"]
EXPECTED_PRICES = {"SILVER": 15000, "GOLD": 25000, "PLATINUM": 40000}  # from the brief; verified against the sheet


class IngestError(Exception):
    pass


def fail(msg: str) -> None:
    raise IngestError(msg)


# --------------------------------------------------------------------------- PDF
def parse_catalogue() -> dict:
    areas: dict[str, dict] = {}
    order: list[str] = []
    contents_counts: dict[str, int] = {}
    contents_names: dict[str, str] = {}
    expansion_codes: list[str] = []

    with pdfplumber.open(PDF_PATH) as pdf:
        total_pages = len(pdf.pages)

        # --- contents page (first page): "DM   Digital Marketing   29"
        first_text = pdf.pages[0].extract_text() or ""
        for line in first_text.splitlines():
            m = re.match(r"^\s*(" + "|".join(AREA_CODES) + r")\s+(.+?)\s+(\d+)\s*$", line)
            if m:
                contents_counts[m.group(1)] = int(m.group(3))
                contents_names[m.group(1)] = m.group(2).strip()
        if len(contents_counts) != EXPECTED_AREAS:
            fail(f"Contents page lists {len(contents_counts)} practice areas, expected {EXPECTED_AREAS}")
        # The PDF's own catalogue note names which areas it calls expansion practices.
        note = " ".join(first_text.split())
        m = re.search(r"((?:[A-Z]{2,3}) — [^.]*?) are identified in the source as expansion practices", note)
        if m:
            expansion_codes = [c for c in AREA_CODES if re.search(rf"\b{c} —", m.group(1))]

        # --- one page per practice area
        for page_index in range(total_pages):
            page = pdf.pages[page_index]
            words = page.extract_words(extra_attrs=["size", "fontname"])
            codes = [w for w in words if CODE_RE.match(w["text"]) and 7.0 <= w["size"] <= 8.0]
            if not codes:
                continue

            # header: area code (size ~9), area name (size ~21), tagline (size ~8.8, above the grid)
            first_code_top = min(w["top"] for w in codes)
            header_code = [w for w in words if w["text"] in AREA_CODES and 8.5 <= w["size"] <= 9.5 and w["top"] < 80]
            header_name = [w for w in words if w["size"] > 18]
            tagline = [w for w in words if 8.4 <= w["size"] <= 9.0 and 90 < w["top"] < first_code_top - 8]
            if len(header_code) != 1:
                fail(f"Page {page_index + 1}: expected one practice-area code in the header, found {len(header_code)}")
            area_code = header_code[0]["text"]
            area_name = " ".join(w["text"] for w in sorted(header_name, key=lambda w: (round(w["top"]), w["x0"])))
            area_tagline = " ".join(w["text"] for w in sorted(tagline, key=lambda w: (round(w["top"]), w["x0"])))

            # name words: bold ~9.1pt text in the grid
            name_words = [w for w in words if 8.8 <= w["size"] <= 9.5 and w["top"] >= first_code_top - 12]

            def column(x0: float) -> int:
                return 0 if x0 < page.width / 2 else 1

            services = []
            for col in (0, 1):
                col_codes = sorted((w for w in codes if column(w["x0"]) == col), key=lambda w: w["top"])
                for i, cw in enumerate(col_codes):
                    top_lo = cw["top"] - 10
                    top_hi = (col_codes[i + 1]["top"] - 10) if i + 1 < len(col_codes) else 10_000
                    parts = [
                        w for w in name_words
                        if column(w["x0"]) == col and w["x0"] > cw["x0"] + 20 and top_lo <= w["top"] < top_hi
                    ]
                    parts.sort(key=lambda w: (round(w["top"]), w["x0"]))
                    name = " ".join(w["text"] for w in parts).strip()
                    if not name:
                        fail(f"Page {page_index + 1}: no name found for {cw['text']}")
                    services.append({"code": cw["text"], "name": name, "sourcePage": page_index + 1})

            for s in services:
                if not s["code"].startswith(area_code + "-"):
                    fail(f"Service {s['code']} found on the {area_code} page")
            services.sort(key=lambda s: int(s["code"].split("-")[1]))
            for i, s in enumerate(services):
                s["sortOrder"] = i + 1

            if area_code in areas:
                fail(f"Practice area {area_code} appears on more than one page")
            areas[area_code] = {
                "code": area_code,
                "name": area_name,
                "tagline": area_tagline,
                "isExpansionPractice": area_code in expansion_codes,
                "expectedServiceCount": contents_counts.get(area_code),
                "services": services,
            }
            order.append(area_code)

    # --- validation
    if sorted(areas) != sorted(AREA_CODES):
        fail(f"Practice areas parsed {sorted(areas)} != expected {sorted(AREA_CODES)}")
    seen: set[str] = set()
    total = 0
    for code in AREA_CODES:
        a = areas[code]
        if contents_names.get(code) and contents_names[code].replace("&", "&") != a["name"]:
            fail(f"{code}: header name '{a['name']}' != contents name '{contents_names[code]}'")
        n = len(a["services"])
        if n != a["expectedServiceCount"]:
            fail(f"{code}: parsed {n} services but the contents page says {a['expectedServiceCount']}")
        nums = [int(s["code"].split("-")[1]) for s in a["services"]]
        if nums != list(range(1, n + 1)):
            fail(f"{code}: service numbers are not contiguous 1..{n}: {nums}")
        for s in a["services"]:
            if s["code"] in seen:
                fail(f"Duplicate service code {s['code']}")
            seen.add(s["code"])
        total += n
    if total != EXPECTED_SERVICES:
        fail(f"Parsed {total} services, expected {EXPECTED_SERVICES}")

    return {
        "source": PDF_PATH.name,
        "internalLabel": "Aurelius",
        "publicName": "Kreatif Atelier",
        "totalServices": total,
        "practiceAreas": [
            {**areas[c], "sortOrder": i + 1} for i, c in enumerate(AREA_CODES)
        ],
    }


# -------------------------------------------------------------------------- XLSX
CODES_IN_TEXT = re.compile(r"\b(?:%s)-\d{2}\b" % "|".join(AREA_CODES))


def codes_in(text) -> list[str]:
    return list(dict.fromkeys(CODES_IN_TEXT.findall(str(text or ""))))


def num(value):
    if isinstance(value, (int, float)):
        return value
    return None


def parse_code_list(text: str) -> list[dict]:
    """'DM-01, SEO-02 (light), FM-24 (limited)' -> [{code, qualifier}]"""
    out = []
    for part in str(text).split(","):
        part = part.strip()
        m = re.match(r"^((?:" + "|".join(AREA_CODES) + r")-\d{2})\s*(?:\((.+?)\))?$", part)
        if not m:
            fail(f"Cannot parse catalogue code token '{part}' in '{text}'")
        out.append({"code": m.group(1), "qualifier": m.group(2)})
    return out


def parse_packages(catalogue_codes: set[str]) -> dict:
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=False)
    required = {"Packages", "Platinum", "Gold", "Silver", "Add-ons", "Quote builder", "Economics"}
    missing = required - set(wb.sheetnames)
    if missing:
        fail(f"Workbook is missing sheets: {sorted(missing)}")

    # ---- Packages (comparison grid)
    ws = wb["Packages"]
    header = {ws.cell(4, c).value: c for c in (2, 3, 4)}
    if set(header) != {"PLATINUM", "GOLD", "SILVER"}:
        fail(f"Unexpected tier headers on Packages sheet: {list(header)}")
    grid: dict[str, dict] = {t: {} for t in TIERS}
    for r in range(5, ws.max_row + 1):
        label = ws.cell(r, 1).value
        if not label or str(label).startswith("Posts beyond"):
            continue
        for tier, col in header.items():
            grid[tier][str(label)] = ws.cell(r, col).value
    packages_note = ws["A2"].value

    tiers = {}
    for tier in TIERS:
        g = grid[tier]
        price = g.get("Monthly price (₹)")
        if price != EXPECTED_PRICES[tier]:
            fail(f"{tier} price in workbook is {price}, brief says {EXPECTED_PRICES[tier]}")
        tiers[tier] = {
            "tier": tier,
            "name": tier.capitalize(),
            "monthlyPriceInr": int(price),
            "gstExtra": "exclude GST" in str(packages_note),
            "bestFor": g.get("Best for"),
            "primaryObjective": g.get("Primary objective served"),
            "platformsManaged": g.get("Platforms managed"),
            "postsPerMonth": int(g["Social posts per month"]),
            "reelsPerMonth": g.get("Reels / short videos per month"),
            "includedServices": parse_code_list(g["Aurelius codes included"]),
            "attributes": {k: v for k, v in g.items() if k not in {"Estimated delivery hours per month"}},
            "_estimatedHours": g.get("Estimated delivery hours per month"),
        }

    # ---- per-tier deliverable sheets
    for tier in TIERS:
        ws = wb[tier.capitalize()]
        title = str(ws["A1"].value)
        m = re.search(r"₹([\d,]+)\s*/\s*month", title)
        if not m or int(m.group(1).replace(",", "")) != tiers[tier]["monthlyPriceInr"]:
            fail(f"{tier}: sheet title '{title}' disagrees with the Packages sheet price")
        hm = re.search(r"Estimated ([\d.]+) delivery hours", str(ws["A2"].value))
        sheet_hours = float(hm.group(1)) if hm else None
        if sheet_hours != float(tiers[tier]["_estimatedHours"]):
            fail(f"{tier}: delivery hours differ between sheets ({sheet_hours} vs {tiers[tier]['_estimatedHours']})")
        headers = [ws.cell(4, c).value for c in range(1, 8)]
        expected_headers = ["Deliverable", "Qty / month", "Format and scope", "NGO supplies",
                            "Produce → approve → publish", "Output measure", "Excluded from the deliverable"]
        if headers != expected_headers:
            fail(f"{tier}: unexpected deliverable columns {headers}")
        deliverables = []
        for r in range(5, ws.max_row + 1):
            name = ws.cell(r, 1).value
            if not name or str(name).startswith("Anything beyond"):
                continue
            qty = ws.cell(r, 2).value
            deliverables.append({
                "name": str(name),
                "quantityText": str(qty) if qty is not None else None,
                "quantityNumeric": float(qty) if isinstance(qty, (int, float)) or (isinstance(qty, str) and re.fullmatch(r"\d+(\.\d+)?", qty)) else None,
                "formatAndScope": ws.cell(r, 3).value,
                "ngoSupplies": ws.cell(r, 4).value,
                "workflow": ws.cell(r, 5).value,
                "outputMeasure": ws.cell(r, 6).value,
                "exclusions": ws.cell(r, 7).value,
                "serviceCodes": codes_in(name),
                "sortOrder": len(deliverables) + 1,
            })
        tiers[tier]["deliverables"] = deliverables
        tiers[tier]["scopeNote"] = next(
            (str(ws.cell(r, 1).value) for r in range(5, ws.max_row + 1)
             if str(ws.cell(r, 1).value or "").startswith("Anything beyond")), None)

    # ---- Add-ons
    ws = wb["Add-ons"]
    if [ws.cell(4, c).value for c in range(1, 6)] != ["Category", "Add-on / item", "Aurelius code", "Unit price (₹)", "Basis and notes"]:
        fail("Unexpected Add-ons columns")
    kinds = {"Recurring": "RECURRING", "Setup": "SETUP", "Project": "PROJECT"}
    add_ons = []
    for r in range(5, ws.max_row + 1):
        cat, name, code_text, price, basis = (ws.cell(r, c).value for c in range(1, 6))
        if not cat or str(cat) not in kinds:
            continue
        if not isinstance(price, (int, float)):
            fail(f"Add-on row {r} ({name}) has a non-numeric price: {price!r}")
        basis_s = str(basis or "")
        low = basis_s.lower()
        if low.startswith("per month"):
            billing, unit = "MONTHLY", None
        elif low.startswith("one-time"):
            billing, unit = "ONE_TIME", None
        elif low.startswith("each"):
            billing, unit = "PER_UNIT", "each"
        else:
            m = re.match(r"^(?:from\.?\s*)?per ([a-z]+)", low)
            billing, unit = "PER_UNIT", (m.group(1) if m else None)
            if low.startswith("from"):
                billing, unit = "PER_UNIT", "project"
        pct = re.search(r"(\d+)% of spend", basis_s)
        third_party = None
        if re.search(r"plus|funded by the NGO|obtained by the NGO", basis_s, re.I):
            third_party = basis_s
        add_ons.append({
            "kind": kinds[str(cat)],
            "name": str(name),
            "serviceCodes": codes_in(code_text),
            "unitPriceInr": int(price),
            "priceIsFrom": low.startswith("from"),
            "billingBasis": billing,
            "unitLabel": unit,
            "basisNotes": basis_s,
            "percentOfSpendAlt": int(pct.group(1)) if pct else None,
            "thirdPartyCostNote": third_party,
            "requiresEligibilityCheck": "verify grant eligibility" in low,
            "sortOrder": len(add_ons) + 1,
        })
    if not add_ons:
        fail("No add-ons parsed")

    # ---- referential integrity against the catalogue
    for tier in TIERS:
        for inc in tiers[tier]["includedServices"]:
            if inc["code"] not in catalogue_codes:
                fail(f"{tier} includes {inc['code']} which is not in the catalogue")
        for d in tiers[tier]["deliverables"]:
            for c in d["serviceCodes"]:
                if c not in catalogue_codes:
                    fail(f"{tier} deliverable '{d['name']}' references unknown code {c}")
    for a in add_ons:
        for c in a["serviceCodes"]:
            if c not in catalogue_codes:
                fail(f"Add-on '{a['name']}' references unknown code {c}")

    # ---- quote builder (formulas are recorded as policy, not executed here)
    ws = wb["Quote builder"]
    quote_builder = {
        "defaultTier": ws["B4"].value,
        "defaultMonths": ws["B6"].value,
        "instruction": ws["A2"].value,
        "footnote": ws["A57"].value,
        "formulas": {
            "monthlyRetainer": "price of selected tier",
            "recurringAddOnsPerMonth": "sum(unit price x qty) for category Recurring",
            "oneTimeSetup": "sum(unit price x qty) for category Setup",
            "projects": "sum(unit price x qty) for category Project",
            "month1Invoice": "retainer + recurring + setup + projects",
            "ongoingMonthlyInvoice": "retainer + recurring",
            "totalContractValue": "(retainer + recurring) x months + setup + projects",
        },
    }
    # confirm the recorded formulas still match the workbook
    expected_formula_cells = {"F53": "=$B$5+F50+F51+F52", "F54": "=$B$5+F50", "F55": "=($B$5+F50)*$B$6+F51+F52"}
    for cell, f in expected_formula_cells.items():
        if ws[cell].value != f:
            fail(f"Quote builder {cell} is '{ws[cell].value}', expected '{f}' - update the recorded formulas")

    # ---- Economics (INTERNAL ONLY)
    ws = wb["Economics"]
    assumptions = {
        "blendedCostPerProductiveHourInr": ws["B5"].value,
        "productiveHoursPerPersonPerMonth": ws["B6"].value,
        "hoursBufferFraction": ws["B7"].value,
        "fixedMonthlyOverheadInr": ws["B8"].value,
    }
    if not all(isinstance(v, (int, float)) for v in assumptions.values()):
        fail(f"Economics assumptions are not all numeric: {assumptions}")
    col = {"PLATINUM": 2, "GOLD": 3, "SILVER": 4}
    hour_rows = {
        "strategyAccountMgmt": 13, "designContentProduction": 14, "publishingSeoOptimisation": 15,
        "reportingMeetings": 16, "qcAdminComms": 17,
    }
    internal_by_tier = {}
    for tier, c in col.items():
        hours = {k: float(ws.cell(r, c).value) for k, r in hour_rows.items()}
        total = round(sum(hours.values()), 2)
        if total != round(float(tiers[tier]["_estimatedHours"]), 2):
            fail(f"{tier}: Economics hours add to {total}, Packages sheet says {tiers[tier]['_estimatedHours']}")
        if ws.cell(12, c).value != tiers[tier]["monthlyPriceInr"]:
            fail(f"{tier}: Economics fee {ws.cell(12, c).value} != package price")
        internal_by_tier[tier] = {
            "tier": tier,
            "estimatedHoursTotal": total,
            "hoursBreakdown": hours,
            "softwareAndAssetsInr": int(ws.cell(18, c).value),
        }
    for t in tiers.values():
        t.pop("_estimatedHours")

    return {
        "source": XLSX_PATH.name,
        "currency": "INR",
        "policyNotes": {
            "packagesSheet": packages_note,
            "addOnsSheet": wb["Add-ons"]["A2"].value,
            "quoteBuilder": quote_builder["footnote"],
            "tierScopeRule": "Anything beyond the tier quantities is quoted from the Add-ons sheet.",
        },
        "tiers": [tiers[t] for t in TIERS],
        "addOns": add_ons,
        "quoteBuilder": quote_builder,
        "internalEconomics": {
            "visibility": "INTERNAL_ONLY",
            "warning": str(ws["A2"].value),
            "assumptions": assumptions,
            "byTier": [internal_by_tier[t] for t in TIERS],
        },
    }


def main() -> int:
    for p in (PDF_PATH, XLSX_PATH):
        if not p.exists():
            print(f"ERROR: missing reference file {p}", file=sys.stderr)
            return 2
    try:
        catalogue = parse_catalogue()
        codes = {s["code"] for a in catalogue["practiceAreas"] for s in a["services"]}
        packages = parse_packages(codes)
    except IngestError as e:
        print(f"INGEST FAILED: {e}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalogue.json").write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT / "packages.json").write_text(json.dumps(packages, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"catalogue.json: {catalogue['totalServices']} services across {len(catalogue['practiceAreas'])} practice areas")
    for a in catalogue["practiceAreas"]:
        print(f"  {a['code']:<4} {a['name']:<30} {len(a['services']):>3}"
              f"{'  (expansion practice)' if a['isExpansionPractice'] else ''}")
    print(f"packages.json: {len(packages['tiers'])} tiers, {len(packages['addOns'])} add-ons")
    for t in packages["tiers"]:
        print(f"  {t['name']:<9} Rs {t['monthlyPriceInr']:>6,}/mo  codes={[i['code'] for i in t['includedServices']]}  deliverables={len(t['deliverables'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
