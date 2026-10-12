import { describe, expect, it } from 'vitest'
import type { CatalogSkill } from '../wire.ts'
import { formatRelativeTime, sortSkills } from './grouping.ts'

function skill(name: string, writable = true, source = 'user-dsh'): CatalogSkill {
  return {
    name,
    description: '',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'skill-mgr',
    source,
    writable,
  }
}

describe('sortSkills', () => {
  it('sorts by name ascending', () => {
    const skills = [skill('zeta'), skill('alpha'), skill('beta')]
    expect(sortSkills(skills, 'name').map((s) => s.name)).toEqual(['alpha', 'beta', 'zeta'])
  })

  it('sorts by added time descending, unknown times last', () => {
    const skills = [
      { ...skill('old'), addedAt: 100 },
      { ...skill('new'), addedAt: 300 },
      { ...skill('unknown') },
    ]
    expect(sortSkills(skills, 'added').map((s) => s.name)).toEqual(['new', 'old', 'unknown'])
  })

  it('sorts by invocation count descending, unknown counts as zero', () => {
    const skills = [skill('few'), skill('many'), skill('none')]
    const uses: Record<string, number | undefined> = { few: 2, many: 9 }
    expect(sortSkills(skills, 'uses', (name) => uses[name]).map((s) => s.name)).toEqual(['many', 'few', 'none'])
  })

  it('does not mutate the input list', () => {
    const skills = [skill('b'), skill('a')]
    const sorted = sortSkills(skills, 'name')
    expect(sorted.map((s) => s.name)).toEqual(['a', 'b'])
    expect(skills.map((s) => s.name)).toEqual(['b', 'a'])
  })
})

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000
  it('buckets relative times correctly', () => {
    expect(formatRelativeTime(now, now)).toEqual({ key: 'time.justNow' })
    expect(formatRelativeTime(now - 30_000, now)).toEqual({ key: 'time.justNow' })
    expect(formatRelativeTime(now - 5 * 60_000, now)).toEqual({ key: 'time.minutesAgo', value: 5 })
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toEqual({ key: 'time.hoursAgo', value: 3 })
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toEqual({ key: 'time.daysAgo', value: 2 })
    expect(formatRelativeTime(now - 14 * 86_400_000, now)).toEqual({ key: 'time.weeksAgo', value: 2 })
  })

  it('clamps future timestamps to just now', () => {
    expect(formatRelativeTime(now + 5_000, now)).toEqual({ key: 'time.justNow' })
  })
})