# Archived reports

These files were written by earlier AI-assisted sessions and used to sit in the
repository root, where nothing distinguished them from living documentation. They are
kept for history. **None of them describes current behaviour** — read `README.md` and
`CLAUDE.md` for that.

Statuses below were re-verified against the code on 2026-09-08, not taken on trust.

## The statistics-overlay crash and the element-ID mismatch

A batch of investigations into `TypeError: Cannot read properties of null` raised by the
`Узел` helper, caused by `player.js` looking up element IDs that `player.html` did not
have — the fallout of translating some IDs to English and not others.

- `BUG_ANALYSIS_STATISTICS_OVERLAY.md`
- `BUG_DIAGNOSTIC_REPORT.md`
- `BUG_FORENSIC_REPORT.md`
- `BUG_DIAGNOSIS_SUMMARY.txt`
- `BUG_DIAGNOSIS_statistics_element_mismatch.txt`
- `CRITICAL_BUG_FIX_PLAN_1_ID_MISMATCH.md`
- `FIX_IMPLEMENTATION_GUIDE.md`
- `FORENSIC_REPORT_ebf05b5.md`
- `INITIALIZATION_SEQUENCE.txt`
- `i18n_diagnostic_report.md`
- `CROSS_VERIFICATION_REPORT.md`
- `VERIFICATION_PLAN_3_COMPLETE_AUDIT.md`
- `TESTING_PLAN_4_INTEGRATION_E2E.md`

**Status: closed, verified.** Every element ID that `player.js` looks up now resolves in
either `player.html` or `report.html` — 58 lookups, 0 missing, including all 17 IDs of
the statistics overlay. The plans and test procedures in these files describe work that
is done.

## The hardcoded Russian tooltips

- `CRITICAL_BUG_FIX_PLAN_2_HARDCODED_TOOLTIPS.md` — the plan
- `HANDOFF.md` — the session that reported it finished

**Status: closed on 2026-09-08** — but it was not when archived, despite `HANDOFF.md` marking it complete. That handoff claims
"0 active Russian tooltips remaining", verified by a script that stripped HTML comments
and checked `title=` attributes for Cyrillic. Re-checking the same way on 2026-09-08:
**11 of the 22 active `title=` attributes in `player.html` still contain Russian**, and
Russian remains in visible text nodes.

The reason the original check passed is that the tooltips are multi-line. The first line
of each was translated and the remaining lines were left in Russian inside the *same*
attribute, so an attribute-level "does this contain Cyrillic" test would have caught it,
but a test that stopped at the first translated line would not. Example, still present:

    title="Video duration at different processing stages:

    Ожидает загрузки из сети + Загружается из ..."

This is user-visible in the statistics overlay (the **S** key), and the current
maintainer does not read Russian. It is unfinished work, not history.

## The Russian → English translation phases

- `Phase_1_Report_root.md` … `Phase_4_Report_root.md`

Renamed with a `_root` suffix on archiving: `Documentation/Translation/` holds four
files with the same names but different content, and the pair would otherwise collide.

**Status: superseded.** These describe the "translate by adding an English comment under
each line" approach, which is why `player.js` carries a commented English echo of much of
its own source. No identifiers were actually renamed. See `CLAUDE.md` for the standing
rules on new code.
