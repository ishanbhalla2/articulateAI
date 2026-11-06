SET search_path TO articulate;

-- uploads arrive as numbered chunks under media_path (see app upload flow); prepare_media joins them
ALTER TABLE session_media ADD COLUMN IF NOT EXISTS part_count integer NOT NULL DEFAULT 1;
