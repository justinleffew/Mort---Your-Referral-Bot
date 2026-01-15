import { BrainDumpClient, Contact, ContactNote, RadarState, RealtorProfile, Touch, TouchType } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const STORAGE_KEYS = {
  CONTACTS: 'mort_contacts',
  NOTES: 'mort_notes',
  RADAR: 'mort_radar_state',
  PROFILE: 'mort_realtor_profile',
  TOUCHES: 'mort_touches',
  AGENT_ID: 'mort_agent_id',
};

const STORAGE_VERSION = 'v2';

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
    return parsed ?? null;
  } catch (error) {
    console.warn(`Failed to parse storage data for key "${key}".`, error);
    return null;
  }
};

const uuid = () => crypto.randomUUID();
const DEFAULT_PROFILE_NAME = 'Agent';
let authProfileInitialized = false;

const resolveProfileName = (userName?: string, metadata?: Record<string, any>) => {
  const trimmed = userName?.trim();
  if (trimmed) return trimmed;
  const metaName = metadata?.full_name || metadata?.name;
  if (typeof metaName === 'string' && metaName.trim()) return metaName.trim();
  return DEFAULT_PROFILE_NAME;
};

const getAuthUser = async () => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.warn('Failed to load auth user', error);
    return null;
  }
  return data.user ?? null;
};

const upsertProfileForUser = async (user: { id: string; user_metadata?: Record<string, any> }, nameOverride?: string) => {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const name = resolveProfileName(nameOverride, user.user_metadata);
  const { error } = await supabase.from('realtor_profiles').upsert(
    {
      user_id: user.id,
      name,
      headshot: null,
    },
    {
      onConflict: 'user_id',
      ignoreDuplicates: true,
    }
  );
  if (error) {
    console.warn('Failed to initialize profile', error);
  }
};

const ensureAuthProfile = async (nameOverride?: string) => {
  const user = await getAuthUser();
  if (!user) return;
  await upsertProfileForUser(user, nameOverride);
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
});

const defaultRadarState = (contactId: string, userId: string): RadarState => ({
  id: uuid(),
  contact_id: contactId,
  user_id: userId,
  reached_out: false,
  angles_used_json: [],
  last_refreshed_at: new Date().toISOString(),
});

export const dataService = {
  initAuthProfile: async (nameOverride?: string) => {
    const supabase = getSupabaseClient();
    if (!supabase || authProfileInitialized) return;
    authProfileInitialized = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      void upsertProfileForUser(session.user, nameOverride);
    });
    await ensureAuthProfile(nameOverride);
  },

  getProfile: async (): Promise<RealtorProfile> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('realtor_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('Failed to load profile', error);
      }
      if (data) {
        return { name: data.name, headshot: data.headshot };
      }
      return { name: DEFAULT_PROFILE_NAME };
    }

    // LocalStorage fallback.
    return loadObject<RealtorProfile>(STORAGE_KEYS.PROFILE) || { name: DEFAULT_PROFILE_NAME };
  },

  saveProfile: async (profile: RealtorProfile) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { error } = await supabase.from('realtor_profiles').upsert({
        user_id: userId,
        name: profile.name,
        headshot: profile.headshot ?? null,
      });
      if (error) {
        console.warn('Failed to save profile', error);
      }
      return;
    }

    // LocalStorage fallback.
    save(STORAGE_KEYS.PROFILE, profile);
  },

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
    const agentId = getAgentId();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && !userId) {
      console.warn('No authenticated user available for contact insert');
    }
    const payload: Contact = normalizeContact({
      id: uuid(),
      user_id: userId ?? agentId,
      full_name: data.full_name || 'Unknown',
      phone: data.phone || '',
      email: data.email || '',
      location_context: data.location_context || '',
      sale_date: data.sale_date,
      last_contacted_at: data.last_contacted_at,
      comfort_level: data.comfort_level || 'maybe',
      archived: false,
      created_at: new Date().toISOString(),
      radar_interests: data.radar_interests || [],
      family_details: data.family_details || { children: [], pets: [] },
      mortgage_inference: data.mortgage_inference,
      suggested_action: data.suggested_action,
    });

    if (supabase && userId) {
      // Supabase mode.
      const supabasePayload = { ...payload, user_id: userId };
      const { data: inserted, error } = await supabase
        .from('contacts')
        .insert(supabasePayload)
        .select()
        .single();
      if (error) {
        console.warn('Failed to add contact', error);
        return payload;
      }
      await supabase.from('radar_state').insert({
        contact_id: inserted.id,
        user_id: userId,
        reached_out: false,
        angles_used_json: [],
        last_refreshed_at: new Date().toISOString(),
      });
      return normalizeContact(inserted);
    }

    // LocalStorage fallback.
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    contacts.push(payload);
    save(STORAGE_KEYS.CONTACTS, contacts);

    const radarStates = load<RadarState>(STORAGE_KEYS.RADAR);
    radarStates.push(defaultRadarState(payload.id, agentId));
    save(STORAGE_KEYS.RADAR, radarStates);

    return payload;
  },

  addBrainDumpClients: async (clients: BrainDumpClient[]) => {
    for (const c of clients) {
      const contact = await dataService.addContact({
        full_name: c.names.join(' & '),
        location_context: c.location_context,
        sale_date: c.transaction_history.approx_year ? `${c.transaction_history.approx_year}-01-01` : undefined,
        radar_interests: c.radar_interests,
        family_details: c.family_details,
        mortgage_inference: c.mortgage_inference,
        suggested_action: c.suggested_action,
      });
      if (c.transaction_history.notes) {
        await dataService.addNote(contact.id, c.transaction_history.notes);
      }
    }
  },

  updateContact: async (id: string, data: Partial<Contact>) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { error } = await supabase
        .from('contacts')
        .update({ ...data, user_id: userId })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) {
        console.warn('Failed to update contact', error);
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

  getNotes: async (contactId: string): Promise<ContactNote[]> => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      // Supabase mode.
      const { data, error } = await supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', userId)
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
    const agentId = getAgentId();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && !userId) {
      console.warn('No authenticated user available for note insert');
    }
    const note: ContactNote = {
      id: uuid(),
      contact_id: contactId,
      user_id: userId ?? agentId,
      note_text: text,
      created_at: new Date().toISOString(),
    };

    if (supabase && userId) {
      // Supabase mode.
      const { error } = await supabase.from('contact_notes').insert({ ...note, user_id: userId });
      if (error) {
        console.warn('Failed to add note', error);
      }
      return;
    }

    // LocalStorage fallback.
    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    notes.push(note);
    save(STORAGE_KEYS.NOTES, notes);
  },

  updateNote: async (noteId: string, text: string) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
      const { error } = await supabase
        .from('contact_notes')
        .update({ note_text: text })
        .eq('id', noteId)
        .eq('user_id', userId);
      if (error) {
        console.warn('Failed to update note', error);
      }
      return;
    }

    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    const index = notes.findIndex(n => n.id === noteId);
    if (index !== -1) {
      notes[index] = { ...notes[index], note_text: text };
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
        .eq('id', noteId)
        .eq('user_id', userId);
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
      await supabase.from('radar_state').insert(fallback);
      return fallback;
    }

    // LocalStorage fallback.
    return load<RadarState>(STORAGE_KEYS.RADAR).find(r => r.contact_id === contactId) || null;
  },

  updateRadarState: async (contactId: string, data: Partial<RadarState>) => {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && userId) {
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
    const agentId = getAgentId();
    const userId = await getSupabaseUserId(supabase);
    if (supabase && !userId) {
      console.warn('No authenticated user available for touch insert');
    }
    const touch: Touch = {
      id: uuid(),
      contact_id: contactId,
      user_id: userId ?? agentId,
      type,
      channel: options?.channel,
      body: options?.body,
      source: options?.source,
      created_at: new Date().toISOString(),
    };

    if (supabase && userId) {
      // Supabase mode.
      const { error } = await supabase.from('touches').insert({ ...touch, user_id: userId });
      if (error) {
        console.warn('Failed to add touch', error);
      }
      await supabase
        .from('contacts')
        .update({ last_contacted_at: touch.created_at, user_id: userId })
        .eq('id', contactId)
        .eq('user_id', userId);
      return;
    }

    // LocalStorage fallback.
    const touches = load<Touch>(STORAGE_KEYS.TOUCHES);
    touches.push(touch);
    save(STORAGE_KEYS.TOUCHES, touches);
    await dataService.updateContact(contactId, { last_contacted_at: touch.created_at });
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

  getEligibleContacts: async (): Promise<Contact[]> => {
    const contacts = await dataService.getContacts();
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId(supabase);
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
        const state = radarStates.find(r => r.contact_id === contact.id);
        if (!state) return true;
        if (state.suppressed_until && new Date(state.suppressed_until) > today) return false;

        if (contact.suggested_action && !state.last_prompt_shown_at) return true;

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
        const lastContactDate = contact.last_contacted_at ? new Date(contact.last_contacted_at) : null;
        const saleDate = contact.sale_date ? new Date(contact.sale_date) : null;

        if (lastContactDate) {
          return lastContactDate <= threeMonthsAgo;
        }
        if (saleDate) {
          return saleDate <= threeMonthsAgo;
        }
        return true;
      })
      .sort((a, b) => {
        const aScore = (a.suggested_action ? 100 : 0) + a.radar_interests.length * 10;
        const bScore = (b.suggested_action ? 100 : 0) + b.radar_interests.length * 10;
        return bScore - aScore;
      });
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

  isSupabaseEnabled: () => isSupabaseConfigured(),
};
