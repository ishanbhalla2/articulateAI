export const JUDGE_ROLES = [
  'AI Architect',
  'AI Developer',
  'Data Engineer',
  'Data Analyst',
  'Full Stack Developer',
  'Web Developer',
  'AI Team Lead',
  'CTO',
  'CEO',
  'HR',
  'Project Manager',
  'Business Development Manager',
  'Other',
] as const;

export const AUDIENCE_CLUSTERS = [
  { key: 'practitioner', label: 'Practitioners' },
  { key: 'tech_leader', label: 'Technical leaders' },
  { key: 'business', label: 'Business' },
] as const;

export const JOB_STEPS = [
  { key: 'prepare_media', label: 'Preparing media' },
  { key: 'transcribe', label: 'Transcribing' },
  { key: 'delivery_metrics', label: 'Delivery metrics' },
  { key: 'classify_domain', label: 'Choosing domain' },
  { key: 'generate_feedback', label: 'Generating feedback' },
  { key: 'persist', label: 'Saving results' },
] as const;

export const DEPTH_LEVELS = [
  { level: 1, name: 'Quick', cost: '$', speed: 'Fastest', analysis: 'One pass over the transcripts', evidence: '1 quote per category', video: 'Not analysed' },
  { level: 2, name: 'Light', cost: '$$', speed: 'Fast', analysis: 'One pass, plus delivery metrics', evidence: '1 quote per category', video: 'Not analysed' },
  { level: 3, name: 'Balanced', cost: '$$$', speed: 'Moderate', analysis: 'One pass, then verify every quote exists in the transcript', evidence: '2 quotes per category', video: 'Low resolution' },
  { level: 4, name: 'Detailed', cost: '$$$$', speed: 'Slower', analysis: 'Two passes: draft, then review against the rubric', evidence: '2–3 quotes per category', video: 'Medium resolution' },
  { level: 5, name: 'Thorough', cost: '$$$$$', speed: 'Slowest', analysis: 'Two passes, plus reconciling judges category by category', evidence: '3 quotes per category', video: 'High resolution' },
] as const;

export const INSTRUCTION_PLACEHOLDERS = ['{topic}', '{domain}', '{audiences}', '{judges}', '{categories}'] as const;

export const DEFAULT_LLM_INSTRUCTIONS = `You are an experienced presentation coach. Assess the participant's talk for the selected audiences.

Treat the judges' comments as the expert view. Where judges disagree, say so and explain which view better fits the audience.

Score each category from 1 to 5 against its rubric. Back every score with a timestamped quote from the participant. Be specific and constructive, and give one practical improvement per category.

Write in British English.`;

export const MIN_JUDGES = 1;
export const MAX_JUDGES = 10;
export const DEFAULT_JUDGE_SLOTS = 5;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

export type SessionStatus = 'draft' | 'uploaded' | 'processing' | 'complete' | 'failed';
export type MediaRole = 'topic' | 'participant' | 'judge';
export type MediaSource = 'upload' | 'live';
export type MediaType = 'audio' | 'video';

export interface AudienceProfile {
  audience_key: string;
  display_name: string;
  cluster: (typeof AUDIENCE_CLUSTERS)[number]['key'];
  display_order: number;
  depth: string;
  cares_about: string;
  common_mistakes: string;
  is_active: boolean;
}

export interface Category {
  domain_key: string;
  domain_name: string;
  category_key: string;
  category_name: string;
  description: string;
  anchor_1: string;
  anchor_3: string;
  anchor_5: string;
  is_general: boolean;
  display_order: number;
  status: 'active' | 'retired';
}

export interface ModelInfo {
  provider: string;
  model_id: string;
  display_name: string;
  invoke_target: string;
  accepts_text: boolean;
  accepts_image: boolean;
  accepts_audio: boolean;
  accepts_video: boolean;
  note: string | null;
  enabled: boolean;
}

export interface AppSettings {
  version: number;
  llm_instructions: string;
  provider: string;
  model_id: string;
  depth_level: number;
  updated_by: string;
  updated_at: string;
}

export interface MediaRef {
  media_id: string;
  role: MediaRole;
  judge_id: string | null;
  source: MediaSource;
  media_path: string;
  media_type: MediaType;
  mime_type: string | null;
  original_filename: string | null;
  duration_seconds: number | null;
  part_count: number;
  audio_path?: string | null;
  transcript_path?: string | null;
}

export interface JudgeInput {
  judge_id: string;
  position: number;
  name: string;
  role: string;
}

export interface SessionInput {
  participant_name: string;
  topic_text: string | null;
  domain_key: string | null;
  judges: JudgeInput[];
  audiences: string[];
  media: MediaRef[];
}

export interface SessionSummary {
  session_id: string;
  participant_name: string;
  topic_text: string | null;
  domain_key: string | null;
  domain_name: string | null;
  is_provisional: boolean;
  status: SessionStatus;
  status_detail: string | null;
  current_step: string | null;
  created_at: string;
  created_by: string;
  audiences: string[];
  average_score: number | null;
}

export interface Evidence {
  timestamp: string;
  quote: string;
}

export interface FeedbackCategory {
  category_key: string;
  is_general: boolean;
  score: number;
  evidence: Evidence[];
  judges: {
    consensus: string | null;
    disagreements: string | null;
    by_judge: { judge_id: string; comment: string | null; lens_note: string | null }[];
  };
  audience_notes: { audience_key: string; note: string }[];
  improvement: string;
}

export interface Feedback {
  domain_key: string;
  overall_summary: string;
  delivery_metrics: {
    words_per_minute: number;
    filler_word_count: number;
    filler_words_per_minute: number;
    long_pauses_over_3s: number;
    duration_seconds: number;
  };
  categories: FeedbackCategory[];
  audience_fit: { audience_key: string; rating: 'served_well' | 'partly' | 'underserved'; note: string }[];
  audience_gaps: string[];
  top_strengths: string[];
  top_priorities: string[];
}

export interface SessionDetail extends SessionSummary {
  topic_media_path: string | null;
  domain_source: 'auto' | 'user';
  settings_snapshot: { provider: string; model_id: string; depth_level: number; instructions_version: number } | null;
  judges: JudgeInput[];
  media: MediaRef[];
  feedback: { feedback_json: Feedback; model_name: string; prompt_version: string; depth_level: number; created_at: string } | null;
  categories: Category[];
  my_rating: boolean | null;
}

export interface DomainProposal {
  proposal_id: string;
  session_id: string | null;
  proposed_domain_key: string;
  proposed_domain_name: string;
  proposed_categories: { category_key: string; category_name: string; description: string; anchor_1: string; anchor_3: string; anchor_5: string }[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export function missingForGenerate(input: SessionInput): string[] {
  const missing: string[] = [];
  if (!input.participant_name.trim()) missing.push('participant name');
  const hasTopic = !!input.topic_text?.trim() || input.media.some((m) => m.role === 'topic');
  if (!hasTopic) missing.push('topic');
  if (!input.media.some((m) => m.role === 'participant')) missing.push('participant recording');
  if (!input.media.some((m) => m.role === 'judge')) missing.push('at least one judge recording');
  if (input.audiences.length === 0) missing.push('at least one audience');
  return missing;
}
