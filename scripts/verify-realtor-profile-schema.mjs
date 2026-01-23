import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const testEmail = process.env.SUPABASE_TEST_EMAIL;
const testPassword = process.env.SUPABASE_TEST_PASSWORD;

if (!supabaseUrl || !supabaseAnonKey || !testEmail || !testPassword) {
  throw new Error(
    'Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, or SUPABASE_TEST_PASSWORD.'
  );
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
const payload = {
  user_id: userId,
  name: 'Schema Verify Agent',
  headshot: null,
  cadence_type: 'quarterly',
  cadence_custom_days: 90,
};

const { error: upsertError } = await supabase
  .from('realtor_profiles')
  .upsert(payload, { onConflict: 'user_id' })
  .select('user_id, cadence_type, cadence_custom_days')
  .maybeSingle();

if (upsertError) {
  throw new Error(
    `Failed to upsert realtor profile. Ensure cadence_type/cadence_custom_days exist and RLS allows inserts. ${upsertError.message}`
  );
}

const { error: updateError } = await supabase
  .from('realtor_profiles')
  .update({ cadence_custom_days: 95 })
  .eq('user_id', userId);

if (updateError) {
  throw new Error(
    `Failed to update realtor profile. Ensure RLS allows updates. ${updateError.message}`
  );
}

const { data: profile, error: selectError } = await supabase
  .from('realtor_profiles')
  .select('user_id, cadence_type, cadence_custom_days')
  .eq('user_id', userId)
  .maybeSingle();

if (selectError) {
  throw new Error(`Failed to select realtor profile. ${selectError.message}`);
}

if (!profile) {
  throw new Error('Profile not found after upsert; check RLS policies and schema.');
}

console.log('Realtor profile schema + RLS verification passed.');
