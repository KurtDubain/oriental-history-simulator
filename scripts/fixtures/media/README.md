# Frozen media cue evidence

`settled-signals.json` contains unchanged full Fact/Event records extracted from
the validated v1.29.38 `contest-v01` world, seed `秋灯照海-收卷乙酉`, T400,
world hash `8307dda585b7befc`. The death, succession, territorial change and their
transitive Fact sources are retained. They were selected by existing kind and
importance, not by a requirement that a future seed produce a particular fate.

Reproduction and extraction evidence:
`output/talent-entry-20260916/after/0/` and
`output/talent-closeout-20260916/extract-media.ts`.
These paths document provenance only; running the unit test does not read output.

This is a record-level fixture for `settledCue`, not an importable world. The cue
unit test checks kind/turn/importance and source completeness. Current-world
validation, import and continuation are tested separately; this fixture must not
be used to claim old-world compatibility. The older person-fate snapshots remain
unchanged, including their known current-lineage validation failure in browser
E2E. No source history, parentage or validation rules were rewritten.
