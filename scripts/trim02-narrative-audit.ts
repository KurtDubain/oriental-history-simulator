import { advanceWorld, createWorld, serializeWorld } from '../src/sim';
import { deriveObserverLeadProjection, type ObserverLeadContinuityState } from '../src/view/observer-leads';
import { projectQuarterPulse } from '../src/view/quarter-pulse-stories';
import { projectSituationWorkbench } from '../src/view/situation-detail';

const DEFAULT_SEEDS = ['沧衡-甲子', '潮生商路', '孤城疫年', '春战副将'] as const;
const quarters = Number(process.env.TRIM02_AUDIT_TURNS ?? 16);
const configuredSeeds = process.env.TRIM02_AUDIT_SEEDS
  ?.split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
const seeds = configuredSeeds?.length ? configuredSeeds : [...DEFAULT_SEEDS];

if (!Number.isSafeInteger(quarters) || quarters <= 0) {
  throw new Error(`TRIM02_AUDIT_TURNS must be a positive integer, received ${quarters}`);
}

const META_COPY = /张力|势头|升温|降温|萌芽|临界|阶段变化|阶段转折|结构信号|推动因素|约束因素|置信度|概率/u;
const UNSOURCED_FUTURE = /会不会|能否|还是|将会|即将|可能发生|走向自立/u;

interface AuditRow {
  seed: string;
  quarters: number;
  visibleStories: number;
  quietQuarters: number;
  duplicatedStories: number;
  metaCopyHits: number;
  futureCopyHits: number;
  situationDossiers: number;
}

const failures: string[] = [];
const rows: AuditRow[] = [];

function fail(scope: string, message: string): void {
  if (failures.length < 100) failures.push(`${scope}: ${message}`);
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const ids = new Set(left);
  return right.some((id) => ids.has(id));
}

for (const seed of seeds) {
  let world = createWorld(seed);
  let continuity: ObserverLeadContinuityState | null = null;
  let visibleStories = 0;
  let quietQuarters = 0;
  let duplicatedStories = 0;
  let metaCopyHits = 0;
  let futureCopyHits = 0;
  let situationDossiers = 0;

  for (let quarter = 0; quarter < quarters; quarter += 1) {
    const previousHash = world.hash;
    world = advanceWorld(world);
    const authority = {
      hash: world.hash,
      factDigest: world.factDigest,
      historyDigest: world.historyDigest,
      save: serializeWorld(world),
    };
    const pulse = projectQuarterPulse(world);
    const leads = deriveObserverLeadProjection(world, continuity, previousHash);
    continuity = leads.continuity;
    const dossier = projectSituationWorkbench(world);
    if (dossier.selected) situationDossiers += 1;

    visibleStories += pulse.stories.length;
    if (pulse.stories.length === 0) quietQuarters += 1;
    if (pulse.stories.length > 3) fail(`${seed}/T${world.turn}`, '季报超过三件默认史事');
    if (pulse.stories.some((story) => story.kind !== 'event')) {
      fail(`${seed}/T${world.turn}`, '后台局势走势进入默认季报');
    }
    for (let left = 0; left < pulse.stories.length; left += 1) {
      for (let right = left + 1; right < pulse.stories.length; right += 1) {
        if (
          overlaps(pulse.stories[left].sourceFactIds, pulse.stories[right].sourceFactIds)
          || overlaps(pulse.stories[left].historyEventIds, pulse.stories[right].historyEventIds)
        ) duplicatedStories += 1;
      }
    }

    const visibleCopy = [
      ...pulse.stories.flatMap((story) => [story.title, story.summary]),
      ...leads.leads.flatMap((lead) => [lead.question, ...lead.evidence, lead.recentChange ?? '']),
      ...(dossier.selected
        ? [dossier.selected.currentChange, ...dossier.selected.playerSummary]
        : []),
    ].join('\n');
    if (META_COPY.test(visibleCopy)) metaCopyHits += 1;
    if (UNSOURCED_FUTURE.test(visibleCopy)) futureCopyHits += 1;

    if (
      world.hash !== authority.hash
      || world.factDigest !== authority.factDigest
      || world.historyDigest !== authority.historyDigest
      || serializeWorld(world) !== authority.save
    ) fail(`${seed}/T${world.turn}`, '只读叙事投影改变了权威世界');
  }

  if (duplicatedStories > 0) fail(seed, `季报出现 ${duplicatedStories} 组重复证据`);
  if (metaCopyHits > 0) fail(seed, `${metaCopyHits} 季默认文本泄漏后台阶段或检测量`);
  if (futureCopyHits > 0) fail(seed, `${futureCopyHits} 季默认文本出现无来源未来式`);
  rows.push({
    seed,
    quarters,
    visibleStories,
    quietQuarters,
    duplicatedStories,
    metaCopyHits,
    futureCopyHits,
    situationDossiers,
  });
}

const totals = rows.reduce((sum, row) => ({
  quarters: sum.quarters + row.quarters,
  visibleStories: sum.visibleStories + row.visibleStories,
  quietQuarters: sum.quietQuarters + row.quietQuarters,
  duplicatedStories: sum.duplicatedStories + row.duplicatedStories,
  metaCopyHits: sum.metaCopyHits + row.metaCopyHits,
  futureCopyHits: sum.futureCopyHits + row.futureCopyHits,
  situationDossiers: sum.situationDossiers + row.situationDossiers,
}), {
  quarters: 0,
  visibleStories: 0,
  quietQuarters: 0,
  duplicatedStories: 0,
  metaCopyHits: 0,
  futureCopyHits: 0,
  situationDossiers: 0,
});

if (totals.visibleStories === 0) fail('aggregate', '固定种子没有产生任何默认史事');
if (totals.situationDossiers === 0) fail('aggregate', '固定种子没有产生可审计的持续局势');

console.log(JSON.stringify({
  phase: 'TRIM02',
  scope: { seeds: seeds.length, quartersPerSeed: quarters },
  totals,
  rows,
  failures,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
