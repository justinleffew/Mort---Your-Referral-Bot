import {
  BrainDumpClient,
  Contact,
  ContactNote,
  Opportunity,
  RadarState,
  RealtorProfile,
  ReferralEvent,
  ReferralStage,
  ReferralStatus,
  Touch,
  TouchType,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { invokeEdgeFunction } from './edgeFunctions';
import { EDGE_FUNCTIONS } from './edgeFunctionConfig';

const STORAGE_KEYS = {
  CONTACTS: 'mort_contacts',
  NOTES: 'mort_notes',
  RADAR: 'mort_radar_state',
  PROFILE: 'mort_realtor_profile',
  TOUCHES: 'mort_touches',
  REFERRALS: 'mort_referral_events',
  AGENT_ID: 'mort_agent_id',
  SAMPLE_SEEDED: 'mort_sample_seeded',
};

const STORAGE_VERSION = 'v2';
const AUTH_REQUIRED_MESSAGE = 'Please sign in again.';

type VersionedPayload<T> = {
  version: string;
  data: T;
};

const save = (key: string, data: any) => {
  const payload: VersionedPayload<any> = { version: STORAGE_VERSION, data };
  localStorage.setItem(key, JSON.stringify(payload));
};

const load = <T>(key: string): T[] => {
  const str = localStorage.getItem(key);
  if (!str) return [];
  try {
    const parsed = JSON.parse(str) as VersionedPayload<T[]> | T[];
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      if ((parsed as VersionedPayload<T[]>).version !== STORAGE_VERSION) {
        console.warn(`Storage version mismatch for key "${key}", clearing data.`);
        return [];
      }
      return (parsed as VersionedPayload<T[]>).data ?? [];
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`Failed to parse storage data for key "${key}".`, error);
    return [];
  }
};

const loadObject = <T>(key: string): T | null => {
  const str = localStorage.getItem(key);
  if (!str) return null;
  try {
    const parsed = JSON.parse(str) as VersionedPayload<T> | T;
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      if ((parsed as VersionedPayload<T>).version !== STORAGE_VERSION) {
        console.warn(`Storage version mismatch for key "${key}", clearing data.`);
        return null;
      }
      return (parsed as VersionedPayload<T>).data ?? null;
    }
    return (parsed as T) ?? null;
  } catch (error) {
    console.warn(`Failed to parse storage data for key "${key}".`, error);
    return null;
  }
};

const uuid = () => crypto.randomUUID();
const DEFAULT_PROFILE_NAME = 'Agent';
const DEFAULT_CADENCE_DAYS = 90;
const DEFAULT_PROFILE_CADENCE = {
  cadence: 'quarterly' as const,
  cadence_custom_days: DEFAULT_CADENCE_DAYS,
};
const PROFILE_SYNC_COOLDOWN_MS = 30_000;
let authProfileInitialized = false;
let profileSyncDisabledUntil: number | null = null;
let cachedProfile: RealtorProfile | null = null;
let cachedProfileUserId: string | null = null;
let profileFetchPromise: Promise<RealtorProfile> | null = null;
let profileFetchErrorUserId: string | null = null;
let referralEventsDisabled = false;

const shouldDisableProfileSync = (error: { message?: string; code?: string; details?: string; hint?: string; status?: number }) => {
  const status = error.status ?? Number(error.code);
  if (status === 404) return true;
  const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  return (
    (message.includes('relation') && message.includes('does not exist')) ||
    (message.includes('realtor_profiles') && message.includes('does not exist'))
  );
};

const disableProfileSync = (error: { message?: string; code?: string; details?: string; hint?: string; status?: number }) => {
  if (shouldDisableProfileSync(error)) {
    profileSyncDisabledUntil = Date.now() + PROFILE_SYNC_COOLDOWN_MS;
    console.warn('Temporarily disabling Supabase profile sync after errors. Falling back to local storage.');
  }
};
const isProfileSyncDisabled = () =>
  profileSyncDisabledUntil !== null && Date.now() < profileSyncDisabledUntil;

const shouldDisableReferralEvents = (error: { message?: string; code?: string; details?: string; hint?: string; status?: number }) => {
  const status = error.status ?? Number(error.code);
  if (status === 404) return true;
  const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  return message.includes('referral_events') || message.includes('relation') || message.includes('schema cache');
};

const disableReferralEvents = (error: { message?: string; code?: string; details?: string; hint?: string; status?: number }) => {
  if (!referralEventsDisabled && shouldDisableReferralEvents(error)) {
    referralEventsDisabled = true;
    console.warn('Disabling Supabase referral events due to missing table or schema errors. Falling back to local storage.');
  }
};

const formatSupabaseError = (
  action: string,
  error?: { message?: string; details?: string; hint?: string; code?: string; status?: number }
) => {
  const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return details ? `Unable to ${action}. ${details}` : `Unable to ${action}.`;
};

const resolveCadenceDays = (profile?: RealtorProfile) => {
  const cadenceType = profile?.cadence ?? profile?.cadence_type ?? DEFAULT_PROFILE_CADENCE.cadence;
  if (cadenceType === 'weekly') return 7;
  if (cadenceType === 'monthly') return 30;
  if (cadenceType === 'custom') {
    const customDays = profile?.cadence_custom_days ?? DEFAULT_PROFILE_CADENCE.cadence_custom_days;
    return customDays > 0 ? customDays : DEFAULT_CADENCE_DAYS;
  }
  return DEFAULT_CADENCE_DAYS;
};

const withProfileDefaults = (profile?: RealtorProfile | null): RealtorProfile => ({
  name: profile?.name ?? DEFAULT_PROFILE_NAME,
  headshot: profile?.headshot ?? undefined,
  cadence: profile?.cadence ?? profile?.cadence_type ?? DEFAULT_PROFILE_CADENCE.cadence,
  cadence_custom_days:
    profile?.cadence_custom_days ?? DEFAULT_PROFILE_CADENCE.cadence_custom_days,
});

const resetProfileCache = () => {
  cachedProfile = null;
  cachedProfileUserId = null;
  profileFetchPromise = null;
  profileFetchErrorUserId = null;
};

const selectProfileForUser = async (userId: string): Promise<RealtorProfile> => {
  if (isProfileSyncDisabled()) {
    return withProfileDefaults(loadObject<RealtorProfile>(STORAGE_KEYS.PROFILE));
  }
  if (profileFetchErrorUserId === userId) {
    return withProfileDefaults({ name: DEFAULT_PROFILE_NAME });
  }
  if (cachedProfile && cachedProfileUserId === userId) {
    return cachedProfile;
  }
  if (profileFetchPromise && cachedProfileUserId === userId) {
    return profileFetchPromise;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return withProfileDefaults(loadObject<RealtorProfile>(STORAGE_KEYS.PROFILE));
  }
  cachedProfileUserId = userId;
  profileFetchPromise = (async () => {
    const { data, error } = await supabase
      .from('realtor_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Failed to load profile', error);
      disableProfileSync(error);
      profileFetchErrorUserId = userId;
      profileFetchPromise = null;
      return withProfileDefaults({ name: DEFAULT_PROFILE_NAME });
    }
    if (!data) {
      console.info('Profile missing for user, creating default', { userId });
      profileFetchPromise = null;
      const ensured = await ensureProfileForUser(userId);
      if (ensured) {
        return ensured;
      }
      profileFetchErrorUserId = userId;
      return withProfileDefaults({ name: DEFAULT_PROFILE_NAME });
    }
    const profile = withProfileDefaults({
      name: data.name,
      headshot: data.headshot ?? undefined,
      cadence: data.cadence ?? data.cadence_type ?? undefined,
      cadence_custom_days: data.cadence_custom_days ?? undefined,
    });
    cachedProfile = profile;
    profileFetchPromise = null;
    return profile;
  })();
  return profileFetchPromise;
};

const ensureProfileForUser = async (userId: string): Promise<RealtorProfile | null> => {
  if (isProfileSyncDisabled()) {
    return withProfileDefaults(loadObject<RealtorProfile>(STORAGE_KEYS.PROFILE));
  }
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const defaults = withProfileDefaults({ name: DEFAULT_PROFILE_NAME });
  const payload = {
    user_id: userId,
    name: defaults.name,
    headshot: defaults.headshot ?? null,
    cadence: defaults.cadence ?? DEFAULT_PROFILE_CADENCE.cadence,
    cadence_custom_days: defaults.cadence_custom_days ?? DEFAULT_PROFILE_CADENCE.cadence_custom_days,
  };
  const { data, error } = await supabase
    .from('realtor_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .maybeSingle();
  if (error) {
    console.warn('Failed to ensure profile', error);
    disableProfileSync(error);
    return null;
  }
  const profile = withProfileDefaults({
    name: data?.name ?? defaults.name,
    headshot: data?.headshot ?? defaults.headshot,
    cadence: data?.cadence ?? data?.cadence_type ?? defaults.cadence,
    cadence_custom_days: data?.cadence_custom_days ?? defaults.cadence_custom_days,
  });
  cachedProfile = profile;
  cachedProfileUserId = userId;
  return profile;
};

const getSupabaseUserId = async (supabase: ReturnType<typeof getSupabaseClient>) => {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.warn('Failed to load Supabase user', error);
    return null;
  }
  return data.user?.id ?? null;
};

type RealtorPreferencesInput = {
  name: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'custom';
  cadenceCustomDays?: number | null;
  headshot?: string | null;
};

const saveRealtorPreferences = async (input: RealtorPreferencesInput): Promise<RealtorProfile> => {
  const supabase = getSupabaseClient();
  if (supabase) {
    if (isProfileSyncDisabled()) {
      throw new Error('Profile sync is temporarily unavailable. Please retry.');
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.warn('Failed to load auth session for profile save', sessionError);
      throw new Error('Unable to check authentication status.');
    }
    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      throw new Error('AUTH_REQUIRED');
    }
    const payload: {
      user_id: string;
      name: string | null;
      cadence: RealtorPreferencesInput['cadence'];
      cadence_custom_days: number | null;
      updated_at: string;
      headshot?: string | null;
    } = {
      user_id: userId,
      name: input.name?.trim() || null,
      cadence: input.cadence,
      cadence_custom_days: input.cadence === 'custom' ? (input.cadenceCustomDays ?? null) : null,
      updated_at: new Date().toISOString(),
    };
    if (input.headshot !== undefined) {
      payload.headshot = input.headshot;
    }
    const { data, error } = await supabase
      .from('realtor_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) {
      disableProfileSync(error);
      throw error;
    }
    const savedProfile = withProfileDefaults({
      name: data?.name ?? input.name,
      headshot: data?.headshot ?? input.headshot ?? undefined,
      cadence: data?.cadence ?? data?.cadence_type ?? input.cadence,
      cadence_custom_days:
        data?.cadence_custom_days ??
        (input.cadence === 'custom' ? input.cadenceCustomDays ?? DEFAULT_PROFILE_CADENCE.cadence_custom_days : null) ??
        DEFAULT_PROFILE_CADENCE.cadence_custom_days,
    });
    cachedProfile = savedProfile;
    cachedProfileUserId = userId;
    return savedProfile;
  }

  const fallbackProfile = withProfileDefaults({
    name: input.name,
    headshot: input.headshot ?? undefined,
    cadence: input.cadence,
    cadence_custom_days: input.cadence === 'custom' ? input.cadenceCustomDays ?? DEFAULT_PROFILE_CADENCE.cadence_custom_days : null,
  });
  save(STORAGE_KEYS.PROFILE, fallbackProfile);
  return fallbackProfile;
};

const requireSupabaseUserId = async (
  supabase: ReturnType<typeof getSupabaseClient>,
  action: string
) => {
  if (!supabase) return null;
  const userId = await getSupabaseUserId(supabase);
  if (!userId) {
    throw new Error(`Unable to ${action}: no authenticated user.`);
  }
  return userId;
};

const getAgentId = () => {
  const existing = localStorage.getItem(STORAGE_KEYS.AGENT_ID);
  if (existing) return existing;
  const next = uuid();
  localStorage.setItem(STORAGE_KEYS.AGENT_ID, next);
  return next;
};

const normalizeContact = (contact: Contact): Contact => ({
  ...contact,
  radar_interests: contact.radar_interests ?? [],
  family_details: contact.family_details ?? { children: [], pets: [] },
  segment: contact.segment ?? '',
  tags: contact.tags ?? [],
  cadence_days: contact.cadence_days ?? 90,
  cadence_mode: contact.cadence_mode ?? 'AUTO',
  safe_mode: contact.safe_mode ?? false,
  do_not_contact: contact.do_not_contact ?? false,
  home_area_id: contact.home_area_id ?? null,
});

const CONTACT_INSERT_FIELDS = [
  'id',
  'user_id',
  'full_name',
  'phone',
  'email',
  'location_context',
  'sale_date',
  'last_contacted_at',
  'tags',
  'comfort_level',
  'archived',
  'created_at',
  'radar_interests',
  'family_details',
  'mortgage_inference',
  'suggested_action',
] as const;

const CONTACT_UPDATE_FIELDS = [
  'full_name',
  'phone',
  'email',
  'location_context',
  'sale_date',
  'last_contacted_at',
  'tags',
  'comfort_level',
  'archived',
  'radar_interests',
  'family_details',
  'mortgage_inference',
  'suggested_action',
] as const;

type ContactInsertField = (typeof CONTACT_INSERT_FIELDS)[number];
type ContactUpdateField = (typeof CONTACT_UPDATE_FIELDS)[number];

const buildSupabaseContactInsertPayload = (contact: Contact) => {
  const payload: Partial<Record<ContactInsertField, Contact[ContactInsertField]>> = {};
  for (const field of CONTACT_INSERT_FIELDS) {
    const value = contact[field];
    if (value !== undefined) {
      payload[field] = value;
    }
  }
  return payload;
};

const buildSupabaseContactUpdatePayload = (data: Partial<Contact>) => {
  const payload: Partial<Record<ContactUpdateField, Contact[ContactUpdateField]>> = {};
  for (const field of CONTACT_UPDATE_FIELDS) {
    const value = data[field];
    if (value !== undefined) {
      payload[field] = value;
    }
  }
  return payload;
};

const defaultRadarState = (contactId: string, userId: string): RadarState => ({
  id: uuid(),
  contact_id: contactId,
  user_id: userId,
  reached_out: false,
  angles_used_json: [],
  last_refreshed_at: new Date().toISOString(),
});

const normalizeReferralEvent = (event: ReferralEvent): ReferralEvent => ({
  ...event,
  stage: event.stage ?? 'intro',
  status: event.status ?? 'active',
  notes: event.notes ?? '',
});

const normalizeInterest = (value: string) => value
  .toLowerCase()
  .replace(/[\u2019']/g, '')
  .replace(/[^\w\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const splitInterestList = (value: string) => value
  .replace(/\s+(and|&)\s+/gi, ',')
  .split(/[;,]/)
  .map(item => normalizeInterest(item))
  .filter(Boolean);

const extractRadarInterestsFromText = (text: string) => {
  const sentences = text.split(/[\n.]+/).map(sentence => sentence.trim()).filter(Boolean);
  const interests: string[] = [];
  const cuePattern = /(interests?|hobbies|likes|loves|enjoys|into|interested in|favorite|favourite|follows)\s*:?\s*(.+)/i;

  for (const sentence of sentences) {
    const match = sentence.match(cuePattern);
    if (!match) continue;
    const value = match[2]?.trim();
    if (!value) continue;
    interests.push(...splitInterestList(value));
  }

  return Array.from(new Set(interests));
};

const parseApproxYear = (value?: string | null) => {
  if (!value) return null;
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
};

export const dataService = {
  initAuthProfile: async () => {
    const supabase = getSupabaseClient();
    if (!supabase || authProfileInitialized) return;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Failed to load auth session', error);
      return;
    }
    authProfileInitialized = true;
    let lastUserId = data.session?.user?.id ?? null;
    if (lastUserId) {
      void selectProfileForUser(lastUserId);
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      if (nextUserId !== lastUserId) {
        resetProfileCache();
        profileSyncDisabledUntil = null;
        lastUserId = nextUserId;
      }
      if (!nextUserId) return;
      void selectProfileForUser(nextUserId);
    });
  },

  getProfile: async (): Promise<RealtorProfile> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId && !isProfileSyncDisabled()) {
      return selectProfileForUser(userId);
    }

    // LocalStorage fallback.
    return withProfileDefaults(loadObject<RealtorProfile>(STORAGE_KEYS.PROFILE));
  },

  saveRealtorPreferences: async (input: RealtorPreferencesInput): Promise<RealtorProfile> =>
    saveRealtorPreferences(input),

  saveProfile: async (profile: RealtorProfile): Promise<RealtorProfile> =>
    saveRealtorPreferences({
      name: profile.name,
      cadence: profile.cadence ?? profile.cadence_type ?? DEFAULT_PROFILE_CADENCE.cadence,
      cadenceCustomDays: profile.cadence_custom_days ?? null,
      headshot: profile.headshot ?? null,
    }),

  getContacts: async (): Promise<Contact[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .eq('archived', false);
      if (error) {
        console.warn('Failed to load contacts', error);
        return [];
      }
      return (data || []).map(normalizeContact);
    }

    // LocalStorage fallback.
    return load<Contact>(STORAGE_KEYS.CONTACTS).filter(c => !c.archived).map(normalizeContact);
  },

  getContactById: async (id: string): Promise<Contact | null> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('Failed to load contact', error);
        return null;
      }
      return data ? normalizeContact(data) : null;
    }

    // LocalStorage fallback.
    const contact = load<Contact>(STORAGE_KEYS.CONTACTS).find(c => c.id === id);
    return contact ? normalizeContact(contact) : null;
  },

  addContact: async (data: Partial<Contact>): Promise<Contact> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && !userId) {
      throw new Error(AUTH_REQUIRED_MESSAGE);
    }
    const demoMode = !userId;
    const normalizedRadarInterests = Array.isArray(data.radar_interests)
      ? data.radar_interests.filter(Boolean)
      : [];
    console.info('Add contact request', {
      userId: userId ?? 'none',
      demoMode,
      payloadKeys: Object.keys(data),
    });
    const buildContact = (ownerId: string): Contact =>
      normalizeContact({
        id: uuid(),
        user_id: ownerId,
        full_name: data.full_name || 'Unknown',
        phone: data.phone || '',
        email: data.email || '',
        location_context: data.location_context || '',
        sale_date: data.sale_date,
        last_contacted_at: data.last_contacted_at,
        segment: data.segment || '',
        tags: data.tags || [],
        cadence_days: data.cadence_days ?? 90,
        cadence_mode: data.cadence_mode ?? 'AUTO',
        safe_mode: data.safe_mode ?? false,
        do_not_contact: data.do_not_contact ?? false,
        home_area_id: data.home_area_id ?? null,
        comfort_level: data.comfort_level || 'maybe',
        archived: false,
        created_at: new Date().toISOString(),
        radar_interests: normalizedRadarInterests,
        family_details: data.family_details || { children: [], pets: [] },
        mortgage_inference: data.mortgage_inference,
        suggested_action: data.suggested_action,
      });

    if (supabase && userId) {
      // Supabase mode.
      await ensureProfileForUser(userId);
      const fallbackContact = buildContact(userId);
      const supabasePayload = buildSupabaseContactInsertPayload(fallbackContact);
      if (import.meta.env.DEV) {
        console.log('[addContact] outgoing radar_interests:', fallbackContact.radar_interests, typeof fallbackContact.radar_interests);
        console.log('[addContact] payload keys:', Object.keys(supabasePayload));
      }
      console.info('Supabase add contact insert', {
        table: 'contacts',
        payloadKeys: Object.keys(supabasePayload),
      });
      const { data: inserted, error } = await supabase
        .from('contacts')
        .insert(supabasePayload)
        .select()
        .single();
      if (import.meta.env.DEV) {
        console.log('[addContact] saved radar_interests:', inserted?.radar_interests);
      }
      if (error) {
        console.warn('Failed to add contact', error);
        throw new Error(formatSupabaseError('add contact', error));
      }
      await supabase.from('radar_state').upsert(
        {
          contact_id: inserted.id,
          user_id: userId,
          reached_out: false,
          angles_used_json: [],
          last_refreshed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,contact_id' }
      );
      return normalizeContact(inserted);
    }

    // LocalStorage fallback.
    const agentId = getAgentId();
    const payload = buildContact(agentId);
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    contacts.push(payload);
    save(STORAGE_KEYS.CONTACTS, contacts);

    const radarStates = load<RadarState>(STORAGE_KEYS.RADAR);
    radarStates.push(defaultRadarState(payload.id, agentId));
    save(STORAGE_KEYS.RADAR, radarStates);

    return payload;
  },

  addBrainDumpClients: async (clients: BrainDumpClient[]) => {
    const sanitizeName = (value: string) =>
      value.replace(/\b(and|&)\b\s*$/i, '').replace(/\s+/g, ' ').trim();
    for (const c of clients) {
      const parsedYear = parseApproxYear(c.transaction_history?.approx_year);
      const cleanedNames = (c.names || [])
        .map(name => sanitizeName(String(name)))
        .filter(Boolean);
      const finalNames =
        cleanedNames.length > 0
          ? cleanedNames
          : [`Contact from ${new Date().toLocaleDateString()}`];
      const contact = await dataService.addContact({
        full_name: finalNames.join(' & '),
        location_context: c.location_context,
        sale_date: parsedYear ? `${parsedYear}-01-01` : undefined,
        radar_interests: c.radar_interests,
        family_details: c.family_details,
        mortgage_inference: c.mortgage_inference,
        suggested_action: c.suggested_action,
        tags: c.tags ?? [],
      });
      if (c.transaction_history?.notes) {
        await dataService.addNote(contact.id, c.transaction_history.notes);
      }
    }
  },

  updateContact: async (id: string, data: Partial<Contact>) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const supabasePayload = buildSupabaseContactUpdatePayload(data);
      if (import.meta.env.DEV) {
        console.log('[updateContact] outgoing payload:', supabasePayload);
      }
      const { error } = await supabase
        .from('contacts')
        .update({ ...supabasePayload, user_id: userId })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) {
        console.warn('Failed to update contact', error);
        throw new Error(formatSupabaseError('update contact', error));
      }
      return;
    }

    // LocalStorage fallback.
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    const index = contacts.findIndex(c => c.id === id);
    if (index !== -1) {
      contacts[index] = { ...contacts[index], ...data };
      save(STORAGE_KEYS.CONTACTS, contacts);
    }
  },

  deleteContact: async (id: string) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode - delete contact and related data.
      const { error: radarError } = await supabase
        .from('radar_state')
        .delete()
        .eq('contact_id', id)
        .eq('user_id', userId);
      if (radarError) {
        console.warn('Failed to delete radar state', radarError);
      }

      const { error: notesError } = await supabase
        .from('contact_notes')
        .delete()
        .eq('contact_id', id);
      if (notesError) {
        console.warn('Failed to delete contact notes', notesError);
      }

      const { error: touchesError } = await supabase
        .from('touches')
        .delete()
        .eq('contact_id', id)
        .eq('user_id', userId);
      if (touchesError) {
        console.warn('Failed to delete touches', touchesError);
      }

      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) {
        console.warn('Failed to delete contact', error);
        throw new Error(formatSupabaseError('delete contact', error));
      }
      return;
    }

    // LocalStorage fallback.
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    save(STORAGE_KEYS.CONTACTS, contacts.filter(c => c.id !== id));

    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    save(STORAGE_KEYS.NOTES, notes.filter(n => n.contact_id !== id));

    const radarStates = load<RadarState>(STORAGE_KEYS.RADAR);
    save(STORAGE_KEYS.RADAR, radarStates.filter(r => r.contact_id !== id));

    const touches = load<Touch>(STORAGE_KEYS.TOUCHES);
    save(STORAGE_KEYS.TOUCHES, touches.filter(t => t.contact_id !== id));
  },

  getNotes: async (contactId: string): Promise<ContactNote[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('Failed to load notes', error);
        return [];
      }
      return data || [];
    }

    // LocalStorage fallback.
    return load<ContactNote>(STORAGE_KEYS.NOTES).filter(n => n.contact_id === contactId);
  },

  addNote: async (contactId: string, text: string) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Note text is required.');
    }
    const parsedInterests = extractRadarInterestsFromText(trimmed);
    const buildNote = (): ContactNote => ({
      id: uuid(),
      contact_id: contactId,
      body: trimmed,
      created_at: new Date().toISOString(),
    });

    if (supabase && userId) {
      // Supabase mode.
      console.info('Add note request', {
        userId,
        contactId,
        length: trimmed.length,
      });
      const { error } = await supabase.from('contact_notes').insert({
        contact_id: contactId,
        body: trimmed,
      });
      if (error) {
        const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
        if (message.includes('note_text')) {
          const { error: fallbackError } = await supabase.from('contact_notes').insert({
            contact_id: contactId,
            note_text: trimmed,
          } as { contact_id: string; note_text: string });
          if (fallbackError) {
            console.warn('Failed to add note (note_text fallback)', fallbackError);
            throw new Error(formatSupabaseError('add note', fallbackError));
          }
        } else {
          console.warn('Failed to add note', error);
          throw new Error(formatSupabaseError('add note', error));
        }
      }
      if (parsedInterests.length > 0) {
        const contact = await dataService.getContactById(contactId);
        if (contact) {
          const normalizedCurrent = contact.radar_interests.map(normalizeInterest).filter(Boolean);
          const merged = Array.from(new Set([...normalizedCurrent, ...parsedInterests]));
          const needsUpdate = normalizedCurrent.length !== contact.radar_interests.length
            || contact.radar_interests.some(interest => normalizeInterest(interest) !== interest)
            || merged.length !== normalizedCurrent.length;
          if (needsUpdate) {
            await dataService.updateContact(contactId, { radar_interests: merged });
          }
        }
      }
      return;
    }

    // LocalStorage fallback.
    const note = buildNote();
    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    notes.push(note);
    save(STORAGE_KEYS.NOTES, notes);

    if (parsedInterests.length > 0) {
      const contact = await dataService.getContactById(contactId);
      if (contact) {
        const normalizedCurrent = contact.radar_interests.map(normalizeInterest).filter(Boolean);
        const merged = Array.from(new Set([...normalizedCurrent, ...parsedInterests]));
        const needsUpdate = normalizedCurrent.length !== contact.radar_interests.length
          || contact.radar_interests.some(interest => normalizeInterest(interest) !== interest)
          || merged.length !== normalizedCurrent.length;
        if (needsUpdate) {
          await dataService.updateContact(contactId, { radar_interests: merged });
        }
      }
    }
  },

  updateNote: async (noteId: string, text: string) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      const { error } = await supabase
        .from('contact_notes')
        .update({ body: text })
        .eq('id', noteId);
      if (error) {
        console.warn('Failed to update note', error);
      }
      return;
    }

    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    const index = notes.findIndex(n => n.id === noteId);
    if (index !== -1) {
      notes[index] = { ...notes[index], body: text };
      save(STORAGE_KEYS.NOTES, notes);
    }
  },

  deleteNote: async (noteId: string) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      const { error } = await supabase
        .from('contact_notes')
        .delete()
        .eq('id', noteId);
      if (error) {
        console.warn('Failed to delete note', error);
      }
      return;
    }

    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    save(
      STORAGE_KEYS.NOTES,
      notes.filter(n => n.id !== noteId)
    );
  },

  getRadarState: async (contactId: string): Promise<RadarState | null> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('radar_state')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('Failed to load radar state', error);
        return null;
      }
      if (data) return data;
      const fallback = defaultRadarState(contactId, userId);
      await supabase.from('radar_state').upsert(fallback, { onConflict: 'user_id,contact_id' });
      return fallback;
    }

    // LocalStorage fallback.
    return load<RadarState>(STORAGE_KEYS.RADAR).find(r => r.contact_id === contactId) || null;
  },

  updateRadarState: async (contactId: string, data: Partial<RadarState>) => {
    const supabase = getSupabaseClient();
    if (supabase) {
      let userId: string | null = null;
      try {
        userId = await requireSupabaseUserId(supabase, 'update radar state');
      } catch (error) {
        console.warn('Skipping radar state update without an authenticated Supabase user.', error);
        return;
      }
      if (!userId) {
        console.warn('Skipping radar state update without an authenticated Supabase user.');
        return;
      }
      // Supabase mode.
      const { data: existing, error: loadError } = await supabase
        .from('radar_state')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', userId)
        .maybeSingle();
      if (loadError) {
        console.warn('Failed to load radar state for update', loadError);
        return;
      }
      const mergedAngles = data.angles_used_json
        ? [...(existing?.angles_used_json || []), ...data.angles_used_json].slice(-10)
        : existing?.angles_used_json;
      const payload = {
        ...(existing ?? defaultRadarState(contactId, userId)),
        ...data,
        user_id: userId,
        angles_used_json: mergedAngles ?? [],
      };
      const { error } = await supabase.from('radar_state').upsert(payload);
      if (error) {
        console.warn('Failed to update radar state', error);
      }
      return;
    }

    // LocalStorage fallback.
    const states = load<RadarState>(STORAGE_KEYS.RADAR);
    const index = states.findIndex(r => r.contact_id === contactId);
    if (index !== -1) {
      const existing = states[index];
      const mergedAngles = data.angles_used_json
        ? [...(existing.angles_used_json || []), ...data.angles_used_json].slice(-10)
        : existing.angles_used_json;
      states[index] = {
        ...existing,
        ...data,
        angles_used_json: mergedAngles,
      };
      save(STORAGE_KEYS.RADAR, states);
    }
  },

  getTouches: async (contactId: string): Promise<Touch[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('touches')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('Failed to load touches', error);
        return [];
      }
      return data || [];
    }

    // LocalStorage fallback.
    return load<Touch>(STORAGE_KEYS.TOUCHES).filter(t => t.contact_id === contactId);
  },

  addTouch: async (
    contactId: string,
    type: TouchType,
    options?: { channel?: string; body?: string; source?: string }
  ) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const buildTouch = (ownerId: string): Touch => ({
      id: uuid(),
      contact_id: contactId,
      user_id: ownerId,
      type,
      channel: options?.channel,
      body: options?.body,
      source: options?.source,
      created_at: new Date().toISOString(),
    });

    if (supabase && userId) {
      // Supabase mode.
      const touch = buildTouch(userId);
      const { error } = await supabase.from('touches').insert(touch);
      if (error) {
        console.warn('Failed to add touch', error);
        throw new Error(formatSupabaseError('add touch', error));
      }
      await supabase
        .from('contacts')
        .update({ last_contacted_at: touch.created_at, user_id: userId })
        .eq('id', contactId)
        .eq('user_id', userId);
      return;
    }

    // LocalStorage fallback.
    const agentId = getAgentId();
    const touch = buildTouch(agentId);
    const touches = load<Touch>(STORAGE_KEYS.TOUCHES);
    touches.push(touch);
    save(STORAGE_KEYS.TOUCHES, touches);
    await dataService.updateContact(contactId, { last_contacted_at: touch.created_at });
  },

  getReferralEvents: async (): Promise<ReferralEvent[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId && !referralEventsDisabled) {
      const { data, error } = await supabase
        .from('referral_events')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('Failed to load referral events', error);
        disableReferralEvents(error);
        return [];
      }
      return (data || []).map(normalizeReferralEvent);
    }

    return load<ReferralEvent>(STORAGE_KEYS.REFERRALS).map(normalizeReferralEvent);
  },

  addReferralEvent: async (data: {
    sourceContactId?: string | null;
    referredName: string;
    stage?: ReferralStage;
    status?: ReferralStatus;
    notes?: string;
  }): Promise<ReferralEvent> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const now = new Date().toISOString();
    const buildReferral = (ownerId: string): ReferralEvent =>
      normalizeReferralEvent({
        id: uuid(),
        user_id: ownerId,
        source_contact_id: data.sourceContactId ?? null,
        referred_name: data.referredName.trim() || 'Unknown',
        stage: data.stage ?? 'intro',
        status: data.status ?? 'active',
        notes: data.notes?.trim(),
        created_at: now,
        updated_at: now,
      });

    if (supabase && userId && !referralEventsDisabled) {
      const referral = buildReferral(userId);
      const { data: inserted, error } = await supabase
        .from('referral_events')
        .insert(referral)
        .select()
        .single();
      if (error) {
        console.warn('Failed to add referral event', error);
        disableReferralEvents(error);
        throw new Error(formatSupabaseError('add referral event', error));
      }
      return normalizeReferralEvent(inserted);
    }

    const agentId = getAgentId();
    const referral = buildReferral(agentId);
    const events = load<ReferralEvent>(STORAGE_KEYS.REFERRALS);
    events.push(referral);
    save(STORAGE_KEYS.REFERRALS, events);
    return referral;
  },

  updateReferralEvent: async (id: string, updates: Partial<ReferralEvent>) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const payload = { ...updates, updated_at: new Date().toISOString() };

    if (supabase && userId && !referralEventsDisabled) {
      const { error } = await supabase
        .from('referral_events')
        .update({ ...payload, user_id: userId })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) {
        console.warn('Failed to update referral event', error);
        disableReferralEvents(error);
        throw new Error(formatSupabaseError('update referral event', error));
      }
      return;
    }

    const events = load<ReferralEvent>(STORAGE_KEYS.REFERRALS);
    const index = events.findIndex(event => event.id === id);
    if (index !== -1) {
      events[index] = normalizeReferralEvent({ ...events[index], ...payload });
      save(STORAGE_KEYS.REFERRALS, events);
    }
  },

  getReferralEventsBySource: async (contactId: string) => {
    const events = await dataService.getReferralEvents();
    return events.filter(event => event.source_contact_id === contactId);
  },

  getReferralSourceScore: async (contactId: string) => {
    const events = await dataService.getReferralEventsBySource(contactId);
    const scoreByStage: Record<ReferralStage, number> = {
      intro: 1,
      engaged: 2,
      showing: 3,
      under_contract: 4,
      closed: 5,
      lost: 0,
    };
    const totals = events.reduce(
      (acc, event) => {
        acc.total += 1;
        if (event.status === 'won' || event.stage === 'closed') acc.won += 1;
        if (event.status === 'active') acc.active += 1;
        acc.score += scoreByStage[event.stage] ?? 0;
        return acc;
      },
      { total: 0, won: 0, active: 0, score: 0 }
    );
    return totals;
  },

  getTouchSummary: async (contactId: string) => {
    const touches = await dataService.getTouches(contactId);
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const yearCount = touches.filter(t => new Date(t.created_at) >= startOfYear).length;
    const quarterCount = touches.filter(t => new Date(t.created_at) >= startOfQuarter).length;
    const lastTouch = touches[0]?.created_at;
    return { yearCount, quarterCount, lastTouch };
  },

  getEligibleContacts: async (options: { boostedSegments?: string[]; segmentBoost?: number } = {}): Promise<Contact[]> => {
    const contacts = await dataService.getContacts();
    const profile = await dataService.getProfile();
    const cadenceDays = resolveCadenceDays(profile);
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const boostedSegments = (options.boostedSegments || []).map(segment => segment.toLowerCase());
    const segmentBoost = options.segmentBoost ?? 25;
    let radarStates: RadarState[] = [];
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase.from('radar_state').select('*').eq('user_id', userId);
      if (error) {
        console.warn('Failed to load radar states', error);
      }
      radarStates = data || [];
    } else {
      // LocalStorage fallback.
      radarStates = load<RadarState>(STORAGE_KEYS.RADAR);
    }

    const today = new Date();
    return contacts
      .filter(contact => {
        if (contact.archived) return false;
        if (contact.do_not_contact) return false;
        const state = radarStates.find(r => r.contact_id === contact.id);
        if (!state) return true;
        if (state.suppressed_until && new Date(state.suppressed_until) > today) return false;

        if (contact.suggested_action && !state.last_prompt_shown_at) return true;

        const cadenceCutoff = new Date();
        cadenceCutoff.setDate(cadenceCutoff.getDate() - cadenceDays);
        const lastContactDate = contact.last_contacted_at ? new Date(contact.last_contacted_at) : null;
        const saleDate = contact.sale_date ? new Date(contact.sale_date) : null;

        if (lastContactDate) {
          return lastContactDate <= cadenceCutoff;
        }
        if (saleDate) {
          return saleDate <= cadenceCutoff;
        }
        return true;
      })
      .sort((a, b) => {
        const aSegmentBoost = a.segment && boostedSegments.includes(a.segment.toLowerCase()) ? segmentBoost : 0;
        const bSegmentBoost = b.segment && boostedSegments.includes(b.segment.toLowerCase()) ? segmentBoost : 0;
        const aScore = (a.suggested_action ? 100 : 0) + a.radar_interests.length * 10 + aSegmentBoost;
        const bScore = (b.suggested_action ? 100 : 0) + b.radar_interests.length * 10 + bSegmentBoost;
        return bScore - aScore;
      });
  },

  runNowOpportunities: async (): Promise<Opportunity[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const contacts = await dataService.getContacts();
    const doNotContactIds = new Set(
      contacts.filter(contact => contact.do_not_contact).map(contact => contact.id)
    );
    const buildOfflineMessages = (contact: Contact) => {
      const firstName = contact.full_name.split(' ')[0] || 'there';
      const interest = contact.radar_interests[0] || 'home projects';
      const location = contact.location_context || 'your area';
      return [
        `Hi ${firstName}, quick check-in—hope you’re doing well. Happy to help with anything home-related.`,
        `Hi ${firstName}, saw something about ${interest} and thought of you. Hope everything’s going well.`,
        `Hi ${firstName}, I’ve been keeping an eye on updates around ${location}. If you ever want a quick take, I’m here.`,
      ];
    };
    const buildOfflineOpportunities = async () => {
      const profile = await dataService.getProfile();
      const cadenceDefault = resolveCadenceDays(profile);
      const eligibleContacts = await dataService.getEligibleContacts();
      const now = new Date();
      const nowIso = now.toISOString();
      const yearCutoff = new Date();
      yearCutoff.setDate(yearCutoff.getDate() - 365);
      const opportunities = await Promise.all(
        eligibleContacts.map(async contact => {
          const cadenceDays = contact.cadence_days ?? cadenceDefault;
          const [touches, notes] = await Promise.all([
            dataService.getTouches(contact.id),
            dataService.getNotes(contact.id),
          ]);
          const lastTouchAt = touches[0]?.created_at ?? contact.last_contacted_at ?? null;
          const lastTouchDate = lastTouchAt ? new Date(lastTouchAt) : null;
          const daysSinceLastTouch = lastTouchDate && !Number.isNaN(lastTouchDate.getTime())
            ? Math.floor((Date.now() - lastTouchDate.getTime()) / (1000 * 60 * 60 * 24))
            : undefined;
          const daysSinceForScore = typeof daysSinceLastTouch === 'number' ? daysSinceLastTouch : cadenceDays + 1;
          const touchesLast365 = touches.filter(touch => new Date(touch.created_at) >= yearCutoff).length;
          const lastNoteAt = notes[0]?.created_at ?? null;
          const lastNoteDays = lastNoteAt
            ? Math.floor((Date.now() - new Date(lastNoteAt).getTime()) / (1000 * 60 * 60 * 24))
            : null;

          let score = 0;
          if (daysSinceForScore > cadenceDays) score += 30;
          score += Math.min(notes.length, 20);
          if (daysSinceForScore > 180) score += 15;
          if (lastNoteDays !== null && lastNoteDays <= 30) score += 10;
          if (daysSinceForScore < 14) score -= 20;
          if (contact.radar_interests.length > 0) score += Math.min(contact.radar_interests.length * 5, 15);
          if (contact.suggested_action) score += 15;

          const cadenceViolation = daysSinceForScore < cadenceDays;
          const yearCapExceeded = touchesLast365 >= 4;
          const warningFlags = [
            ...(cadenceViolation ? ['CADENCE_VIOLATION'] : []),
            ...(yearCapExceeded ? ['YEAR_CAP_EXCEEDED'] : []),
            ...(daysSinceForScore < 14 ? ['TOUCHED_RECENTLY'] : []),
          ];
          const reasons = [
            daysSinceForScore > cadenceDays ? 'Over cadence' : 'Inside cadence',
            yearCapExceeded ? 'High yearly touch count' : 'Within yearly touch cap',
            lastNoteAt ? 'Recent notes on file' : 'No recent notes',
            ...(contact.radar_interests.length > 0 ? ['Interest match'] : []),
            ...(contact.suggested_action ? ['Suggested action on file'] : []),
          ];

          return {
            id: uuid(),
            user_id: getAgentId(),
            contact_id: contact.id,
            area_id: contact.home_area_id ?? null,
            run_context: 'RUN_NOW',
            score,
            reasons,
            suggested_messages: buildOfflineMessages(contact),
            status: 'new',
            warning_flags: warningFlags,
            last_touch_at: lastTouchAt,
            touches_last_365: touchesLast365,
            cadence_violation: cadenceViolation,
            year_cap_exceeded: yearCapExceeded,
            created_at: nowIso,
            updated_at: nowIso,
            contact_full_name: contact.full_name,
            cadence_days: cadenceDays,
            days_since_last_touch: daysSinceLastTouch,
          } satisfies Opportunity;
        })
      );

      return opportunities
        .filter(opportunity => !doNotContactIds.has(opportunity.contact_id))
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.contact_full_name ?? '').localeCompare(b.contact_full_name ?? '')))
        .slice(0, 5);
    };
    if (supabase && userId) {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session) {
        console.warn('Failed to load session for run now', sessionError);
        return buildOfflineOpportunities();
      }
      const data = await invokeEdgeFunction<{ opportunities?: Opportunity[] }, { exclude_do_not_contact: boolean }>({
        functionName: EDGE_FUNCTIONS.RUN_NOW,
        body: { exclude_do_not_contact: true },
      });
      if (data && Array.isArray(data.opportunities)) {
        return (data.opportunities as Opportunity[]).filter(opportunity => !doNotContactIds.has(opportunity.contact_id));
      }
      return Array.isArray(data as unknown) ? (data as Opportunity[]).filter(opportunity => !doNotContactIds.has(opportunity.contact_id)) : [];
    }

    return buildOfflineOpportunities();
  },

  bulkImport: async (rows: any[]) => {
    const contacts = await dataService.getContacts();
    const normalizeName = (value: string) => value.trim();
    const normalizeEmail = (value: string) => value.trim().toLowerCase();
    const normalizePhone = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return '';
      const digits = trimmed.replace(/\D/g, '');
      return trimmed.startsWith('+') ? `+${digits}` : digits;
    };
    const contactsByEmail = new Map<string, Contact>();
    const contactsByPhone = new Map<string, Contact>();

    contacts.forEach(contact => {
      const normalizedEmail = normalizeEmail(contact.email || '');
      const normalizedPhone = normalizePhone(contact.phone || '');
      if (normalizedEmail) {
        contactsByEmail.set(normalizedEmail, contact);
      }
      if (normalizedPhone) {
        contactsByPhone.set(normalizedPhone, contact);
      }
    });

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const rawName = row['Name'] || row['Full Name'] || row['name'] || '';
      const rawPhone = row['Phone'] || row['phone'] || row['Mobile'] || '';
      const rawEmail = row['Email'] || row['email'] || '';

      const full_name = rawName ? normalizeName(rawName) : 'Unknown';
      const phone = rawPhone ? normalizePhone(rawPhone) : '';
      const email = rawEmail ? normalizeEmail(rawEmail) : '';
      const sale_date = row['Sale Date'] || row['Closing Date'] || undefined;
      const last_contacted_at = row['Last Contacted'] || undefined;

      const existing = (email && contactsByEmail.get(email)) || (phone && contactsByPhone.get(phone));

      if (existing) {
        const nextData: Partial<Contact> = {
          full_name,
          phone: phone || existing.phone,
          email: email || existing.email,
          sale_date: sale_date ?? existing.sale_date,
          last_contacted_at: last_contacted_at ?? existing.last_contacted_at,
        };
        const hasChanges = Object.entries(nextData).some(([key, value]) => {
          return value !== undefined && (existing as any)[key] !== value;
        });

        if (hasChanges) {
          await dataService.updateContact(existing.id, nextData);
          const updatedContact = { ...existing, ...nextData };
          if (email) contactsByEmail.set(email, updatedContact as Contact);
          if (phone) contactsByPhone.set(phone, updatedContact as Contact);
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const newContact = await dataService.addContact({
        full_name,
        phone,
        email,
        sale_date,
        last_contacted_at,
      });
      if (email) contactsByEmail.set(email, newContact);
      if (phone) contactsByPhone.set(phone, newContact);
      added += 1;
    }

    return { added, updated, skipped };
  },

  getStats: async () => {
    const contacts = await dataService.getContacts();
    const total = contacts.length;
    const withInterests = contacts.filter(c => c.radar_interests.length > 0).length;
    const percent = total === 0 ? 0 : Math.round((withInterests / total) * 100);
    return { total, withInterests, percent };
  },

  hasSeededSampleContacts: () => Boolean(localStorage.getItem(STORAGE_KEYS.SAMPLE_SEEDED)),

  seedSampleContacts: async (options?: { forceSupabase?: boolean }) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    const demoSeedEnabled = import.meta.env?.VITE_DEMO_SEED === 'true';
    const allowSupabaseSeed = demoSeedEnabled || options?.forceSupabase;
    if (supabase && userId && !allowSupabaseSeed) {
      console.warn('Skipping sample seed in Supabase mode.');
      return { added: 0 };
    }
    if (dataService.hasSeededSampleContacts()) {
      return { added: 0 };
    }
    const existingContacts = await dataService.getContacts();
    if (existingContacts.length > 0) {
      return { added: 0 };
    }
    const lastContactedAt = new Date().toISOString();
    const samples: Array<{
      contact: Partial<Contact>;
      note: string;
      touch?: { type: TouchType; channel?: string; body?: string; source?: string };
    }> = [
      {
        contact: {
          full_name: 'Camila Reed',
          email: 'camila.reed@example.com',
          phone: '(415) 555-0142',
          location_context: 'Looking for a condo near SoMa',
          radar_interests: ['Move-up buyer', 'First-time buyer', 'Local markets'],
          segment: 'Hot',
          tags: ['Referral', 'Finance'],
          suggested_action: 'Send a quick check-in and share two listings.',
          last_contacted_at: lastContactedAt,
        },
        note: 'Met at an open house. Interested in a two-bed condo and tracking SoMa price shifts.',
        touch: {
          type: 'reach_out',
          channel: 'sms',
          body: 'Shared two fresh SoMa listings and asked about timing.',
          source: 'seed',
        },
      },
      {
        contact: {
          full_name: 'Marcus Lee',
          email: 'marcus.lee@example.com',
          phone: '(312) 555-0199',
          location_context: 'Relocating from Chicago to Denver',
          radar_interests: ['Relocation', 'Referral partner', 'Denver neighborhoods'],
          segment: 'Warm',
          tags: ['Partner'],
          suggested_action: 'Ask for preferred neighborhoods and timing.',
          last_contacted_at: lastContactedAt,
        },
        note: 'Wants a short list of Denver neighborhoods with good schools and quick commutes.',
        touch: {
          type: 'email',
          channel: 'email',
          body: 'Sent a quick relocation checklist and neighborhood overview.',
          source: 'seed',
        },
      },
      {
        contact: {
          full_name: 'Priya Patel',
          email: 'priya.patel@example.com',
          phone: '(206) 555-0177',
          location_context: 'Thinking about refinancing this summer',
          radar_interests: ['Refinance', 'Rate watch'],
          segment: 'Nurture',
          tags: ['Past client'],
          suggested_action: 'Share rate watch update and offer a 15-min review.',
          last_contacted_at: lastContactedAt,
        },
        note: 'Asked for a quick update on rates and whether a 15-year option makes sense.',
        touch: {
          type: 'call',
          channel: 'phone',
          body: 'Left a voicemail with a promise to send rate comparisons.',
          source: 'seed',
        },
      },
    ];
    for (const sample of samples) {
      const contact = await dataService.addContact(sample.contact);
      await dataService.addNote(contact.id, sample.note);
      if (sample.touch) {
        await dataService.addTouch(contact.id, sample.touch.type, {
          channel: sample.touch.channel,
          body: sample.touch.body,
          source: sample.touch.source,
        });
      }
    }
    localStorage.setItem(STORAGE_KEYS.SAMPLE_SEEDED, 'true');
    return { added: samples.length };
  },

  getRadarStates: async (): Promise<RadarState[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      const { data, error } = await supabase.from('radar_state').select('*').eq('user_id', userId);
      if (error) {
        console.warn('Failed to load radar states', error);
        return [];
      }
      return data || [];
    }

    return load<RadarState>(STORAGE_KEYS.RADAR);
  },

  isSupabaseEnabled: () => isSupabaseConfigured(),
};
