# Current-rule natural UI fixtures (v1.29.38)

Complete portable worlds captured without interventions or edited facts. Inputs are
checked in as gzip+base64; `manifest.json` authenticates each uncompressed envelope
with SHA-256. World hash, full validation and source references remain mandatory.
These test-only assets are not included in production builds.

The older parent directory contains untouched v1.29.15 snapshots. They now fail
the biological-parent eligibility validation. This is not a migration of those
worlds and does not relax the validator or alter historical parents.

The captures use two already-audited talent-study runs, not a search for a seed
that makes a future stochastic test pass:

- `秋灯照海-收卷乙酉`, contest-v01: T7 actual wound and T14 actual return to service,
  same person and wound Fact. A different wounded commander in the same battle
  did not resume service in the observed window and was not used as comeback evidence.
- `枫渡余灯-丙申`, contest-v01: T210 actual commander's battle death, with a real
  quarter card, battle Fact, death Fact and event. The capture asserts the card
  exists; it does not merely replace a dead person's name in another world.

Run `npm exec vite-node scripts/fixtures/person-fate/capture-current.ts` manually
to reproduce with the corresponding rules. The script validates/roundtrips every
world and retains the complete history. It fails if those rules no longer produce
the captured facts; do not tune simulation to preserve this capture. Ordinary E2E
runs read the frozen files only. Their separate natural replay still has no death,
wound or return-to-command quota, and the substantive UI assertions are unchanged.

For media evidence navigation the manifest also identifies an accessible war case
and its real history event. The browser selects that case through the existing
directory; it does not require the default recommendation (which may have Fact-only
evidence) to contain an Event button. The original audio, evidence return and hash
assertions remain in place.

The fixed savedAt timestamp is portable-envelope metadata only; world bodies,
Facts, event order and hashes are the simulator's unchanged output. Investigation
and failed capture attempts remain in `output/release-tail-20260916/` for provenance,
not as required test inputs.
