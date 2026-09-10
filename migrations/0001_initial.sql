CREATE TABLE IF NOT EXISTS community_runs (
  id TEXT PRIMARY KEY,
  player_hash TEXT NOT NULL,
  game TEXT NOT NULL,
  implementation TEXT,
  game_data_version TEXT NOT NULL,
  phase TEXT NOT NULL,
  mining_type TEXT NOT NULL CHECK (mining_type IN ('active','afk')),
  start_counter INTEGER NOT NULL,
  end_counter INTEGER NOT NULL,
  blocks_mined INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  average_bps REAL NOT NULL,
  duration_bucket TEXT NOT NULL,
  source TEXT NOT NULL,
  tool TEXT,
  break_speed TEXT,
  momentum TEXT,
  device TEXT,
  quality_state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_game_phase_type ON community_runs(game, phase, mining_type);
CREATE INDEX IF NOT EXISTS idx_runs_duration_bucket ON community_runs(game, duration_bucket);
CREATE INDEX IF NOT EXISTS idx_runs_quality_created ON community_runs(quality_state, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_player ON community_runs(player_hash, created_at);
