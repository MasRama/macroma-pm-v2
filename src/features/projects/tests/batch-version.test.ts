import { describe, expect, it } from 'vitest';
import { latestBatchVersion, nextBatchVersion } from '../web/view';

describe('Bump versi numbering', () => {
  it("opens a project's first batch as v0.1, or v1.0 for a major", () => {
    expect(latestBatchVersion([])).toBeNull();
    expect(nextBatchVersion(null, 'minor')).toEqual({ major: 0, minor: 1 });
    expect(nextBatchVersion(null, 'major')).toEqual({ major: 1, minor: 0 });
  });

  it("follows the project's highest version, not the active one", () => {
    const latest = latestBatchVersion([
      { major: 0, minor: 4 },
      { major: 1, minor: 2 },
      { major: 1, minor: 0 },
    ]);
    expect(latest).toEqual({ major: 1, minor: 2 });
    expect(nextBatchVersion(latest, 'minor')).toEqual({ major: 1, minor: 3 });
    expect(nextBatchVersion(latest, 'major')).toEqual({ major: 2, minor: 0 });
  });
});
