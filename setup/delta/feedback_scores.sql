-- Databricks notebook source
CREATE TABLE IF NOT EXISTS articulate_ai_ib.articulate.feedback_scores (
  session_id       STRING        NOT NULL,
  participant_name STRING,
  created_at       TIMESTAMP     NOT NULL,
  domain_key       STRING        NOT NULL,
  category_key     STRING        NOT NULL,
  is_general       BOOLEAN       NOT NULL,
  score            INT           NOT NULL,
  audiences        ARRAY<STRING>,
  judge_count      INT,
  model_id         STRING,
  depth_level      INT,
  prompt_version   STRING
)
CLUSTER BY (created_at, domain_key)
COMMENT 'ArticulateAI: one row per session x category score, for trend reporting';

-- COMMAND ----------

ALTER TABLE articulate_ai_ib.articulate.feedback_scores
  SET TAGS ('project' = 'articulate-ai', 'owner' = 'ishan.bhalla@vivanti.com', 'env' = 'dev');
