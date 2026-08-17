import { describe, expect, it } from 'vitest';
import { detectEmergency } from '../src/index.js';

describe('emergency rule engine', () => {
  it('flags gas leak as an emergency', () => {
    const r = detectEmergency('There is a gas leak in the kitchen');
    expect(r.isEmergency).toBe(true);
    expect(r.matches[0]?.category).toBe('plumbing');
  });

  it('flags no heat as an emergency', () => {
    expect(detectEmergency('the heat is out').isEmergency).toBe(true);
    expect(detectEmergency('we have no heat').isEmergency).toBe(true);
  });

  it('flags flood/burst pipe as emergency', () => {
    expect(detectEmergency('pipe burst under the sink').isEmergency).toBe(true);
    expect(detectEmergency('the bathroom is flooding').isEmergency).toBe(true);
  });

  it('flags fire/smoke/sparks as emergency', () => {
    expect(detectEmergency('smoke coming from the outlet').isEmergency).toBe(true);
    expect(detectEmergency('there are sparks in the wall').isEmergency).toBe(true);
  });

  it('flags lockout as emergency', () => {
    expect(detectEmergency("I'm locked out and my baby is inside").isEmergency).toBe(true);
  });

  it('does not flag a routine leak as emergency', () => {
    const r = detectEmergency('the sink is dripping slowly, can you take a look');
    expect(r.isEmergency).toBe(false);
  });

  it('appends tenant-configured keywords', () => {
    const r = detectEmergency('the carbon monoxide alarm is beeping', ['carbon monoxide']);
    expect(r.isEmergency).toBe(true);
    expect(r.matches.some((m) => m.category === 'other')).toBe(true);
  });

  it('returns multiple matches when several rules hit', () => {
    const r = detectEmergency('gas leak and the place is flooding');
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
  });
});
