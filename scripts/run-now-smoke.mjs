import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const testEmail = process.env.SUPABASE_TEST_EMAIL;
const testPassword = process.env.SUPABASE_TEST_PASSWORD;

if (!supabaseUrl || !supabaseAnonKey || !testEmail || !testPassword) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, or SUPABASE_TEST_PASSWORD.');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: testEmail,
  password: testPassword,
});

if (authError || !authData?.user) {
  throw new Error(`Failed to sign in: ${authError?.message || 'Unknown error'}`);
}

const userId = authData.user.id;
const contactPayload = {
  full_name: 'Run Now Test Contact',
  email: 'run-now-test@example.com',
  phone: '555-0101',
  user_id: userId,
  archived: false,
  comfort_level: 'maybe',
  radar_interests: [],
  family_details: { children: [], pets: [] },
};

const { data: contact, error: contactError } = await supabase
  .from('contacts')
  .insert(contactPayload)
  .select('*')
  .single();

if (contactError || !contact) {
  throw new Error(`Failed to insert contact: ${contactError?.message || 'Unknown error'}`);
}

const notesPayload = [
  { contact_id: contact.id, body: 'Met at open house.' },
  { contact_id: contact.id, body: 'Interested in market updates.' },
];

const { error: notesError } = await supabase.from('contact_notes').insert(notesPayload);
if (notesError) {
  throw new Error(`Failed to insert notes: ${notesError.message}`);
}

const touchPayload = Array.from({ length: 5 }, (_, index) => ({
  contact_id: contact.id,
  user_id: userId,
  type: 'reach_out',
  channel: 'text',
  source: 'smoke_test',
  created_at: new Date(Date.now() - (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
}));

const { error: touchesError } = await supabase.from('touches').insert(touchPayload);
if (touchesError) {
  throw new Error(`Failed to insert touches: ${touchesError.message}`);
}

const { data: runNowCandidates, error: runNowCandidatesError } = await supabase.rpc('run_now_candidates', {
  p_user_id: userId,
});

if (runNowCandidatesError) {
  throw new Error(`run_now_candidates RPC failed: ${runNowCandidatesError.message}`);
}

const match = runNowCandidates?.find(candidate => candidate.id === contact.id);
if (!match) {
  throw new Error('Expected run_now_candidates to return the seeded contact.');
}

console.log('Run Now candidates RPC smoke test passed.');
