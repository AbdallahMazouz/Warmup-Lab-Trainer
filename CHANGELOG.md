# Changelog

All notable changes to **WarmupLab** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-10-23

### Added
- **Browser-Based 3D First-Person Aim Trainer**:
  - WebGL hardware-accelerated 3D rendering powered by Three.js.
  - Browser Pointer Lock API integration with raw mouse input (no smoothing).
  - Tactical 3D arena with floor grids, walls, ambient & directional lighting, and cover geometry.
- **Valorant Movement Accuracy (Counter-Strafing)**:
  - First-person movement physics with WASD keys and jump mechanics.
  - Dead-zone velocity checks: moving while shooting triggers inaccuracy penalties and HUD alerts.
- **Extensive Scenario Catalog**:
  - **Flicks**: Static, Micro, Wide, Multi-Target, Precision, Reactive.
  - **Tracking**: Smooth, Reactive, Strafing, Vertical.
  - **Tactical**: Wide Swing Duel, Jiggle Peek Punishment, Angle Clearing, Head-Level Discipline, First-Shot Discipline, Counter-Strafe Practice.
  - **Flash Avoidance & Recovery**: Pop Flash Reaction, Delayed Flash & Switch with camera turn-away detection (>75° dodges flash).
  - **Reaction Time**: Stimulus-to-input latency test, peripheral target detection.
  - **Hybrid**: Tactical Combo Warmup, Clutch Elimination 1v3.
- **Curated Warm-Up Routines**:
  - 5-Minute Quick Warm-Up.
  - 10-Minute Standard Valorant Routine.
  - 20-Minute Pro Conditioning Routine.
  - Sequential playlist runner with automatic scenario advancement.
- **Esports User Interface**:
  - Modern dark gaming palette with Valorant accents.
  - Full client-side routing: Home, Scenarios, Warm-Up Plans, Statistics, Settings.
  - In-game HUD: Real-time countdown timer, score, accuracy %, headshot counters, real-time FPS.
  - Results modal displaying final score, personal best celebrations, hits/misses, accuracy, and reaction metrics.
- **Settings & Calibration**:
  - Valorant-calibrated mouse sensitivity slider.
  - Horizontal Field of View (FOV) slider (70°–120°).
  - Interactive crosshair builder (color presets, size, gap, thickness, center dot) with live preview box.
  - Master volume slider.
  - Invert Y toggle and flash intensity controls.
- **Web Audio API Sound Engine**:
  - Synthesized hit pings, crisp headshot chimes, miss thuds, flash detonation noise, and PB fanfare.
- **Persistent Local Storage**:
  - Settings, personal bests, and session history stored in browser `localStorage`.
- **Automated Testing & CI/CD**:
  - Vitest test suite covering scenarios, settings, and session metrics calculation.
  - GitHub Actions automated deployment workflow to GitHub Pages.
