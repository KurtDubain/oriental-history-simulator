import { listMapProfiles, validateMapProfile } from '../src/maps';

const results = listMapProfiles().map((profile) => ({
  id: profile.id,
  revision: profile.revision,
  contentVersion: profile.contentVersion,
  regions: profile.simulation.regions.length,
  seaZones: profile.simulation.seaZones.length,
  polities: profile.simulation.polities.length,
  issues: validateMapProfile(profile),
}));

const issueCount = results.reduce((sum, result) => sum + result.issues.length, 0);
process.stdout.write(`${JSON.stringify({ profiles: results, issueCount }, null, 2)}\n`);
if (issueCount > 0) process.exitCode = 1;

