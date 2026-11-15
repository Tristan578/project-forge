-- Fork attribution (#7858): GET /api/community/games/[id] asks "was this
-- game's project created by a fork?" with WHERE forked_project_id = $1.
-- The column had no index; idx_game_forks_original already covers the
-- fork-count query on the other side of the relation.
CREATE INDEX IF NOT EXISTS "idx_game_forks_forked_project" ON "game_forks" USING btree ("forked_project_id");