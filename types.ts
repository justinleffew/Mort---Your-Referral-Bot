
export type ComfortLevel = 'yes' | 'maybe' | 'not_now';

export interface MortgageInference {
  likely_rate_environment: string;
  opportunity_tag: string;
  reasoning: string;
}

export interface FamilyDetails {
  children: string[];
  pets: string[];
}

export interface Contact {
  id: string;
  user_id: string;
  full_name: string;
  phone?: string;
  email?: string;
  location_context?: string;
  sale_date?: string; // ISO date string
  last_contacted_at?: string; // ISO date string
  segment?: string;
  tags?: string[];
  cadence_days?: number;
  cadence_mode?: 'AUTO' | 'MANUAL';
  safe_mode?: boolean;
  do_not_contact?: boolean;
  home_area_id?: string | null;
  comfort_level: ComfortLevel;
  archived: boolean;
  created_at: string;
  // New Rich Fields
  radar_interests: string[];
  family_details: FamilyDetails;
  mortgage_inference?: MortgageInference;
  suggested_action?: string;
}

export interface ContactNote {
  id: string;
  contact_id: string;
  user_id: string;
  note_text: string;
  created_at: string;
}

export interface RadarState {
  id: string;
  contact_id: string;
  user_id: string;
  reached_out: boolean;
  reached_out_at?: string;
  suppressed_until?: string; // ISO date string (YYYY-MM-DD)
  last_prompt_shown_at?: string;
  angles_used_json: Array<{ angle: string; used_at: string }>;
  last_angle?: string;
  last_reason?: string;
  last_message?: string;
  last_refreshed_at?: string;
}

export type TouchType = 'call' | 'text' | 'email' | 'meeting' | 'auto' | 'reach_out';

export interface Touch {
  id: string;
  contact_id: string;
  user_id: string;
  type: TouchType;
  channel?: string;
  body?: string;
  created_at: string;
  source?: string;
}

export interface MortgageQueryResponse {
  buyer_script: string;
  ballpark_numbers: string;
  heads_up: string;
  next_steps: string;
}

export interface GeneralAssistResponse {
  response: string;
}

export interface RealtorProfile {
  name: string;
  headshot?: string; // base64
  cadence_type?: 'weekly' | 'monthly' | 'quarterly' | 'custom';
  cadence_custom_days?: number;
}

export interface Opportunity {
  id: string;
  user_id: string;
  contact_id: string;
  area_id?: string | null;
  run_context: 'WEEKLY' | 'RUN_NOW';
  score: number;
  reasons: string[];
  suggested_messages: string[];
  chosen_message?: string | null;
  status: 'new' | 'dismissed' | 'sent' | 'snoozed';
  warning_flags: string[];
  last_touch_at?: string | null;
  touches_last_365: number;
  cadence_violation: boolean;
  year_cap_exceeded: boolean;
  created_at: string;
  updated_at: string;
  contact_full_name?: string;
  cadence_days?: number;
  days_since_last_touch?: number;
}

export type RadarAngle = 'friendly_checkin' | 'interest_based' | 'time_since_contact' | 'homeownership_milestone' | 'light_value_framing' | 'equity_opportunity';

export interface GeneratedMessage {
  message: string;
  reason: string;
  angle: RadarAngle;
}

export interface BrainDumpClient {
  names: string[];
  location_context: string;
  transaction_history: {
    approx_year: string;
    notes: string;
  };
  radar_interests: string[];
  family_details: {
    children: string[];
    pets: string[];
  };
  mortgage_inference: MortgageInference;
  suggested_action: string;
}
