
import { Contact, ContactNote, RadarState, ComfortLevel, RealtorProfile, BrainDumpClient } from '../types';

const STORAGE_KEYS = {
  CONTACTS: 'mort_contacts',
  NOTES: 'mort_notes',
  RADAR: 'mort_radar_state',
  USER: 'mort_user',
  PROFILE: 'mort_realtor_profile',
};

const MOCK_USER_ID = 'user_123';

const STORAGE_VERSION = 'v1';

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

export const dataService = {
  getProfile: (): RealtorProfile => {
    return loadObject<RealtorProfile>(STORAGE_KEYS.PROFILE) || { name: 'Agent' };
  },
  saveProfile: (profile: RealtorProfile) => {
    save(STORAGE_KEYS.PROFILE, profile);
  },

  getContacts: (): Contact[] => {
    return load<Contact>(STORAGE_KEYS.CONTACTS).filter(c => !c.archived);
  },

  getContactById: (id: string): Contact | undefined => {
    return load<Contact>(STORAGE_KEYS.CONTACTS).find(c => c.id === id);
  },

  addContact: (data: Partial<Contact>): Contact => {
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    const newContact: Contact = {
      id: uuid(),
      user_id: MOCK_USER_ID,
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
    };
    contacts.push(newContact);
    save(STORAGE_KEYS.CONTACTS, contacts);
    
    const radarStates = load<RadarState>(STORAGE_KEYS.RADAR);
    radarStates.push({
      id: uuid(),
      contact_id: newContact.id,
      user_id: MOCK_USER_ID,
      reached_out: false,
      angles_used_json: [],
      last_refreshed_at: new Date().toISOString()
    } as any);
    save(STORAGE_KEYS.RADAR, radarStates);

    return newContact;
  },

  addBrainDumpClients: (clients: BrainDumpClient[]) => {
    clients.forEach(c => {
      const contact = dataService.addContact({
        full_name: c.names.join(' & '),
        location_context: c.location_context,
        sale_date: c.transaction_history.approx_year ? `${c.transaction_history.approx_year}-01-01` : undefined,
        radar_interests: c.radar_interests,
        family_details: c.family_details,
        mortgage_inference: c.mortgage_inference,
        suggested_action: c.suggested_action,
      });
      if (c.transaction_history.notes) {
        dataService.addNote(contact.id, c.transaction_history.notes);
      }
    });
  },

  updateContact: (id: string, data: Partial<Contact>) => {
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    const index = contacts.findIndex(c => c.id === id);
    if (index !== -1) {
      contacts[index] = { ...contacts[index], ...data };
      save(STORAGE_KEYS.CONTACTS, contacts);
    }
  },

  getNotes: (contactId: string): ContactNote[] => {
    return load<ContactNote>(STORAGE_KEYS.NOTES).filter(n => n.contact_id === contactId);
  },

  addNote: (contactId: string, text: string) => {
    const notes = load<ContactNote>(STORAGE_KEYS.NOTES);
    notes.push({
      id: uuid(),
      contact_id: contactId,
      user_id: MOCK_USER_ID,
      note_text: text,
      created_at: new Date().toISOString(),
    });
    save(STORAGE_KEYS.NOTES, notes);
  },

  getRadarState: (contactId: string): RadarState | undefined => {
    return load<RadarState>(STORAGE_KEYS.RADAR).find(r => r.contact_id === contactId);
  },

  updateRadarState: (contactId: string, data: Partial<RadarState>) => {
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

  getEligibleContacts: (): Contact[] => {
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    const radarStates = load<RadarState>(STORAGE_KEYS.RADAR);
    const today = new Date();
    
    return contacts.filter(c => {
      if (c.archived) return false;
      const state = radarStates.find(r => r.contact_id === c.id);
      if (!state) return false;
      if (state.reached_out) return false;

      if (state.suppressed_until && new Date(state.suppressed_until) > today) return false;

      // New logic: If they have a suggested action from a fresh brain dump, prioritize them
      if (c.suggested_action && !state.last_prompt_shown_at) return true;

      const threeMonthsAgo = new Date();
      threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
      const lastContactDate = c.last_contacted_at ? new Date(c.last_contacted_at) : null;
      const saleDate = c.sale_date ? new Date(c.sale_date) : null;

      let isTimeEligible = false;
      if (lastContactDate) {
        isTimeEligible = lastContactDate <= threeMonthsAgo;
      } else if (saleDate) {
        isTimeEligible = saleDate <= threeMonthsAgo;
      } else {
        isTimeEligible = true; // New entries are immediately eligible
      }

      return isTimeEligible;
    }).sort((a, b) => {
        // Boost contacts with suggested actions or rich interest data
        const aScore = (a.suggested_action ? 100 : 0) + (a.radar_interests.length * 10);
        const bScore = (b.suggested_action ? 100 : 0) + (b.radar_interests.length * 10);
        return bScore - aScore;
    });
  },
  
  bulkImport: (rows: any[]) => {
    rows.forEach(row => {
        dataService.addContact({
            full_name: row['Name'] || row['Full Name'] || row['name'] || 'Unknown',
            phone: row['Phone'] || row['phone'] || row['Mobile'] || '',
            email: row['Email'] || row['email'] || '',
            sale_date: row['Sale Date'] || row['Closing Date'] || undefined,
            last_contacted_at: row['Last Contacted'] || undefined,
        });
    });
  },

  getStats: () => {
    const contacts = load<Contact>(STORAGE_KEYS.CONTACTS);
    const total = contacts.length;
    const withInterests = contacts.filter(c => c.radar_interests.length > 0).length;
    const percent = total === 0 ? 0 : Math.round((withInterests / total) * 100);
    return { total, withInterests, percent };
  }
};
