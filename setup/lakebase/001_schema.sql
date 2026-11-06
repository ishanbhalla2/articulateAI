CREATE SCHEMA IF NOT EXISTS articulate;
SET search_path TO articulate;

CREATE TABLE IF NOT EXISTS audience_profiles (
  audience_key     text PRIMARY KEY,
  display_name     text NOT NULL,
  cluster          text NOT NULL CHECK (cluster IN ('practitioner', 'tech_leader', 'business')),
  display_order    smallint NOT NULL,
  depth            text NOT NULL,
  cares_about      text NOT NULL,
  common_mistakes  text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS category_library (
  domain_key     text NOT NULL,
  domain_name    text NOT NULL,
  category_key   text NOT NULL,
  category_name  text NOT NULL,
  description    text NOT NULL,
  anchor_1       text NOT NULL,
  anchor_3       text NOT NULL,
  anchor_5       text NOT NULL,
  is_general     boolean NOT NULL,
  display_order  smallint NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  PRIMARY KEY (domain_key, category_key)
);

CREATE TABLE IF NOT EXISTS model_catalog (
  provider       text NOT NULL,
  model_id       text NOT NULL,
  display_name   text NOT NULL,
  -- serving endpoint or AI Gateway model service the job calls
  invoke_target  text NOT NULL,
  accepts_text   boolean NOT NULL DEFAULT true,
  accepts_image  boolean NOT NULL DEFAULT false,
  accepts_audio  boolean NOT NULL DEFAULT false,
  accepts_video  boolean NOT NULL DEFAULT false,
  note           text,
  enabled        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (provider, model_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  version           serial PRIMARY KEY,
  llm_instructions  text NOT NULL,
  provider          text NOT NULL,
  model_id          text NOT NULL,
  depth_level       smallint NOT NULL CHECK (depth_level BETWEEN 1 AND 5),
  is_current        boolean NOT NULL DEFAULT false,
  updated_by        text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider, model_id) REFERENCES model_catalog (provider, model_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_one_current ON app_settings (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS sessions (
  session_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  participant_name   text NOT NULL,
  topic_text         text,
  topic_media_path   text,
  domain_key         text,
  domain_source      text NOT NULL DEFAULT 'auto' CHECK (domain_source IN ('auto', 'user')),
  is_provisional     boolean NOT NULL DEFAULT false,
  settings_snapshot  jsonb,
  -- 'draft' backs the Save draft button; the rest follow the job lifecycle
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'uploaded', 'processing', 'complete', 'failed')),
  status_detail      text,
  current_step       text,
  job_run_id         bigint
);
CREATE INDEX IF NOT EXISTS sessions_created_by_idx ON sessions (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions (status);

CREATE TABLE IF NOT EXISTS session_judges (
  judge_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
  name        text,
  role        text,
  UNIQUE (session_id, position)
);

CREATE TABLE IF NOT EXISTS session_media (
  media_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('topic', 'participant', 'judge')),
  judge_id          uuid REFERENCES session_judges ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('upload', 'live')),
  media_path        text NOT NULL,
  media_type        text NOT NULL CHECK (media_type IN ('audio', 'video')),
  -- container/codec as reported by the browser, e.g. audio/webm;codecs=opus
  mime_type         text,
  original_filename text,
  duration_seconds  numeric(10, 2),
  audio_path        text,
  transcript_path   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'judge') = (judge_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS session_media_session_idx ON session_media (session_id);

CREATE TABLE IF NOT EXISTS session_audiences (
  session_id    uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
  audience_key  text NOT NULL REFERENCES audience_profiles,
  PRIMARY KEY (session_id, audience_key)
);

CREATE TABLE IF NOT EXISTS domain_proposals (
  proposal_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid REFERENCES sessions ON DELETE SET NULL,
  proposed_domain_key   text NOT NULL,
  proposed_domain_name  text NOT NULL,
  proposed_categories   jsonb NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_by           text,
  reviewed_at           timestamptz
);

-- one row per run so retries keep history; the latest row is the current result
CREATE TABLE IF NOT EXISTS feedback_results (
  result_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
  feedback_json   jsonb NOT NULL,
  model_name      text NOT NULL,
  prompt_version  text NOT NULL,
  depth_level     smallint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_results_session_idx ON feedback_results (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_ratings (
  session_id  uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
  rated_by    text NOT NULL,
  useful      boolean NOT NULL,
  comment     text,
  rated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, rated_by)
);
