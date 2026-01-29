
import React, { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { HashRouter, Routes, Route, Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import RadarCard from './components/RadarCard';
import MortgageAssist from './components/MortgageAssist';
import CommuteMode from './components/CommuteMode';
import AuthPanel from './components/AuthPanel';
import { dataService } from './services/dataService';
import { getSupabaseClient } from './services/supabaseClient';
import { formatShortDate, getNextTouchDate, getNextTouchStatus } from './utils/cadence';
import { UI_LABELS } from './utils/uiLabels';
import {
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
} from './types';

const DEFAULT_CADENCE_DAYS = 90;
const DEFAULT_PROFILE: RealtorProfile = {
  name: 'Agent',
  cadence_type: 'quarterly',
  cadence_custom_days: DEFAULT_CADENCE_DAYS,
};

const getCadenceDays = (profile?: RealtorProfile) => {
  const cadenceType = profile?.cadence_type ?? DEFAULT_PROFILE.cadence_type;
  if (cadenceType === 'weekly') return 7;
  if (cadenceType === 'monthly') return 30;
  if (cadenceType === 'custom') {
    const customDays = profile?.cadence_custom_days ?? DEFAULT_CADENCE_DAYS;
    return customDays > 0 ? customDays : DEFAULT_CADENCE_DAYS;
  }
  return DEFAULT_CADENCE_DAYS;
};

const getCadenceLabel = (profile?: RealtorProfile, cadenceDays?: number) => {
  const cadenceType = profile?.cadence_type ?? DEFAULT_PROFILE.cadence_type;
  if (cadenceType === 'weekly') return 'Weekly';
  if (cadenceType === 'monthly') return 'Monthly';
  if (cadenceType === 'custom') {
    const days = cadenceDays ?? getCadenceDays(profile);
    return `Custom (${days} days)`;
  }
  return 'Quarterly';
};

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const area = digits.slice(0, 3);
  const middle = digits.slice(3, 6);
  const last = digits.slice(6, 10);
  const extra = digits.slice(10);

  if (digits.length <= 3) {
    return `(${area}`;
  }
  if (digits.length <= 6) {
    return `(${area}) ${middle}`;
  }
  const base = `(${area}) ${middle}-${last}`;
  return extra ? `${base} ${extra}` : base;
};

const normalizePhone = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
};

const PLAYBOOKS = [
  {
    id: 'anniversary',
    title: 'Home anniversary check-in',
    body: 'Hey [Name], just realized it’s been about a year since you moved in. How’s everything settling in? Happy to help with anything you need.',
  },
  {
    id: 'referral-thanks',
    title: 'Referral thank-you',
    body: 'Thanks again for connecting me with [Referral Name]. I appreciate you, and I’ll take great care of them.',
  },
  {
    id: 'market-update',
    title: 'Soft market update',
    body: 'Hey [Name], quick note — I’m seeing some interesting shifts in [Area]. If you ever want a quick snapshot for your home, I’m happy to help.',
  },
  {
    id: 'check-in',
    title: 'Light touch check-in',
    body: 'Hi [Name], you popped into my head today. Hope you’re doing great. Happy to help if you need anything.',
  },
];

const PlaybookPanel: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPlaybooks, setShowPlaybooks] = useState(false);

  const handleCopy = async (content: string, id: string) => {
    setError(null);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      setError('Copy failed. Select the text and copy manually.');
    }
  };

  return (
    <>
      <div className="bg-surface border border-border rounded-[2.5rem] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Playbooks</p>
            <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">Copy-ready scripts</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowPlaybooks(true)}
            className="text-xs font-black uppercase tracking-[0.2em] text-primary border border-primary/40 px-4 py-2 rounded-full hover:bg-secondary transition-colors"
          >
            View scripts
          </button>
        </div>
      </div>
      {showPlaybooks && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center px-4 pb-12 sm:items-center sm:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPlaybooks(false)}></div>
          <div className="relative bg-surface border border-border w-full max-w-2xl rounded-[2.5rem] p-8 space-y-6 shadow-2xl animate-in fade-in slide-in-from-bottom-10 duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Playbooks</p>
                <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">Copy-ready scripts</h3>
              </div>
              <button
                onClick={() => setShowPlaybooks(false)}
                className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition"
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-2">
              {PLAYBOOKS.map(playbook => (
                <div key={playbook.id} className="bg-muted border border-border rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-black uppercase tracking-widest text-foreground">{playbook.title}</p>
                    <button
                      type="button"
                      onClick={() => handleCopy(playbook.body, playbook.id)}
                      className="text-xs font-black uppercase tracking-[0.2em] text-success hover:text-success/80 transition"
                    >
                      {copiedId === playbook.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-line">{playbook.body}</p>
                </div>
              ))}
            </div>
            {error && <p className="text-xs font-semibold text-amber-600">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
};

const Dashboard: React.FC = () => {
  const [radarItems, setRadarItems] = useState<Array<{ contact: Contact; notes: ContactNote[]; state: RadarState }>>([]);
  const [stats, setStats] = useState({ total: 0, withInterests: 0, percent: 0 });
  const [contactsCount, setContactsCount] = useState(0);
  const [sampleSeeded, setSampleSeeded] = useState(dataService.hasSeededSampleContacts());
  const [sampleSeeding, setSampleSeeding] = useState(false);
  const [dueThisWeekCount, setDueThisWeekCount] = useState(0);
  const [cadenceDays, setCadenceDays] = useState(DEFAULT_CADENCE_DAYS);
  const [cadenceLabel, setCadenceLabel] = useState(getCadenceLabel(DEFAULT_PROFILE));
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [runNowOpportunities, setRunNowOpportunities] = useState<Opportunity[]>([]);
  const [runNowLoading, setRunNowLoading] = useState(false);
  const [runNowError, setRunNowError] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  useEffect(() => {
    void refreshRadar();
  }, []);

  const refreshRadar = async () => {
    const profile = await dataService.getProfile();
    const cadenceDaysValue = getCadenceDays(profile);
    setCadenceDays(cadenceDaysValue);
    setCadenceLabel(getCadenceLabel(profile, cadenceDaysValue));
    const [eligible, contacts, radarStates] = await Promise.all([
      dataService.getEligibleContacts(),
      dataService.getContacts(),
      dataService.getRadarStates(),
    ]);
    setContactsCount(contacts.length);
    setSampleSeeded(dataService.hasSeededSampleContacts());
    const limitedEligible = eligible.slice(0, 5);
    const items = await Promise.all(
      limitedEligible.map(async contact => {
        const [notes, state] = await Promise.all([
          dataService.getNotes(contact.id),
          dataService.getRadarState(contact.id),
        ]);
        return {
          contact,
          notes,
          state: state ?? {
            id: crypto.randomUUID(),
            contact_id: contact.id,
            user_id: contact.user_id,
            reached_out: false,
            angles_used_json: [],
          },
        };
      })
    );
    setRadarItems(items);
    const today = new Date();
    const endOfWeek = new Date();
    endOfWeek.setDate(today.getDate() + 7);
    const dueThisWeek = contacts.filter(contact => {
      if (contact.archived) return false;
      const state = radarStates.find(r => r.contact_id === contact.id);
      if (state?.suppressed_until && new Date(state.suppressed_until) > endOfWeek) return false;
      if (contact.suggested_action && !state?.last_prompt_shown_at) return true;

      const baseDateValue = contact.last_contacted_at || contact.sale_date;
      if (!baseDateValue) return true;
      const baseDate = new Date(baseDateValue);
      if (Number.isNaN(baseDate.getTime())) return true;
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + cadenceDaysValue);
      return dueDate <= endOfWeek;
    }).length;
    setDueThisWeekCount(dueThisWeek);
    const latestStats = await dataService.getStats();
    setStats(latestStats);
  };

  const handleReachedOut = async (contactId: string) => {
    const suppressUntil = new Date();
    suppressUntil.setDate(suppressUntil.getDate() + cadenceDays);
    await dataService.updateRadarState(contactId, {
      reached_out: true,
      reached_out_at: new Date().toISOString(),
      suppressed_until: suppressUntil.toISOString().split('T')[0]
    });
    await refreshRadar();
  };

  const handleDismiss = async (contactId: string) => {
    const suppressUntil = new Date();
    suppressUntil.setDate(suppressUntil.getDate() + cadenceDays);
    await dataService.updateRadarState(contactId, {
      suppressed_until: suppressUntil.toISOString().split('T')[0]
    });
    await refreshRadar();
  };

  const handleRunNow = async () => {
    setRunNowLoading(true);
    setRunNowError(null);
    const opportunities = await dataService.runNowOpportunities();
    setRunNowOpportunities(opportunities);
    const defaults: Record<string, string> = {};
    opportunities.forEach(opportunity => {
      if (opportunity.suggested_messages?.length) {
        defaults[opportunity.id] = opportunity.suggested_messages[0];
      }
    });
    setSelectedMessages(defaults);
    if (opportunities.length === 0) {
      setRunNowError('No opportunities yet. Add more contacts.');
    }
    setRunNowLoading(false);
  };

  const handleCopyMessage = async (message: string) => {
    if (!message) return;
    await navigator.clipboard.writeText(message);
  };

  const handleMarkContacted = async (contactId: string, message: string) => {
    await dataService.addTouch(contactId, 'reach_out', { channel: 'sms', body: message, source: 'run_now' });
  };

  const handleSeedSampleContacts = async () => {
    setSampleSeeding(true);
    await dataService.seedSampleContacts();
    setSampleSeeding(false);
    setSampleSeeded(dataService.hasSeededSampleContacts());
    await refreshRadar();
  };

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      {/* Selection Modal */}
      {showAddMenu && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center px-4 pb-12 sm:items-center sm:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddMenu(false)}></div>
          <div className="relative bg-surface border border-border w-full max-w-sm rounded-[2.5rem] p-8 space-y-4 shadow-2xl animate-in fade-in slide-in-from-bottom-10 duration-300">
            <div className="text-center mb-6">
              <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">Add Contact</h3>
              <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest mt-1">Choose your entry mode</p>
            </div>
            <button 
              onClick={() => { navigate('/commute'); setShowAddMenu(false); }} 
              className="w-full bg-primary p-6 rounded-3xl flex items-center gap-4 group hover:scale-[1.02] transition-transform shadow-xl text-white"
            >
               <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-white">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
               </div>
               <div className="text-left">
                  <p className="text-white font-black uppercase text-xs tracking-widest">{UI_LABELS.ingestion}</p>
                  <p className="text-white/70 text-xs font-bold">Fast voice memo capture</p>
               </div>
            </button>
            <button 
              onClick={() => { navigate('/contacts/add'); setShowAddMenu(false); }} 
              className="w-full bg-muted border border-border p-6 rounded-3xl flex items-center gap-4 group hover:bg-secondary/60 transition-colors shadow-lg"
            >
               <div className="w-12 h-12 bg-secondary rounded-2xl flex items-center justify-center text-foreground">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
               </div>
               <div className="text-left">
                  <p className="text-foreground font-black uppercase text-xs tracking-widest">Manual Entry</p>
                  <p className="text-muted-foreground text-xs font-bold">Text & details</p>
               </div>
            </button>
            <button onClick={() => setShowAddMenu(false)} className="w-full text-muted-foreground font-black uppercase text-xs tracking-[0.2em] pt-4">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-[2.5rem] p-6 mb-8 flex items-center justify-between shadow-2xl">
          <div className="flex-1">
            <h4 className="text-xs font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">{UI_LABELS.radar} Coverage</h4>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${stats.percent}%` }}></div>
              </div>
              <span className="text-xl font-black text-foreground">{stats.percent}%</span>
            </div>
          </div>
          <button 
            onClick={() => setShowAddMenu(true)}
            className="ml-6 w-14 h-14 bg-primary rounded-2xl flex items-center justify-center text-white shadow-[0_12px_24px_rgba(37,99,235,0.3)] active:scale-95 transition-transform"
          >
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
      </div>

      <div className="flex justify-between items-center mb-6 px-2">
          <div>
            <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter">This week&apos;s opportunities</h1>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{UI_LABELS.cadence}: {cadenceLabel}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRunNow}
              disabled={runNowLoading}
              className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full border border-primary/40 text-primary hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {runNowLoading ? 'Running…' : 'Run Now'}
            </button>
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{dueThisWeekCount} Due</span>
          </div>
      </div>

      {runNowError && (
        <div className="mx-2 mb-6 text-xs text-amber-600 font-bold uppercase tracking-widest">
          {runNowError}
        </div>
      )}

      {runNowOpportunities.length > 0 && (
        <div className="space-y-4 mb-10">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-black text-foreground uppercase tracking-widest">Run Now Opportunities</h2>
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              {runNowOpportunities.length} Returned
            </span>
          </div>
          {runNowOpportunities.map(opportunity => {
            const selectedMessage = selectedMessages[opportunity.id] || opportunity.suggested_messages?.[0] || '';
            const daysSince =
              typeof opportunity.days_since_last_touch === 'number'
                ? opportunity.days_since_last_touch
                : opportunity.last_touch_at
                  ? Math.floor((Date.now() - new Date(opportunity.last_touch_at).getTime()) / (1000 * 60 * 60 * 24))
                  : undefined;
            const cadenceDaysValue = opportunity.cadence_days ?? cadenceDays;
            return (
              <div key={opportunity.id} className="bg-surface border border-border rounded-3xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-foreground font-black text-lg">{opportunity.contact_full_name ?? 'Contact'}</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Score {opportunity.score}</p>
                  </div>
                  <button
                    onClick={() => handleMarkContacted(opportunity.contact_id, selectedMessage)}
                    className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full bg-success/10 text-success border border-success/30"
                  >
                    Mark as contacted
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {typeof daysSince === 'number' && (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-muted text-muted-foreground">
                      Touched {daysSince} days ago
                    </span>
                  )}
                  {opportunity.year_cap_exceeded && (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      Exceeds 4/year
                    </span>
                  )}
                  {opportunity.cadence_violation && (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                      Inside plan (set to {cadenceDaysValue} days)
                    </span>
                  )}
                </div>
                {opportunity.reasons?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Why now</p>
                    <div className="flex flex-wrap gap-2">
                      {opportunity.reasons.map(reason => (
                        <span
                          key={`${opportunity.id}-${reason}`}
                          className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-muted text-muted-foreground border border-border"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  <select
                    value={selectedMessage}
                    onChange={event =>
                      setSelectedMessages(prev => ({
                        ...prev,
                        [opportunity.id]: event.target.value,
                      }))
                    }
                    className="w-full bg-muted border border-border rounded-2xl text-sm text-foreground p-3"
                  >
                    {opportunity.suggested_messages?.map((message, index) => (
                      <option key={`${opportunity.id}-message-${index}`} value={message}>
                        {message.length > 80 ? `${message.slice(0, 80)}...` : message}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleCopyMessage(selectedMessage)}
                      className="flex-1 bg-primary text-white text-xs font-black uppercase tracking-widest py-3 rounded-2xl"
                    >
                      Copy message
                    </button>
                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      {opportunity.suggested_messages?.length ?? 0} variants
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-10">
        <PlaybookPanel />
      </div>
      
      {radarItems.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="relative w-40 h-40 mx-auto mb-10">
            <div className="absolute inset-0 border-2 border-border rounded-full"></div>
            <div className="absolute inset-0 border-t-2 border-primary rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </div>
          </div>
          <h3 className="text-2xl font-black text-foreground mb-3">{UI_LABELS.radar} Empty</h3>
          <p className="text-muted-foreground mb-6 max-w-xs mx-auto text-sm leading-relaxed font-medium">Start adding some clients so I can get to work for you!</p>
          <ol className="space-y-2 text-xs font-bold uppercase tracking-widest text-muted-foreground mb-8">
            <li className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs">1</span>
              Add contacts
            </li>
            <li className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs">2</span>
              Set {UI_LABELS.cadence.toLowerCase()}
            </li>
            <li className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs">3</span>
              Get next-touch prompts
            </li>
          </ol>
          <div className="flex flex-col items-center gap-3">
            <button 
              onClick={() => setShowAddMenu(true)} 
              className="bg-primary text-white font-black uppercase tracking-[0.2em] py-4 px-12 rounded-full transition-all shadow-xl active:scale-95"
            >
              Add Contact
            </button>
            {contactsCount === 0 && !sampleSeeded && (
              <button
                onClick={handleSeedSampleContacts}
                disabled={sampleSeeding}
                className="text-xs font-black uppercase tracking-widest px-6 py-2 rounded-full border border-success/40 text-success hover:bg-secondary transition-colors disabled:opacity-50"
              >
                {sampleSeeding ? 'Seeding sample data…' : 'Try with sample data'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {radarItems.map(({ contact, notes, state }) => {
            return (
              <RadarCard 
                key={contact.id}
                contact={contact}
                notes={notes}
                state={state}
                onReachedOut={() => handleReachedOut(contact.id)}
                onDismiss={() => handleDismiss(contact.id)}
              />
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => navigate('/commute')}
        className="fixed bottom-24 right-6 z-50 h-14 w-14 rounded-full bg-primary text-white shadow-[0_12px_24px_rgba(37,99,235,0.35)] flex items-center justify-center active:scale-95 transition-transform"
        aria-label={`Start ${UI_LABELS.ingestion}`}
      >
        <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>
    </div>
  );
};

const DailyActions: React.FC = () => {
  const [radarContacts, setRadarContacts] = useState<Contact[]>([]);
  const [referralEvents, setReferralEvents] = useState<ReferralEvent[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [topSources, setTopSources] = useState<
    Array<{ contact: Contact; total: number; won: number; active: number; score: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [referralContactId, setReferralContactId] = useState('');
  const [referralName, setReferralName] = useState('');
  const [referralStage, setReferralStage] = useState<ReferralStage>('intro');
  const [referralSaving, setReferralSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [eligibleContacts, referrals, contacts] = await Promise.all([
      dataService.getEligibleContacts(),
      dataService.getReferralEvents(),
      dataService.getContacts(),
    ]);

    const scoredSources = await Promise.all(
      contacts.map(async contact => {
        const score = await dataService.getReferralSourceScore(contact.id);
        return { contact, ...score };
      })
    );

    setRadarContacts(eligibleContacts.slice(0, 6));
    setReferralEvents(referrals.filter(event => event.status === 'active').slice(0, 6));
    setAllContacts(contacts);
    setTopSources(
      scoredSources
        .filter(source => source.total > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
    );
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!referralContactId && allContacts.length > 0) {
      setReferralContactId(allContacts[0].id);
    }
  }, [allContacts, referralContactId]);

  const stageLabel = (stage: ReferralStage) =>
    stage
      .split('_')
      .map(word => word[0]?.toUpperCase() + word.slice(1))
      .join(' ');

  const handleAddReferral = async () => {
    const trimmedName = referralName.trim();
    if (!referralContactId || !trimmedName) return;
    setReferralSaving(true);
    await dataService.addReferralEvent({
      sourceContactId: referralContactId,
      referredName: trimmedName,
      stage: referralStage,
    });
    setReferralName('');
    setReferralStage('intro');
    setShowReferralModal(false);
    setReferralSaving(false);
    await loadData();
  };

  if (loading) {
    return (
      <div className="p-8 text-muted-foreground font-semibold">Loading daily actions...</div>
    );
  }

  return (
    <div className="px-6 pb-24 space-y-8">
      <header className="pt-8">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Daily Actions</p>
        <h1 className="text-3xl font-black text-foreground uppercase tracking-tighter">Focus list</h1>
        <p className="text-sm text-muted-foreground mt-2">High-value touches and referrals to move today.</p>
      </header>

      <section className="bg-surface border border-border rounded-[2.5rem] p-6 shadow-2xl space-y-4">
        <h2 className="text-lg font-black text-foreground uppercase tracking-widest">{UI_LABELS.radar} follow-ups</h2>
        {radarContacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {UI_LABELS.radar.toLowerCase()} follow-ups due right now.</p>
        ) : (
          <ul className="space-y-3">
            {radarContacts.map(contact => (
              <li key={contact.id}>
                <Link
                  to={`/contacts/${contact.id}`}
                  className="flex items-center justify-between bg-muted border border-border rounded-2xl px-4 py-3 transition-all hover:bg-secondary/60 active:scale-[0.99]"
                >
                  <div>
                    <p className="text-sm font-bold text-foreground">{contact.full_name}</p>
                    <p className="text-xs text-muted-foreground">{contact.radar_interests[0] || 'No interest noted'}</p>
                  </div>
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-primary">View</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface border border-border rounded-[2.5rem] p-6 shadow-2xl space-y-4">
        <h2 className="text-lg font-black text-foreground uppercase tracking-widest">Active referrals</h2>
        {referralEvents.length === 0 ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>No active referrals. Add your first one.</p>
            <button
              type="button"
              onClick={() => setShowReferralModal(true)}
              className="inline-flex items-center justify-center rounded-full border border-primary/40 px-4 py-2 text-xs font-black uppercase tracking-widest text-primary hover:bg-secondary"
            >
              Add referral
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {referralEvents.map(event => (
              <li key={event.id} className="bg-muted border border-border rounded-2xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-foreground">{event.referred_name}</p>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-success">
                    {stageLabel(event.stage)}
                  </span>
                </div>
                {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface border border-border rounded-[2.5rem] p-6 shadow-2xl space-y-4">
        <h2 className="text-lg font-black text-foreground uppercase tracking-widest">Top referral sources</h2>
        {topSources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No referral sources scored yet.</p>
        ) : (
          <ul className="space-y-3">
            {topSources.map(source => (
              <li key={source.contact.id} className="flex items-center justify-between bg-muted border border-border rounded-2xl px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-foreground">{source.contact.full_name}</p>
                  <p className="text-xs text-muted-foreground">{source.won} won · {source.active} active</p>
                </div>
                <span className="text-sm font-black text-foreground">Score {source.score}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {showReferralModal && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center px-4 pb-12 sm:items-center sm:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowReferralModal(false)}></div>
          <div className="relative bg-surface border border-border w-full max-w-md rounded-[2.5rem] p-8 space-y-4 shadow-2xl">
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Add referral</p>
              <h3 className="text-xl font-black text-foreground uppercase tracking-tighter mt-2">Create a new referral</h3>
            </div>
            <div className="space-y-4">
              <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Referral source</label>
              <select
                value={referralContactId}
                onChange={event => setReferralContactId(event.target.value)}
                className="w-full bg-muted border border-border rounded-2xl px-4 py-3 text-sm text-foreground"
              >
                {allContacts.map(contact => (
                  <option key={contact.id} value={contact.id}>
                    {contact.full_name}
                  </option>
                ))}
              </select>
              <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Referred client</label>
              <input
                type="text"
                value={referralName}
                onChange={event => setReferralName(event.target.value)}
                className="w-full bg-muted border border-border rounded-2xl px-4 py-3 text-sm text-foreground"
                placeholder="Client name"
              />
              <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Stage</label>
              <select
                value={referralStage}
                onChange={event => setReferralStage(event.target.value as ReferralStage)}
                className="w-full bg-muted border border-border rounded-2xl px-4 py-3 text-sm text-foreground"
              >
                {(['intro', 'engaged', 'showing', 'under_contract', 'closed', 'lost'] as ReferralStage[]).map(stage => (
                  <option key={stage} value={stage}>
                    {stage.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowReferralModal(false)}
                className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddReferral}
                disabled={!referralContactId || !referralName.trim() || referralSaving}
                className="rounded-full bg-primary px-6 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
              >
                {referralSaving ? 'Saving…' : 'Add referral'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ContactDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [contact, setContact] = useState<Contact | null>(null);
    const [touches, setTouches] = useState<Touch[]>([]);
    const [notes, setNotes] = useState<ContactNote[]>([]);
    const [noteDraft, setNoteDraft] = useState('');
    const [touchSummary, setTouchSummary] = useState<{ yearCount: number; quarterCount: number; lastTouch?: string | null }>({
        yearCount: 0,
        quarterCount: 0,
        lastTouch: null
    });
    const [referralEvents, setReferralEvents] = useState<ReferralEvent[]>([]);
    const [referralScore, setReferralScore] = useState({ total: 0, won: 0, active: 0, score: 0 });
    const [referralName, setReferralName] = useState('');
    const [referralStage, setReferralStage] = useState<ReferralStage>('intro');
    const [referralNotes, setReferralNotes] = useState('');
    const [profileCadenceDays, setProfileCadenceDays] = useState(DEFAULT_CADENCE_DAYS);
    const [cadenceSelection, setCadenceSelection] = useState<number>(DEFAULT_CADENCE_DAYS);
    const [customCadence, setCustomCadence] = useState<string>('');

    useEffect(() => {
        if (!id) return;
        void (async () => {
            const data = await dataService.getContactById(id);
            if (data) setContact(data);
            await refreshActivity(id);
        })();
    }, [id]);

    useEffect(() => {
        void (async () => {
            const profile = await dataService.getProfile();
            const cadenceDaysValue = getCadenceDays(profile);
            setProfileCadenceDays(cadenceDaysValue);
        })();
    }, []);

    useEffect(() => {
        if (!contact) return;
        setCadenceSelection(contact.cadence_days ?? DEFAULT_CADENCE_DAYS);
        setCustomCadence('');
    }, [contact]);

    if (!contact) return null;

    const nextTouchDate = getNextTouchDate(contact);
    const nextTouchStatus = getNextTouchStatus(nextTouchDate);
    const nextTouchBadgeStyles = {
        overdue: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        due: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        upcoming: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    }[nextTouchStatus];
    const nextTouchBadgeLabel = {
        overdue: 'Overdue',
        due: 'Due',
        upcoming: 'Upcoming',
    }[nextTouchStatus];

    const DetailRow = ({ label, value, icon }: { label: string, value?: string, icon: React.ReactNode }) => (
        <div className="flex items-start gap-4 p-4 bg-surface border border-border rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
                {icon}
            </div>
            <div>
                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                <p className="text-foreground font-bold">{value || 'Not provided'}</p>
            </div>
        </div>
    );

    const logTouch = async (type: TouchType) => {
        await dataService.addTouch(contact.id, type, { source: 'manual' });
        await refreshActivity(contact.id);
    };

    const handleCadenceUpdate = async (nextDays: number, mode: 'AUTO' | 'MANUAL') => {
        const sanitizedDays = Math.max(1, Math.round(nextDays));
        await dataService.updateContact(contact.id, { cadence_days: sanitizedDays, cadence_mode: mode });
        setContact(prev => (prev ? { ...prev, cadence_days: sanitizedDays, cadence_mode: mode } : prev));
        setCadenceSelection(sanitizedDays);
    };

    const toggleContactFlag = async (field: 'safe_mode' | 'do_not_contact', value: boolean) => {
        await dataService.updateContact(contact.id, { [field]: value } as Partial<Contact>);
        setContact(prev => (prev ? { ...prev, [field]: value } : prev));
    };

    const refreshActivity = async (contactId: string) => {
        const [contactTouches, contactNotes, summary, referrals, score] = await Promise.all([
            dataService.getTouches(contactId),
            dataService.getNotes(contactId),
            dataService.getTouchSummary(contactId),
            dataService.getReferralEventsBySource(contactId),
            dataService.getReferralSourceScore(contactId),
        ]);
        setTouches(contactTouches);
        setNotes(contactNotes);
        setTouchSummary({ ...summary, lastTouch: summary.lastTouch || null });
        setReferralEvents(referrals);
        setReferralScore(score);
    };

    const handleAddNote = async () => {
        const trimmed = noteDraft.trim();
        if (!trimmed) return;
        await dataService.addNote(contact.id, trimmed);
        setNoteDraft('');
        await refreshActivity(contact.id);
    };

    const handleAddReferral = async () => {
        const trimmedName = referralName.trim();
        if (!trimmedName) return;
        await dataService.addReferralEvent({
            sourceContactId: contact.id,
            referredName: trimmedName,
            stage: referralStage,
            notes: referralNotes.trim() || undefined,
        });
        setReferralName('');
        setReferralStage('intro');
        setReferralNotes('');
        await refreshActivity(contact.id);
    };

    const handleUpdateReferral = async (eventId: string, updates: Partial<ReferralEvent>) => {
        await dataService.updateReferralEvent(eventId, updates);
        await refreshActivity(contact.id);
    };

    const timelineItems = [
        ...touches.map(touch => ({
            id: `touch-${touch.id}`,
            type: 'touch' as const,
            created_at: touch.created_at,
            label: touch.type,
            detail: touch.body || touch.channel || touch.source || 'Logged touch',
        })),
        ...notes.map(note => ({
            id: `note-${note.id}`,
            type: 'note' as const,
            created_at: note.created_at,
            label: 'Note',
            detail: note.body,
        })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return (
        <div className="max-w-md mx-auto p-6 space-y-8 pb-32">
            <div className="flex items-center justify-between mb-4">
                <button onClick={() => navigate('/contacts')} className="p-2 text-muted-foreground hover:text-foreground">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                </button>
                <button onClick={() => navigate(`/contacts/edit/${contact.id}`)} className="text-primary text-xs font-black uppercase tracking-widest border border-primary/30 px-6 py-2 rounded-full hover:bg-secondary">
                    Edit
                </button>
            </div>

            <div className="text-center space-y-4 mb-8">
                <div className="w-24 h-24 bg-primary rounded-[2rem] flex items-center justify-center text-white font-black text-4xl mx-auto border border-border shadow-2xl">
                    {contact.full_name.charAt(0)}
                </div>
                <h1 className="text-3xl font-black text-foreground uppercase tracking-tighter">{contact.full_name}</h1>
                {contact.mortgage_inference && (
                    <span className="inline-block bg-secondary text-foreground text-xs font-black px-4 py-1 rounded-full uppercase tracking-widest border border-primary/20">
                        {contact.mortgage_inference.opportunity_tag}
                    </span>
                )}
            </div>

            <div className="space-y-4">
                <DetailRow 
                    label="Email" 
                    value={contact.email} 
                    icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>}
                />
                <DetailRow 
                    label="Phone" 
                    value={formatPhone(contact.phone || '')} 
                    icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>}
                />
                <div className="p-6 bg-surface border border-border rounded-3xl space-y-4">
                    <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{UI_LABELS.radar} Interests</p>
                    <div className="flex flex-wrap gap-2">
                        {contact.radar_interests.length > 0 ? (
                            contact.radar_interests.map((interest, i) => (
                                <span key={i} className="bg-muted border border-border px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground">
                                    {interest}
                                </span>
                            ))
                        ) : (
                            <p className="text-muted-foreground text-xs italic">No interests recorded yet.</p>
                        )}
                    </div>
                </div>
                {contact.mortgage_inference && (
                    <div className="p-6 bg-secondary/60 border border-secondary rounded-3xl space-y-3">
                        <p className="text-xs font-black uppercase tracking-widest text-foreground">Mortgage Inference</p>
                        <p className="text-foreground font-bold text-sm leading-relaxed">{contact.mortgage_inference.reasoning}</p>
                    </div>
                )}
                <div className="p-6 bg-surface border border-border rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{UI_LABELS.cadence}</p>
                        <span className="text-xs font-black uppercase tracking-widest text-success">
                            {touchSummary.quarterCount >= 1 ? 'On Track' : 'Due This Quarter'}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">This Q</p>
                            <p className="text-xl font-black text-foreground">{touchSummary.quarterCount}</p>
                        </div>
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">This Year</p>
                            <p className="text-xl font-black text-foreground">{touchSummary.yearCount}</p>
                        </div>
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Last Touch</p>
                            <p className="text-xs font-bold text-foreground">
                                {touchSummary.lastTouch ? new Date(touchSummary.lastTouch).toLocaleDateString() : 'None'}
                            </p>
                        </div>
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Next Touch</p>
                            <p className="text-xs font-bold text-foreground">{formatShortDate(nextTouchDate)}</p>
                            <span className={`mt-2 inline-block text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border ${nextTouchBadgeStyles}`}>
                                {nextTouchBadgeLabel}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => logTouch('call')} className="py-2 rounded-xl bg-muted text-muted-foreground text-xs font-black uppercase tracking-widest border border-border">
                            Called
                        </button>
                        <button onClick={() => logTouch('text')} className="py-2 rounded-xl bg-muted text-muted-foreground text-xs font-black uppercase tracking-widest border border-border">
                            Texted
                        </button>
                        <button onClick={() => logTouch('email')} className="py-2 rounded-xl bg-muted text-muted-foreground text-xs font-black uppercase tracking-widest border border-border">
                            Emailed
                        </button>
                    </div>
                </div>
                <div className="p-6 bg-surface border border-border rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{UI_LABELS.cadence} Settings</p>
                        <button
                            onClick={() => handleCadenceUpdate(profileCadenceDays, 'AUTO')}
                            className="text-xs font-black uppercase tracking-widest text-primary border border-primary/30 px-3 py-1 rounded-full hover:bg-secondary"
                        >
                            Use profile {UI_LABELS.cadence.toLowerCase()}
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[30, 60, 90, 120, 180].map(option => (
                            <button
                                key={`cadence-${option}`}
                                onClick={() => handleCadenceUpdate(option, 'MANUAL')}
                                className={`px-3 py-2 rounded-full text-xs font-black uppercase tracking-widest border ${
                                    cadenceSelection === option
                                        ? 'bg-secondary text-foreground border-primary/30'
                                        : 'bg-muted text-muted-foreground border-border'
                                }`}
                            >
                                {option} days
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={1}
                            value={customCadence}
                            onChange={event => setCustomCadence(event.target.value)}
                            placeholder="Custom days"
                            className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                        />
                        <button
                            onClick={() => {
                                const parsed = Number(customCadence);
                                if (!Number.isNaN(parsed) && parsed > 0) {
                                    void handleCadenceUpdate(parsed, 'MANUAL');
                                }
                            }}
                            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-black uppercase tracking-widest"
                        >
                            Set
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex items-center justify-between gap-3 bg-muted border border-border rounded-2xl px-4 py-3 text-xs text-muted-foreground">
                            Safe mode
                            <input
                                type="checkbox"
                                checked={contact.safe_mode ?? false}
                                onChange={event => toggleContactFlag('safe_mode', event.target.checked)}
                                className="h-4 w-4 accent-primary"
                            />
                        </label>
                        <label className="flex items-center justify-between gap-3 bg-muted border border-border rounded-2xl px-4 py-3 text-xs text-muted-foreground">
                            Do not contact
                            <input
                                type="checkbox"
                                checked={contact.do_not_contact ?? false}
                                onChange={event => toggleContactFlag('do_not_contact', event.target.checked)}
                                className="h-4 w-4 accent-rose-600"
                            />
                        </label>
                    </div>
                </div>
                <div className="p-6 bg-surface border border-border rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Referral Pipeline</p>
                        <span className="text-xs font-black uppercase tracking-widest text-success">
                            Score {referralScore.score}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Total</p>
                            <p className="text-xl font-black text-foreground">{referralScore.total}</p>
                        </div>
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Active</p>
                            <p className="text-xl font-black text-foreground">{referralScore.active}</p>
                        </div>
                        <div className="bg-muted border border-border rounded-2xl p-3">
                            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest">Won</p>
                            <p className="text-xl font-black text-foreground">{referralScore.won}</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <input
                            type="text"
                            value={referralName}
                            onChange={event => setReferralName(event.target.value)}
                            placeholder="Referred client name"
                            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-xs text-foreground"
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={referralStage}
                                onChange={event => setReferralStage(event.target.value as ReferralStage)}
                                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                            >
                                {(['intro', 'engaged', 'showing', 'under_contract', 'closed', 'lost'] as ReferralStage[]).map(stage => (
                                    <option key={stage} value={stage}>
                                        {stage.replace('_', ' ')}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleAddReferral}
                                className="w-full bg-success/15 text-success text-xs font-black uppercase tracking-widest rounded-xl border border-success/40"
                            >
                                Add Referral
                            </button>
                        </div>
                        <textarea
                            value={referralNotes}
                            onChange={event => setReferralNotes(event.target.value)}
                            placeholder="Notes (optional)"
                            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-xs text-foreground min-h-[80px]"
                        />
                    </div>
                    <div className="space-y-3">
                        {referralEvents.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No referrals tracked yet.</p>
                        ) : (
                            referralEvents.map(event => (
                                <div key={event.id} className="bg-muted border border-border rounded-2xl p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-bold text-foreground">{event.referred_name}</p>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-foreground">
                                            {event.status}
                                        </span>
                                    </div>
                                    {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
                                    <div className="grid grid-cols-2 gap-2">
                                        <select
                                            value={event.stage}
                                            onChange={eventChange =>
                                                handleUpdateReferral(event.id, { stage: eventChange.target.value as ReferralStage })
                                            }
                                            className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                                        >
                                            {(['intro', 'engaged', 'showing', 'under_contract', 'closed', 'lost'] as ReferralStage[]).map(stage => (
                                                <option key={stage} value={stage}>
                                                    {stage.replace('_', ' ')}
                                                </option>
                                            ))}
                                        </select>
                                        <select
                                            value={event.status}
                                            onChange={eventChange =>
                                                handleUpdateReferral(event.id, { status: eventChange.target.value as ReferralStatus })
                                            }
                                            className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs text-foreground"
                                        >
                                            {(['active', 'won', 'lost'] as ReferralStatus[]).map(status => (
                                                <option key={status} value={status}>
                                                    {status}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="p-6 bg-surface border border-border rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Notes</p>
                        <span className="text-xs font-black uppercase tracking-widest text-foreground">{notes.length} Total</span>
                    </div>
                    <textarea
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        className="w-full min-h-[96px] bg-muted border border-border rounded-2xl p-4 text-sm text-foreground font-medium outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Log a quick note about this contact..."
                    />
                    <button
                        onClick={handleAddNote}
                        className="w-full bg-primary text-white text-xs font-black uppercase tracking-widest py-3 rounded-2xl shadow-lg"
                    >
                        Save Note
                    </button>
                    <div className="space-y-2">
                        {notes.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No notes yet.</p>
                        ) : (
                            notes.slice(0, 3).map(note => (
                                <div key={note.id} className="text-xs text-muted-foreground bg-muted border border-border rounded-xl px-3 py-2">
                                    <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">
                                        {new Date(note.created_at).toLocaleDateString()}
                                    </p>
                                    <p className="mt-1">{note.body}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="p-6 bg-surface border border-border rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Timeline</p>
                        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Touches + Notes</span>
                    </div>
                    <div className="space-y-2">
                        {timelineItems.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No activity recorded yet.</p>
                        ) : (
                            timelineItems.slice(0, 8).map(item => (
                                <div key={item.id} className="flex items-start justify-between gap-3 text-xs text-muted-foreground bg-muted border border-border rounded-xl px-3 py-2">
                                    <div>
                                        <p className="font-bold uppercase tracking-widest">{item.label}</p>
                                        <p className="text-muted-foreground text-xs mt-1">{item.detail}</p>
                                    </div>
                                    <span className="text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const EditContact: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [contact, setContact] = useState<Partial<Contact>>({
        full_name: '',
        email: '',
        phone: '',
        radar_interests: [],
        segment: '',
        tags: [],
    });
    
    // Separate local string state to prevent cursor jumping issues during input
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [aboutDraft, setAboutDraft] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const primaryTagOptions = [
        'Past Client',
        'Friend',
        'Family',
        'Good Referral Source',
        'Investor',
        'Other',
    ];
    const secondaryTagOptions = [
        'Professional Partner',
        'Neighbor',
        'Sphere of Influence',
        'Community Worker',
        'Local Business Owner',
        'High Trust',
        'Low Trust',
        'Bad Experience',
        'Influencer/Connector',
        'Luxury/HNW',
        'Fitness/Health Focused',
        'Sports Connection',
        'Faith-Oriented',
        'Prefers Texting',
        'Loves to talk',
        'Detail-oriented',
        'Decisive',
        'Needs Reassurance',
        'High Energy',
    ];
    const isEditing = Boolean(id);

    useEffect(() => {
        if (!id) return;
        void (async () => {
            const data = await dataService.getContactById(id);
            if (data) {
                setContact(data);
                const nameParts = data.full_name?.trim().split(/\s+/) ?? [];
                setFirstName(nameParts[0] ?? '');
                setLastName(nameParts.slice(1).join(' '));
                setSelectedTags(data.tags || []);
            }
        })();
    }, [id]);

    const handleToggleTag = (value: string) => {
        setSelectedTags(current => (
            current.includes(value)
                ? current.filter(tag => tag !== value)
                : [...current, value]
        ));
    };

    const handleSave = async () => {
        const finalName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
        if (!finalName) {
            alert("Name is required");
            return;
        }
        
        const finalContact = {
            ...contact,
            full_name: finalName,
            radar_interests: contact.radar_interests || [],
            tags: selectedTags
        };

        const trimmedAbout = aboutDraft.trim();

        if (isEditing && id) {
            await dataService.updateContact(id, finalContact);
            if (trimmedAbout) {
                await dataService.addNote(id, trimmedAbout);
            }
        } else {
            const savedContact = await dataService.addContact(finalContact);
            if (trimmedAbout) {
                await dataService.addNote(savedContact.id, trimmedAbout);
            }
        }
        navigate('/contacts');
    };

    const InputStyle = "w-full bg-muted border border-border rounded-xl p-4 text-foreground font-bold outline-none transition-all focus:ring-2 focus:ring-primary appearance-none";

    return (
        <div className="max-w-md mx-auto p-6 space-y-8 pb-48">
            <div className="flex items-center gap-4 mb-4">
                <button onClick={() => navigate('/contacts')} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                </button>
                <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter">{isEditing ? 'Edit' : 'Add'} Contact</h1>
            </div>

            <div className="bg-surface border border-border rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">First Name</label>
                    <input 
                        type="text" 
                        value={firstName} 
                        onChange={e => setFirstName(e.target.value)} 
                        className={InputStyle} 
                        placeholder="John"
                        autoComplete="off"
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">Last Name</label>
                    <input 
                        type="text" 
                        value={lastName} 
                        onChange={e => setLastName(e.target.value)} 
                        className={InputStyle} 
                        placeholder="Doe"
                        autoComplete="off"
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">Email</label>
                    <input 
                        type="email" 
                        value={contact.email || ''} 
                        onChange={e => setContact({...contact, email: e.target.value})} 
                        className={InputStyle} 
                        placeholder="john@example.com"
                        autoComplete="off"
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">Phone</label>
                    <input 
                        type="tel" 
                        value={formatPhone(contact.phone || '')} 
                        onChange={e => setContact({ ...contact, phone: normalizePhone(e.target.value) })} 
                        className={InputStyle} 
                        placeholder="(555) 000-0000"
                        autoComplete="off"
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">Tags + Notes</label>
                    <div className="rounded-2xl border border-border bg-muted p-4 space-y-4">
                        <div>
                            <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">About them</label>
                            <textarea
                                value={aboutDraft}
                                onChange={e => setAboutDraft(e.target.value)}
                                className={`${InputStyle} min-h-[96px] resize-y`}
                                placeholder="Tell me about them like you're texting a friend. The more details the better"
                                autoComplete="off"
                                spellCheck={true}
                                autoCorrect="on"
                                autoCapitalize="sentences"
                                rows={3}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-3 ml-1">Primary Tags</label>
                            <div className="flex flex-wrap gap-2">
                                {primaryTagOptions.map(tag => {
                                    const isSelected = selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => handleToggleTag(tag)}
                                            className={`px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-widest transition-colors ${
                                                isSelected
                                                    ? 'border-primary/40 bg-secondary text-foreground'
                                                    : 'border-border bg-muted text-muted-foreground hover:border-primary/50 hover:text-foreground'
                                            }`}
                                            aria-pressed={isSelected}
                                        >
                                            {tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-3 ml-1">Secondary Tags</label>
                            <div className="flex flex-wrap gap-2">
                                {secondaryTagOptions.map(tag => {
                                    const isSelected = selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => handleToggleTag(tag)}
                                            className={`px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-widest transition-colors ${
                                                isSelected
                                                    ? 'border-amber-300 bg-amber-100 text-amber-700'
                                                    : 'border-border bg-muted text-muted-foreground hover:border-amber-300 hover:text-amber-700'
                                            }`}
                                            aria-pressed={isSelected}
                                        >
                                            {tag}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground mt-3">Selected tags: {selectedTags.length ? selectedTags.join(', ') : 'None yet'}</p>
                        </div>
                    </div>
                </div>
                <button 
                    onClick={handleSave}
                    className="w-full bg-primary text-white font-black uppercase tracking-[0.2em] py-5 rounded-2xl transition-all shadow-xl active:scale-95 mt-4"
                >
                    {isEditing ? 'Save Changes' : 'Add Contact'}
                </button>
            </div>
        </div>
    );
};

const ContactsList: React.FC = () => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [nextTouchFilter, setNextTouchFilter] = useState<'all' | 'due' | 'upcoming'>('all');
    const [sortMode, setSortMode] = useState<'name' | 'next-touch'>('name');
    const [showAddMenu, setShowAddMenu] = useState(false);
    const navigate = useNavigate();

    const refreshContacts = async () => {
        const data = await dataService.getContacts();
        setContacts(data);
    };

    useEffect(() => {
        void refreshContacts();
    }, []);

    const contactEntries = contacts.map(contact => {
        const nextTouchDate = getNextTouchDate(contact);
        const nextTouchStatus = getNextTouchStatus(nextTouchDate);
        return {
            contact,
            nextTouchDate,
            nextTouchStatus,
            nextTouchLabel: formatShortDate(nextTouchDate),
        };
    });

    const filtered = contactEntries
        .filter(({ contact }) => {
            const matchesSearch =
                contact.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                contact.email?.toLowerCase().includes(searchTerm.toLowerCase());
            if (!matchesSearch) return false;
            return true;
        })
        .filter(({ nextTouchStatus }) => {
            if (nextTouchFilter === 'all') return true;
            if (nextTouchFilter === 'due') return nextTouchStatus !== 'upcoming';
            return nextTouchStatus === 'upcoming';
        })
        .sort((a, b) => {
            if (sortMode === 'name') {
                return a.contact.full_name.localeCompare(b.contact.full_name);
            }
            const aValue = a.nextTouchDate ? a.nextTouchDate.getTime() : Number.POSITIVE_INFINITY;
            const bValue = b.nextTouchDate ? b.nextTouchDate.getTime() : Number.POSITIVE_INFINITY;
            if (aValue !== bValue) return aValue - bValue;
            return a.contact.full_name.localeCompare(b.contact.full_name);
        });

    return (
        <div className="max-w-2xl mx-auto p-4 pb-24">
            {/* Selection Modal */}
            {showAddMenu && (
              <div className="fixed inset-0 z-[110] flex items-end justify-center px-4 pb-12 sm:items-center sm:pb-0">
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddMenu(false)}></div>
                <div className="relative bg-surface border border-border w-full max-w-sm rounded-[2.5rem] p-8 space-y-4 shadow-2xl animate-in fade-in slide-in-from-bottom-10 duration-300">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-black text-foreground uppercase tracking-tighter">Add Contact</h3>
                    <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest mt-1">Choose your entry mode</p>
                  </div>
                  <button 
                    onClick={() => { navigate('/commute'); setShowAddMenu(false); }} 
                    className="w-full bg-primary p-6 rounded-3xl flex items-center gap-4 group hover:scale-[1.02] transition-transform shadow-xl text-white"
                  >
                     <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-white">
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                     </div>
                     <div className="text-left">
                        <p className="text-white font-black uppercase text-xs tracking-widest">{UI_LABELS.ingestion}</p>
                        <p className="text-white/70 text-xs font-bold">Fast voice memo capture</p>
                     </div>
                  </button>
                  <button 
                    onClick={() => { navigate('/contacts/add'); setShowAddMenu(false); }} 
                    className="w-full bg-muted border border-border p-6 rounded-3xl flex items-center gap-4 group hover:bg-secondary/60 transition-colors shadow-lg"
                  >
                     <div className="w-12 h-12 bg-secondary rounded-2xl flex items-center justify-center text-foreground">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                     </div>
                     <div className="text-left">
                        <p className="text-foreground font-black uppercase text-xs tracking-widest">Manual Entry</p>
                        <p className="text-muted-foreground text-xs font-bold">Text & details</p>
                     </div>
                  </button>
                  <button onClick={() => setShowAddMenu(false)} className="w-full text-muted-foreground font-black uppercase text-xs tracking-[0.2em] pt-4">Cancel</button>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center mb-6 px-2">
                <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter">Contacts</h1>
                <div className="flex items-center gap-3">
                    <button onClick={() => setShowAddMenu(true)} className="text-primary text-xs font-black uppercase tracking-widest border border-primary/30 px-4 py-2 rounded-full hover:bg-secondary transition-colors">Add</button>
                </div>
            </div>
            <input type="text" placeholder="Search contacts..." className="bg-muted border border-border rounded-2xl px-6 py-4 text-sm text-foreground focus:ring-2 focus:ring-primary outline-none w-full mb-6" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2">
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">Next touch</label>
                    <select
                        className="bg-muted border border-border rounded-2xl px-6 py-4 text-sm text-foreground focus:ring-2 focus:ring-primary outline-none w-full"
                        value={nextTouchFilter}
                        onChange={e => setNextTouchFilter(e.target.value as 'all' | 'due' | 'upcoming')}
                    >
                        <option value="all">All</option>
                        <option value="due">Due or overdue</option>
                        <option value="upcoming">Upcoming</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-black text-muted-foreground uppercase tracking-widest mb-2 ml-1">Sort</label>
                    <select
                        className="bg-muted border border-border rounded-2xl px-6 py-4 text-sm text-foreground focus:ring-2 focus:ring-primary outline-none w-full"
                        value={sortMode}
                        onChange={e => setSortMode(e.target.value as 'name' | 'next-touch')}
                    >
                        <option value="name">Name</option>
                        <option value="next-touch">Next touch</option>
                    </select>
                </div>
            </div>
            <div className="bg-surface border border-border rounded-[2.5rem] overflow-hidden shadow-xl">
                {filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <p className="text-muted-foreground font-medium">No contacts found.</p>
                    </div>
                ) : (
                    filtered.map(({ contact, nextTouchLabel, nextTouchStatus }) => (
                        <div key={contact.id} className="p-6 flex justify-between items-center border-b border-border hover:bg-muted transition-colors group cursor-pointer" onClick={() => navigate(`/contacts/${contact.id}`)}>
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center font-black text-foreground">
                                    {contact.full_name.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-bold text-foreground text-lg">{contact.full_name || 'Unnamed Contact'}</div>
                                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                                        {contact.radar_interests.length > 0 ? contact.radar_interests.slice(0, 2).map(i => <span key={i}>• {i}</span>) : <span>No interests noted</span>}
                                        <span>• Next touch: {nextTouchLabel}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                                <span
                                    className={`text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border ${
                                        nextTouchStatus === 'overdue'
                                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                            : nextTouchStatus === 'due'
                                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    }`}
                                >
                                    {nextTouchStatus === 'overdue' ? 'Overdue' : nextTouchStatus === 'due' ? 'Due' : 'Upcoming'}
                                </span>
                                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">{contact.mortgage_inference?.opportunity_tag || 'Standard'}</div>
                                <button 
                                    onClick={() => navigate(`/contacts/edit/${contact.id}`)}
                                    aria-label={`Edit ${contact.full_name || 'contact'}`}
                                    className="p-2 bg-muted border border-border rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

const Settings: React.FC<{ onSignOut: () => Promise<void> | void }> = ({ onSignOut }) => {
    const [profile, setProfile] = useState<RealtorProfile>(DEFAULT_PROFILE);

    useEffect(() => {
        void (async () => {
            const savedProfile = await dataService.getProfile();
            setProfile(savedProfile);
        })();
    }, []);

    const save = async () => {
        await dataService.saveProfile(profile);
        alert('Settings Saved');
    };

    const handleReset = () => {
        if(confirm("Wipe everything? This cannot be undone.")) {
            localStorage.clear();
            window.location.reload();
        }
    };

    const handleHeadshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setProfile(prev => ({ ...prev, headshot: reader.result as string }));
        };
        reader.readAsDataURL(file);
      }
    };

    const cadenceOptions = [
      { value: 'weekly', label: 'Weekly', description: 'Every 7 days' },
      { value: 'monthly', label: 'Monthly', description: 'Every 30 days' },
      { value: 'quarterly', label: 'Quarterly', description: 'Every 90 days' },
      { value: 'custom', label: 'Custom', description: 'Pick your own plan' },
    ] as const;

    const handleCadenceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextType = event.target.value as RealtorProfile['cadence_type'];
      setProfile(prev => ({
        ...prev,
        cadence_type: nextType,
        cadence_custom_days:
          nextType === 'custom'
            ? prev.cadence_custom_days ?? 30
            : prev.cadence_custom_days ?? DEFAULT_CADENCE_DAYS,
      }));
    };

    return (
        <div className="max-w-md mx-auto p-6 pb-24">
            <h1 className="text-2xl font-black text-foreground uppercase tracking-tighter mb-8">Preferences</h1>
            <div className="space-y-8">
                <section className="bg-surface border border-border p-8 rounded-[2.5rem] space-y-6">
                    <h2 className="text-xs font-black text-muted-foreground uppercase tracking-widest">Co-Branding</h2>
                    <div className="flex items-center gap-6">
                      <div className="relative group">
                        <div className="w-20 h-20 rounded-full bg-muted border border-border flex items-center justify-center overflow-hidden">
                          {profile.headshot ? <img src={profile.headshot} className="w-full h-full object-cover" alt="Profile" /> : <div className="text-4xl font-black text-muted-foreground">?</div>}
                        </div>
                        <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
                          <input type="file" accept="image/*" className="hidden" onChange={handleHeadshotUpload} />
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        </label>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-black text-muted-foreground uppercase mb-2 block">Agent Name</label>
                        <input type="text" value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} className="w-full bg-muted border border-border rounded-xl p-3 text-foreground text-sm" />
                      </div>
                    </div>
                </section>
                <section className="bg-surface border border-border p-8 rounded-[2.5rem] space-y-6">
                   <h2 className="text-xs font-black text-muted-foreground uppercase tracking-widest">{UI_LABELS.cadence}</h2>
                   <p className="text-xs text-muted-foreground leading-relaxed">
                        Choose how often you want follow-ups. This plan drives {UI_LABELS.radar.toLowerCase()} eligibility and the due-this-week count.
                   </p>
                   <label className="text-xs font-black text-muted-foreground uppercase tracking-widest">Plan</label>
                   <select
                      value={profile.cadence_type ?? DEFAULT_PROFILE.cadence_type}
                      onChange={handleCadenceChange}
                      className="w-full bg-muted border border-border rounded-xl p-3 text-foreground text-sm"
                    >
                      {cadenceOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </option>
                      ))}
                   </select>
                   {profile.cadence_type === 'custom' && (
                      <div className="space-y-2">
                        <label className="text-xs font-black text-muted-foreground uppercase tracking-widest">Custom days</label>
                        <input
                          type="number"
                          min={1}
                          value={profile.cadence_custom_days ?? 30}
                          onChange={event =>
                            setProfile(prev => ({
                              ...prev,
                              cadence_custom_days: Math.max(1, Number(event.target.value)),
                            }))
                          }
                          className="w-full bg-muted border border-border rounded-xl p-3 text-foreground text-sm"
                        />
                      </div>
                   )}
                </section>
                <section className="bg-surface border border-border p-8 rounded-[2.5rem] space-y-4">
                   <h2 className="text-xs font-black text-muted-foreground uppercase tracking-widest">AI Engine</h2>
                   <p className="text-xs text-muted-foreground leading-relaxed">
                        AI requests are handled through the app account. There is no user-facing API key to manage.
                   </p>
                   <button onClick={save} className="w-full bg-primary text-white font-black uppercase text-xs py-4 rounded-xl">Save Preferences</button>
                </section>
                <section className="bg-surface border border-border p-8 rounded-[2.5rem] space-y-4">
                   <h2 className="text-xs font-black text-muted-foreground uppercase tracking-widest">Account</h2>
                   <button onClick={onSignOut} className="w-full border border-rose-200 text-rose-700 font-black uppercase text-xs py-4 rounded-xl">
                     Sign Out
                   </button>
                </section>
                <button onClick={handleReset} className="w-full text-rose-600 font-black uppercase text-xs tracking-widest pt-4">Delete All Data</button>
            </div>
        </div>
    );
};

const BottomNav: React.FC = () => {
    const location = useLocation();
    const isActive = (path: string) => location.pathname === path || (path === '/contacts' && location.pathname.startsWith('/contacts'));
    const navItemClass = (path: string) => `flex flex-col items-center justify-center gap-1 transition-all ${isActive(path) ? 'text-primary scale-110' : 'text-muted-foreground hover:text-foreground'}`;

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-2xl border-t border-border px-8 py-4 flex justify-between items-center max-w-2xl mx-auto rounded-t-[3rem] shadow-[0_-10px_30px_rgba(15,23,42,0.08)]">
            <Link to="/" className={navItemClass('/')}><svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 9.5V21h5v-6h5v6h5V9.5L12 2z"/></svg><span className="text-xs font-black uppercase tracking-tighter">{UI_LABELS.radar}</span></Link>
            <Link to="/actions" className={navItemClass('/actions')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3l3 8 4-16 3 8h5" /></svg><span className="text-xs font-black uppercase tracking-tighter">Actions</span></Link>
            <Link to="/mort" className={navItemClass('/mort')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg><span className="text-xs font-black uppercase tracking-tighter">{UI_LABELS.assistant}</span></Link>
            <Link to="/contacts" className={navItemClass('/contacts')}><svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg><span className="text-xs font-black uppercase tracking-tighter">Contacts</span></Link>
            <Link to="/settings" className={navItemClass('/settings')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg><span className="text-xs font-black uppercase tracking-tighter">Prefs</span></Link>
        </nav>
    );
};

const Layout: React.FC<{children: React.ReactNode}> = ({ children }) => {
    return (
        <div className="min-h-screen bg-app text-foreground">
            <header className="px-8 py-6 flex items-center justify-between max-w-2xl mx-auto">
                <Link to="/" className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-white font-black text-xl shadow-2xl">M</div>
                </Link>
                <Link
                    to="/commute"
                    className="inline-flex items-center gap-2 rounded-full border border-primary/30 px-4 py-2 text-xs font-black uppercase tracking-widest text-primary hover:bg-secondary"
                >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                    Add
                </Link>
            </header>
            <main className="relative z-0">
                <div className="fixed top-0 left-1/4 w-96 h-96 bg-secondary/40 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                {children}
            </main>
            <BottomNav />
        </div>
    );
};

const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <div className="min-h-screen bg-app text-foreground flex flex-col">
            <header className="px-8 py-8 flex items-center justify-center">
                <Link to="/" className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-black text-xl shadow-2xl">M</div>
                </Link>
            </header>
            <main className="relative flex-1 flex items-center justify-center px-6">
                <div className="fixed top-0 left-1/4 w-96 h-96 bg-secondary/40 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                <div className="w-full">
                    {children}
                </div>
            </main>
            <footer className="px-6 py-6 text-center text-sm text-muted-foreground">
                <span className="font-[cursive]">Brought to you by Justin Leffew at Stratton Mortgage</span>
            </footer>
        </div>
    );
};

const AuthCallback: React.FC = () => {
    return (
        <div className="max-w-md mx-auto px-6 py-16 text-center">
            <div className="w-14 h-14 mx-auto mb-6 rounded-2xl bg-secondary text-foreground flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16m-6-6l6 6-6 6" />
                </svg>
            </div>
            <h2 className="text-xl font-black text-foreground uppercase tracking-widest">Completing sign in</h2>
            <p className="text-xs text-muted-foreground mt-3">Hang tight while we connect your session.</p>
        </div>
    );
};

export default function App() {
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const handleAuthCallback = async () => {
      const hash = window.location.hash;
      const hashQuery = hash.includes('?') ? hash.split('?')[1] : '';
      const queryParams = new URLSearchParams(hashQuery || window.location.search);
      const authCode = queryParams.get('code');
      const authError = queryParams.get('error');
      const authErrorDescription = queryParams.get('error_description');
      if (authError) {
        console.warn('Supabase auth error:', authError, authErrorDescription);
      }
      if (!authCode) return;
      const { error } = await supabase.auth.exchangeCodeForSession(authCode);
      if (error) {
        console.warn('Failed to exchange auth code', error);
      }
      const cleanedHash = hash.includes('?') ? hash.split('?')[0] : hash;
      window.history.replaceState(
        {},
        document.title,
        `${window.location.origin}${window.location.pathname}${window.location.search}${cleanedHash}`
      );
    };
    void handleAuthCallback();
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        void dataService.initAuthProfile();
      }
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        void dataService.initAuthProfile();
      }
    });
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <HashRouter>
      {session ? (
        <Layout>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/actions" element={<DailyActions />} />
                <Route path="/mort" element={<div className="max-w-2xl mx-auto h-[calc(100vh-140px)] p-4"><MortgageAssist /></div>} />
                <Route path="/commute" element={<CommuteMode />} />
                <Route path="/contacts" element={<ContactsList />} />
                <Route path="/contacts/add" element={<EditContact />} />
                <Route path="/contacts/edit/:id" element={<EditContact />} />
                <Route path="/contacts/:id" element={<ContactDetail />} />
                <Route path="/settings" element={<Settings onSignOut={handleSignOut} />} />
            </Routes>
        </Layout>
      ) : (
        <AuthLayout>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="*" element={<AuthPanel supabase={supabase} />} />
          </Routes>
        </AuthLayout>
      )}
    </HashRouter>
  );
}
