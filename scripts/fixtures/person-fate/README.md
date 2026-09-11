# Frozen natural-history UI fixtures

Captured from v1.29.15, HEAD f7875f3, without interventions or edited facts.
Files are complete portable saves, gzip+base64 for a text-reviewable test-only asset;
they are not shipped in production. The manifest verifies the decompressed file's SHA-256
and the loader verifies the original world hash, schema and references.

- wounded: 乱世一将 T33, 宇文维珩, battle wound fact_0000674 (T32).
- returned: the same unmodified run T64, the same person returned to command after recovery.
- deceased: 霜河归雁-留验寅 T52, produced by advancing the independently audited T51 save
  (`output/deep-play-v1.29.15/new-world/t51.portable.json`) once. 高德和's death is
  fact_0001036 / event_001074; the complete battle and succession history is retained.

These snapshots fix UI coverage, not future random outcomes. The separate natural
乱世一将 T0–64 run checks source/browser equality and actual casualties' discoverability,
without requiring any death/wound/comeback count. Do not tune simulation to these fixtures.
