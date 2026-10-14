// Server-wide configuration and environment settings
import { SCORING_CONFIG, MATCH_CONFIG, PLAYER_CONFIG, ARENA } from '../../shared/constants.js';

export const CONFIG = {
  PORT: process.env.PORT || 3001,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  SCORING: { ...SCORING_CONFIG },
  MATCH: { ...MATCH_CONFIG },
  PLAYER: { ...PLAYER_CONFIG },
  ARENA: { ...ARENA },
};

// Method to update scoring rules at runtime (e.g., custom room rules)
export function updateScoringConfig(newRules) {
  Object.assign(CONFIG.SCORING, newRules);
}

export function updateMatchConfig(newRules) {
  Object.assign(CONFIG.MATCH, newRules);
}
