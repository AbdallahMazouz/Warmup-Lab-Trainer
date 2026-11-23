import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsManager } from '../src/settings';
import { LS_SETTINGS } from '../src/constants';

describe('Phase 8 — Settings Sanitization & Input Boundaries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clamps crosshair numeric properties within safe gameplay boundaries', () => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      crosshairSize: 999,
      crosshairGap: -50,
      crosshairThickness: 0,
    }));

    const sm = new SettingsManager();
    expect(sm.get('crosshairSize')).toBe(30);
    expect(sm.get('crosshairGap')).toBe(0);
    expect(sm.get('crosshairThickness')).toBe(1);
  });

  it('validates crosshairColor hex pattern and falls back to default on invalid input', () => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      crosshairColor: 'not-a-color',
    }));

    const sm = new SettingsManager();
    expect(sm.get('crosshairColor')).toBe('#00ff78');

    // Valid hex should be accepted
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      crosshairColor: '#00ffff',
    }));
    const smValid = new SettingsManager();
    expect(smValid.get('crosshairColor')).toBe('#00ffff');
  });

  it('sanitizes boolean settings against non-boolean injection', () => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      showHitNumbers: 'yes',
      reducedEffects: 1,
      highContrast: null,
    }));

    const sm = new SettingsManager();
    expect(typeof sm.get('showHitNumbers')).toBe('boolean');
    expect(typeof sm.get('reducedEffects')).toBe('boolean');
    expect(typeof sm.get('highContrast')).toBe('boolean');
  });
});
