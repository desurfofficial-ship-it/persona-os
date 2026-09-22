// Persona OS Red-Team Report (Rounds 4-5) — docx generator
// Architecture: Section 1 cover (R1, DM-1, margin 0) / Section 2 front matter (TOC, Roman) / Section 3 body (Arabic from 1)
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, SectionType, TableOfContents,
  TableLayoutType, VerticalAlign, LevelFormat,
} = require("docx");
const fs = require("fs");
const C = require("./round45_content.js");

// ── Palette DM-1 (Deep Cyan — AI / tech) ──────────────────────────────────────
const PAL = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
};
const HEADING_COLOR = "162235";
const FONT = { ascii: "Times New Roman", eastAsia: "Times New Roman" };

// ── Cover helpers (from design-system.md) ────────────────────────────────────
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

function estimateTextWidth(text, pt) {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const isCJK = (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef);
    width += isCJK ? pt * 20 : pt * 11;
  }
  return width;
}

// Width-aware title layout for Latin text: greedy word wrap, <= 3 lines
function calcTitleLayoutMixed(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const wrap = (pt) => {
    const words = title.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? cur + " " + w : w;
      if (estimateTextWidth(cand, pt) <= maxWidthTwips || !cur) cur = cand;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let titlePt = preferredPt, lines = wrap(titlePt);
  while (lines.length > 3 && titlePt > minPt) { titlePt -= 2; lines = wrap(titlePt); }
  // orphan prevention: merge a very short last line into the previous one if it fits at a smaller size
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop(); lines[lines.length - 1] += " " + last;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── Recipe R1: Pure Paragraph Cover (Left-Aligned) ───────────────────────────
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayoutMixed(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Arial", eastAsia: "SimHei" }, characterSpacing: 40,
      })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, bold: true,
        color: P.cover.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" },
      })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({
        text: config.subtitle, size: 24, color: P.cover.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" },
      })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: line, size: 24, color: P.cover.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" },
      })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial" } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        verticalAlign: VerticalAlign.TOP,
        children,
      })],
    })],
  })];
}

// ── Body builders ─────────────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180, line: 380, lineRule: "atLeast" },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PAL.table.accentLine, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 32, color: HEADING_COLOR, font: FONT })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120, line: 360, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 30, color: HEADING_COLOR, font: FONT })],
  });
}
function para(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 140, line: 312 },
    children: [new TextRun({ text, size: 24, color: "000000", font: FONT })],
  });
}
// Narrative paragraph with a bold lead-in label (Break / Fix / Harden)
function labeled(label, text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 312 },
    children: [
      new TextRun({ text: label + " - ", bold: true, size: 24, color: HEADING_COLOR, font: FONT }),
      new TextRun({ text, size: 24, color: "000000", font: FONT }),
    ],
  });
}
// Short list-like line (ICP verdict, deferrals) — left aligned per list rules
function icpLine(label, text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 80, line: 312 },
    children: [
      new TextRun({ text: label + " ", bold: true, size: 24, color: "000000", font: FONT }),
      new TextRun({ text, size: 24, color: "000000", font: FONT }),
    ],
  });
}
function verdictCaption() {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 60, after: 60, line: 312 },
    children: [new TextRun({ text: "Rewritten ICP verdict:", italics: true, size: 21, color: "5B6B7D", font: FONT })],
  });
}
function cycleBlock(cyc) {
  return [
    h2("Cycle " + cyc.n + " - " + cyc.title),
    labeled("Break", cyc.brk),
    labeled("Fix", cyc.fix),
    labeled("Harden", cyc.harden),
    verdictCaption(),
    icpLine("Loves:", cyc.love),
    icpLine("Hates:", cyc.hate),
    icpLine("Wants improved:", cyc.want),
  ];
}

function buildFixSprintTable(t) {
  const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: t.headers.map((h, i) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: PAL.table.headerBg },
      margins: cellMargins,
      width: { size: t.widths[i], type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { line: 312 },
        children: [new TextRun({ text: h, bold: true, size: 21, color: PAL.table.headerText, font: FONT })],
      })],
    })),
  });
  const dataRows = t.rows.map((row, ri) => new TableRow({
    cantSplit: true,
    children: row.map((cell, i) => new TableCell({
      shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: PAL.table.surface } : undefined,
      margins: cellMargins,
      width: { size: t.widths[i], type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        alignment: AlignmentType.LEFT, spacing: { line: 312 },
        children: [new TextRun({ text: cell, size: 21, color: "000000", font: FONT })],
      })],
    })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...dataRows],
  });
}

// ── Assemble body children ───────────────────────────────────────────────────
const body = [];
body.push(h1("1. Executive Summary"));
C.execSummary.forEach(p => body.push(para(p)));

body.push(h1("2. Starting State: What Shipped in Round 3 (v0.4)"));
C.startingState.forEach(p => body.push(para(p)));

body.push(h1("3. Round 4 - Red-Team Cycles 1-10"));
body.push(para("Each cycle below follows the fixed loop. Break states the sharpest available attack on one assumption. Fix describes the smallest product change that survives the attack. Harden closes the regressions and edge cases the fix would open. The rewritten ICP verdict then records what the ideal customer loves, hates, and wants improved next, synthesized from the Round 2 panel voice. The ten cycles attack voice quality, the posting last mile, winner suppression, field drift, series pressure, the vault, multi-voice reality, unit economics, trust, and week-three retention."));
C.cycles.forEach(cyc => body.push(...cycleBlock(cyc)));

body.push(h1("4. Consolidated Fix Sprint"));
C.fixSprintIntro.forEach(p => body.push(para(p)));
body.push(new Paragraph({
  keepNext: true, alignment: AlignmentType.LEFT, spacing: { before: 200, after: 80 },
  children: [new TextRun({ text: C.fixSprintTable.intro, bold: true, size: 21, color: "000000", font: FONT })],
}));
body.push(buildFixSprintTable(C.fixSprintTable));
body.push(new Paragraph({
  alignment: AlignmentType.JUSTIFIED, spacing: { before: 160, after: 140, line: 312 },
  children: [new TextRun({
    text: "Sprint capacity assumes the two-person team at current velocity. If a sprint slips, the lowest-priority item in that sprint is dropped rather than compressing verification, because each shipped fix must survive its own hardening bar.",
    size: 24, color: "000000", font: FONT,
  })],
}));
body.push(para("Five requests earned attention but not a sprint slot. Each is parked with a reason and a revisit date, so deferral remains a decision rather than an omission."));
C.fixSprintDecisions.forEach(d => body.push(icpLine(d.label + ":", d.text)));

body.push(h1("5. Round 5 - Fresh-Start Cycles 11-15"));
body.push(para("Round 5 starts over from attack classes the earlier rounds never touched: market positioning, authenticity and legal exposure, analytics integrity, platform risk, and the team's own execution capacity. The loop is unchanged - break, fix, harden, rewritten ICP verdict - but the target is the business surface of the product rather than its screens. These five cycles are the ones that decide whether a good product becomes a defensible company."));
C.cycles5.forEach(cyc => body.push(...cycleBlock(cyc)));

body.push(h1("6. Conclusions, 30-Day Plan and Kill Criteria"));
C.conclusions.forEach(p => body.push(para(p)));
body.push(para("Kill criteria are agreed before building begins, so the failure of a feature is a cheap and fast decision instead of a debate. Four criteria govern the plan:"));
C.killCriteria.forEach(k => body.push(new Paragraph({
  numbering: { reference: "kill-criteria", level: 0 },
  alignment: AlignmentType.LEFT,
  spacing: { after: 100, line: 312 },
  children: [new TextRun({ text: k, size: 24, color: "000000", font: FONT })],
})));
C.nextRound.forEach(p => body.push(para(p)));

// ── Headers / footers ─────────────────────────────────────────────────────────
function makeHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 120 },
      children: [new TextRun({ text: C.meta.headerText, size: 18, color: "808080", font: FONT })],
    })],
  });
}
function makeFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT })],
    })],
  });
}

// ── Document ──────────────────────────────────────────────────────────────────
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  creator: "Technical Co-founder",
  title: C.meta.title,
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 24, color: "000000" },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT, size: 32, bold: true, color: HEADING_COLOR },
        paragraph: { spacing: { before: 360, after: 180, line: 380 } },
      },
      heading2: {
        run: { font: FONT, size: 30, bold: true, color: HEADING_COLOR },
        paragraph: { spacing: { before: 300, after: 120, line: 360 } },
      },
      heading3: {
        run: { font: FONT, size: 28, bold: true, color: HEADING_COLOR },
        paragraph: { spacing: { before: 200, after: 100, line: 340 } },
      },
    },
  },
  numbering: {
    config: [{
      reference: "kill-criteria",
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  sections: [
    { // Section 1: Cover — margin 0, no header/footer, no page numbers
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: C.meta.title, subtitle: C.meta.subtitle, englishLabel: C.meta.englishLabel,
        metaLines: C.meta.metaLines, footerLeft: C.meta.footerLeft, footerRight: C.meta.footerRight,
        palette: PAL,
      }),
    },
    { // Section 2: Front matter — TOC, Roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: makeHeader() },
      footers: { default: makeFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, font: FONT, color: HEADING_COLOR })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
            italics: true, size: 18, color: "888888", font: FONT,
          })],
        }),
      ],
    },
    { // Section 3: Body — Arabic numerals restarting at 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: makeHeader() },
      footers: { default: makeFooter() },
      children: body,
    },
  ],
});

const OUT = "/home/z/my-project/download/Persona-OS-Red-Team-Report-Rounds-4-5.docx";
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("WROTE", OUT, buf.length, "bytes");
});
