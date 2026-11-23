// =====================================================================
// playlist.ts — Custom Playlist Data Model, Validation & Durations
// =====================================================================

import type { Playlist, PlaylistEntry, PlaylistValidationResult, TrainingRoutine } from './types';
import { getScenarioById, ROUTINE_TRANSITION_SEC } from './scenarios';
import { DEFAULT_REST_INTERVAL_SEC } from './constants';

export function validatePlaylist(input: unknown): PlaylistValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Playlist must be a non-null object.'] };
  }

  const p = input as Partial<Playlist>;

  if (typeof p.id !== 'string' || !p.id.trim()) {
    errors.push('Playlist must have a valid non-empty string ID.');
  }

  if (typeof p.name !== 'string' || !p.name.trim()) {
    errors.push('Playlist name is required and cannot be empty.');
  } else if (p.name.trim().length > 80) {
    errors.push('Playlist name cannot exceed 80 characters.');
  }

  if (p.defaultRestIntervalSec !== undefined) {
    if (
      typeof p.defaultRestIntervalSec !== 'number' ||
      !Number.isFinite(p.defaultRestIntervalSec) ||
      p.defaultRestIntervalSec < 0 ||
      p.defaultRestIntervalSec > 120
    ) {
      errors.push('Default rest interval must be a number between 0 and 120 seconds.');
    }
  }

  if (!Array.isArray(p.entries) || p.entries.length === 0) {
    errors.push('Playlist must contain at least one drill scenario.');
  } else {
    p.entries.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object') {
        errors.push(`Entry #${idx + 1} is invalid.`);
        return;
      }
      if (typeof entry.scenarioId !== 'string' || !entry.scenarioId.trim()) {
        errors.push(`Entry #${idx + 1} must specify a valid scenario ID.`);
      }
      if (
        typeof entry.durationSec !== 'number' ||
        !Number.isFinite(entry.durationSec) ||
        entry.durationSec < 5 ||
        entry.durationSec > 600
      ) {
        errors.push(`Entry #${idx + 1} duration must be between 5 and 600 seconds.`);
      }
      if (entry.restIntervalSec !== undefined) {
        if (
          typeof entry.restIntervalSec !== 'number' ||
          !Number.isFinite(entry.restIntervalSec) ||
          entry.restIntervalSec < 0 ||
          entry.restIntervalSec > 120
        ) {
          errors.push(`Entry #${idx + 1} rest interval must be between 0 and 120 seconds.`);
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function calculatePlaylistDurations(playlist: Playlist): {
  activeSec: number;
  restSec: number;
  totalElapsedSec: number;
} {
  if (!playlist || !Array.isArray(playlist.entries) || playlist.entries.length === 0) {
    return { activeSec: 0, restSec: 0, totalElapsedSec: 0 };
  }

  const defaultRest = typeof playlist.defaultRestIntervalSec === 'number' && Number.isFinite(playlist.defaultRestIntervalSec)
    ? Math.max(0, playlist.defaultRestIntervalSec)
    : DEFAULT_REST_INTERVAL_SEC;

  let activeSec = 0;
  for (const entry of playlist.entries) {
    const dur = typeof entry.durationSec === 'number' && Number.isFinite(entry.durationSec)
      ? Math.max(0, entry.durationSec)
      : 60;
    activeSec += dur;
  }

  let restSec = 0;
  // Transitions occur only between drills (total drills - 1)
  const transitionsCount = Math.max(0, playlist.entries.length - 1);
  for (let i = 0; i < transitionsCount; i++) {
    const entry = playlist.entries[i];
    const itemRest = typeof entry?.restIntervalSec === 'number' && Number.isFinite(entry.restIntervalSec)
      ? Math.max(0, entry.restIntervalSec)
      : defaultRest;
    restSec += itemRest;
  }

  return {
    activeSec,
    restSec,
    totalElapsedSec: activeSec + restSec,
  };
}

export function convertRoutineToPlaylist(routine: TrainingRoutine): Playlist {
  const entries: PlaylistEntry[] = (routine.scenarioIds || []).map((sid, idx) => {
    const sc = getScenarioById(sid);
    return {
      id: `${sid}_${idx}_${Date.now()}`,
      scenarioId: sid,
      durationSec: sc?.durationSec ?? 60,
      restIntervalSec: ROUTINE_TRANSITION_SEC,
    };
  });

  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    defaultRestIntervalSec: ROUTINE_TRANSITION_SEC,
    entries,
    isBuiltin: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createDefaultPlaylist(name = 'My Warm-Up Playlist'): Playlist {
  const id = `playlist_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const defaultDrillIds = ['flick-static', 'track-smooth', 'tactical-wideswing'];
  const entries: PlaylistEntry[] = defaultDrillIds.map((sid, idx) => ({
    id: `entry_${Date.now()}_${idx}`,
    scenarioId: sid,
    durationSec: 60,
    restIntervalSec: DEFAULT_REST_INTERVAL_SEC,
  }));

  return {
    id,
    name,
    description: 'Custom multi-drill warmup sequence',
    defaultRestIntervalSec: DEFAULT_REST_INTERVAL_SEC,
    entries,
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function duplicatePlaylist(playlist: Playlist): Playlist {
  const newId = `playlist_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const clonedEntries: PlaylistEntry[] = (playlist.entries || []).map((e, idx) => ({
    id: `entry_${Date.now()}_${idx}`,
    scenarioId: e.scenarioId,
    durationSec: e.durationSec,
    restIntervalSec: e.restIntervalSec,
    configOverrides: e.configOverrides ? JSON.parse(JSON.stringify(e.configOverrides)) : undefined,
  }));

  const nameMatch = playlist.name.match(/^(.*?)(?:\s+\(Copy(?:\s+(\d+))?\))?$/);
  let newName = `${playlist.name} (Copy)`;
  if (nameMatch && playlist.name.includes('(Copy')) {
    newName = `${nameMatch[1]} (Copy ${Date.now().toString().slice(-4)})`;
  }

  return {
    id: newId,
    name: newName,
    description: playlist.description ?? '',
    defaultRestIntervalSec: playlist.defaultRestIntervalSec ?? DEFAULT_REST_INTERVAL_SEC,
    entries: clonedEntries,
    isBuiltin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
