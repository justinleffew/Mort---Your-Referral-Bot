
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

const parseCsvRows = (content: string) => {
  const rows = content
    .split(/\r?\n/)
    .map(row => row.trim())
    .filter(Boolean);
  if (rows.length === 0) return [];
  const headers = rows[0].split(',').map(header => header.trim());
  return rows.slice(1).map(row => {
    const values = row.split(',').map(value => value.trim());
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? '';
      return acc;
    }, {});
  });
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
    <div className="bg-slate-900/60 border border-white/10 rounded-[2.5rem] p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Playbooks</p>
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">Copy-ready scripts</h3>
        </div>
      </div>
      <div className="grid gap-4">
        {PLAYBOOKS.map(playbook => (
          <div key={playbook.id} className="bg-slate-950/70 border border-white/5 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black uppercase tracking-widest text-indigo-300">{playbook.title}</p>
              <button
                type="button"
                onClick={() => handleCopy(playbook.body, playbook.id)}
                className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300 hover:text-emerald-200 transition"
              >
                {copiedId === playbook.id ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-sm text-slate-200 whitespace-pre-line">{playbook.body}</p>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-xs font-semibold text-amber-400">{error}</p>}
    </div>
  );
};

const ImportContactsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
}> = ({ isOpen, onClose, onImported }) => {
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setImportResult(null);
      setImportError(null);
      setIsImporting(false);
    }
  }, [isOpen]);

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    const text = await file.text();
    const rows = parseCsvRows(text);
    if (rows.length === 0) {
      setImportError('No rows detected. Please upload a CSV with headers.');
      setIsImporting(false);
      event.target.value = '';
      return;
    }
    const result = await dataService.bulkImport(rows);
    setImportResult(result);
    setIsImporting(false);
    event.target.value = '';
    onImported?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center px-4 pb-12 sm:items-center sm:pb-0">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-slate-900 border border-white/10 w-full max-w-sm rounded-[2.5rem] p-8 space-y-5 shadow-2xl animate-in fade-in slide-in-from-bottom-10 duration-300">
        <div className="text-center space-y-2">
          <h3 className="text-xl font-black text-white uppercase tracking-tighter">Import Contacts</h3>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">CSV or Google</p>
        </div>
        <label className="w-full bg-slate-800 border border-white/5 p-5 rounded-3xl flex items-center gap-4 cursor-pointer hover:bg-slate-700 transition-colors shadow-lg">
          <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-300">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M8 12l4-4m0 0l4 4m-4-4v12"/></svg>
          </div>
          <div>
            <p className="text-white font-black uppercase text-xs tracking-widest">Upload CSV</p>
            <p className="text-slate-500 text-xs font-bold">Use Name, Email, Phone headers</p>
          </div>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
        </label>
        <button
          type="button"
          disabled
          className="w-full bg-slate-800/40 border border-white/5 p-5 rounded-3xl flex items-center gap-4 text-left opacity-60 cursor-not-allowed"
        >
          <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-300">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v18m9-9H3"/></svg>
          </div>
          <div>
            <p className="text-white font-black uppercase text-xs tracking-widest">Connect Google</p>
            <p className="text-slate-500 text-xs font-bold">Coming soon</p>
          </div>
        </button>
        {isImporting && (
          <div className="text-xs font-semibold text-slate-400 text-center">
            Importing…
          </div>
        )}
        {importError && (
          <div className="text-xs font-semibold text-rose-300 text-center">
            {importError}
          </div>
        )}
        {importResult && (
          <div className="text-xs font-semibold text-emerald-300 text-center">
            {importResult.added} added · {importResult.updated} updated · {importResult.skipped} skipped
          </div>
        )}
        <button onClick={onClose} className="w-full text-slate-600 font-black uppercase text-xs tracking-[0.2em] pt-2">
          Close
        </button>
      </div>
    </div>
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
  const [showImportMenu, setShowImportMenu] = useState(false);
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
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowAddMenu(false)}></div>
          <div className="relative bg-slate-900 border border-white/10 w-full max-w-sm rounded-[2.5rem] p-8 space-y-4 shadow-2xl animate-in fade-in slide-in-from-bottom-10 duration-300">
            <div className="text-center mb-6">
              <h3 className="text-xl font-black text-white uppercase tracking-tighter">Add Contact</h3>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Choose your entry mode</p>
            </div>
            <button 
              onClick={() => { navigate('/commute'); setShowAddMenu(false); }} 
              className="w-full bg-gradient-to-r from-pink-500 to-purple-600 p-6 rounded-3xl flex items-center gap-4 group hover:scale-[1.02] transition-transform shadow-xl"
            >
               <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
               </div>
               <div className="text-left">
                  <p className="text-white font-black uppercase text-xs tracking-widest">Brain Dump</p>
                  <p className="text-white/60 text-xs font-bold">Fast voice ingestion</p>
               </div>
            </button>
            <button 
              onClick={() => { navigate('/contacts/add'); setShowAddMenu(false); }} 
              className="w-full bg-slate-800 border border-white/5 p-6 rounded-3xl flex items-center gap-4 group hover:bg-slate-700 transition-colors shadow-lg"
            >
               <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
               </div>
               <div className="text-left">
                  <p className="text-white font-black uppercase text-xs tracking-widest">Manual Entry</p>
                  <p className="text-slate-500 text-xs font-bold">Text & details</p>
               </div>
            </button>
            <button onClick={() => setShowAddMenu(false)} className="w-full text-slate-600 font-black uppercase text-xs tracking-[0.2em] pt-4">Cancel</button>
          </div>
        </div>
      )}

      <ImportContactsModal
        isOpen={showImportMenu}
        onClose={() => setShowImportMenu(false)}
        onImported={() => void refreshRadar()}
      />

      <div className="bg-slate-900/40 border border-white/5 rounded-[2.5rem] p-6 mb-8 flex items-center justify-between shadow-2xl">
          <div className="flex-1">
            <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.3em] mb-2">Radar Coverage</h4>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-pink-500 to-indigo-500 transition-all duration-1000" style={{ width: `${stats.percent}%` }}></div>
              </div>
              <span className="text-xl font-black text-white">{stats.percent}%</span>
            </div>
          </div>
          <button 
            onClick={() => setShowAddMenu(true)}
            className="ml-6 w-14 h-14 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-[0_0_20px_rgba(236,72,153,0.4)] active:scale-95 transition-transform"
          >
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 mb-6 px-2">
        <button
          onClick={() => setShowImportMenu(true)}
          className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full border border-slate-600/60 text-slate-300 hover:text-white hover:border-slate-400 transition-colors"
        >
          Import contacts (CSV or Google)
        </button>
      </div>

      <div className="flex justify-between items-center mb-6 px-2">
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tighter">This week&apos;s opportunities</h1>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cadence: {cadenceLabel}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRunNow}
              disabled={runNowLoading}
              className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full border border-indigo-500/40 text-indigo-300 hover:text-white hover:border-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {runNowLoading ? 'Running…' : 'Run Now'}
            </button>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{dueThisWeekCount} Due</span>
          </div>
      </div>

      {runNowError && (
        <div className="mx-2 mb-6 text-xs text-amber-300 font-bold uppercase tracking-widest">
          {runNowError}
        </div>
      )}

      {runNowOpportunities.length > 0 && (
        <div className="space-y-4 mb-10">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-black text-white uppercase tracking-widest">Run Now Opportunities</h2>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
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
              <div key={opportunity.id} className="bg-slate-900/50 border border-white/5 rounded-3xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-black text-lg">{opportunity.contact_full_name ?? 'Contact'}</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Score {opportunity.score}</p>
                  </div>
                  <button
                    onClick={() => handleMarkContacted(opportunity.contact_id, selectedMessage)}
                    className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  >
                    Mark as contacted
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {typeof daysSince === 'number' && (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-slate-800 text-slate-300">
                      Touched {daysSince} days ago
                    </span>
                  )}
                  {opportunity.year_cap_exceeded && (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Exceeds 4/year
                    </span>
                  )}
                  {opportunity.cadence_violation && (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      Inside cadence (set to {cadenceDaysValue} days)
                    </span>
                  )}
                </div>
                {opportunity.reasons?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Why now</p>
                    <div className="flex flex-wrap gap-2">
                      {opportunity.reasons.map(reason => (
                        <span
                          key={`${opportunity.id}-${reason}`}
                          className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-slate-950 text-slate-400 border border-white/5"
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
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl text-sm text-white p-3"
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
                      className="flex-1 bg-indigo-500/90 text-white text-xs font-black uppercase tracking-widest py-3 rounded-2xl"
                    >
                      Copy message
                    </button>
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
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
            <div className="absolute inset-0 border-2 border-slate-800 rounded-full"></div>
            <div className="absolute inset-0 border-t-2 border-pink-500 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-12 h-12 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </div>
          </div>
          <h3 className="text-2xl font-black text-white mb-3">Radar Empty</h3>
          <p className="text-slate-400 mb-6 max-w-xs mx-auto text-sm leading-relaxed font-medium">Start adding some clients so I can get to work for you!</p>
          <ol className="space-y-2 text-xs font-bold uppercase tracking-widest text-slate-400 mb-8">
            <li className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs">1</span>
              Add contacts
            </li>
            <li className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs">2</span>
              Set cadence
            </li>
            <li className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs">3</span>
              Get next-touch prompts
            </li>
          </ol>
          <div className="flex flex-col items-center gap-3">
            <button 
              onClick={() => setShowAddMenu(true)} 
              className="bg-white text-slate-950 font-black uppercase tracking-[0.2em] py-4 px-12 rounded-full transition-all shadow-xl active:scale-95"
            >
              Add Contact
            </button>
            <button
              onClick={() => setShowImportMenu(true)}
              className="text-xs font-black uppercase tracking-widest px-6 py-2 rounded-full border border-slate-600/60 text-slate-300 hover:text-white hover:border-slate-400 transition-colors"
            >
              Import contacts (CSV or Google)
            </button>
            {contactsCount === 0 && !sampleSeeded && (
              <button
                onClick={handleSeedSampleContacts}
                disabled={sampleSeeding}
                className="text-xs font-black uppercase tracking-widest px-6 py-2 rounded-full border border-emerald-500/40 text-emerald-300 hover:text-white hover:border-emerald-400 transition-colors disabled:opacity-50"
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
    </div>
  );
};

const DailyActions: React.FC = () => {
  const [radarContacts, setRadarContacts] = useState<Contact[]>([]);
  const [referralEvents, setReferralEvents] = useState<ReferralEvent[]>([]);
  const [topSources, setTopSources] = useState<
    Array<{ contact: Contact; total: number; won: number; active: number; score: number }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
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
      setTopSources(
        scoredSources
          .filter(source => source.total > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
      );
      setLoading(false);
    };
    void load();
  }, []);

  const stageLabel = (stage: ReferralStage) =>
    stage
      .split('_')
      .map(word => word[0]?.toUpperCase() + word.slice(1))
      .join(' ');

  if (loading) {
    return (
      <div className="p-8 text-slate-400 font-semibold">Loading daily actions...</div>
    );
  }

  return (
    <div className="px-6 pb-24 space-y-8">
      <header className="pt-8">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Daily Actions</p>
        <h1 className="text-3xl font-black text-white uppercase tracking-tighter">Focus list</h1>
        <p className="text-sm text-slate-400 mt-2">High-value touches and referrals to move today.</p>
      </header>

      <section className="bg-slate-900/60 border border-white/10 rounded-[2.5rem] p-6 shadow-2xl space-y-4">
        <h2 className="text-lg font-black text-white uppercase tracking-widest">Radar follow-ups</h2>
        {radarContacts.length === 0 ? (
          <p className="text-sm text-slate-500">No radar follow-ups due right now.</p>
        ) : (
          <ul className="space-y-3">
            {radarContacts.map(contact => (
              <li key={contact.id} className="flex items-center justify-between bg-slate-950/60 border border-white/5 rounded-2xl px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-white">{contact.full_name}</p>
                  <p className="text-xs text-slate-400">{contact.radar_interests[0] || 'No interest noted'}</p>
                </div>
                <button
                  type="button"
                  className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300"
                  onClick={() => {
                    window.location.hash = `#/contacts/${contact.id}`;
                  }}
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-slate-900/60 border border-white/10 rounded-[2.5rem] p-6 shadow-2xl space-y-4">
        <h2 className="text-lg font-black text-white uppercase tracking-widest">Active referrals</h2>
        {referralEvents.length === 0 ? (
          <p className="text-sm text-slate-500">No active referrals yet.</p>
        ) : (
          <ul className="space-y-3">
            {referralEvents.map(event => (
              <li key={event.id} className="bg-slate-950/60 border border-white/5 rounded-2xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-white">{event.referred_name}</p>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                    {stageLabel(event.stage)}
                  </span>
                </div>
                {event.notes && <p className="text-xs text-slate-400">{event.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-slate-900/60 border border-white/10 rounded-[2.5rem] p-6 shadow-2xl space-y-4">
        <h2 className="text-lg font-black text-white uppercase tracking-widest">Top referral sources</h2>
        {topSources.length === 0 ? (
          <p className="text-sm text-slate-500">No referral sources scored yet.</p>
        ) : (
          <ul className="space-y-3">
            {topSources.map(source => (
              <li key={source.contact.id} className="flex items-center justify-between bg-slate-950/60 border border-white/5 rounded-2xl px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-white">{source.contact.full_name}</p>
                  <p className="text-xs text-slate-400">{source.won} won · {source.active} active</p>
                </div>
                <span className="text-sm font-black text-indigo-300">Score {source.score}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
        <div className="flex items-start gap-4 p-4 bg-slate-800/20 border border-white/5 rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-slate-400">
                {icon}
            </div>
            <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-0.5">{label}</p>
                <p className="text-white font-bold">{value || 'Not provided'}</p>
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
                <button onClick={() => navigate('/contacts')} className="p-2 text-slate-400 hover:text-white">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                </button>
                <button onClick={() => navigate(`/contacts/edit/${contact.id}`)} className="text-indigo-400 text-xs font-black uppercase tracking-widest border border-indigo-400/30 px-6 py-2 rounded-full">
                    Edit
                </button>
            </div>

            <div className="text-center space-y-4 mb-8">
                <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-[2rem] flex items-center justify-center text-white font-black text-4xl mx-auto border border-white/10 shadow-2xl">
                    {contact.full_name.charAt(0)}
                </div>
                <h1 className="text-3xl font-black text-white uppercase tracking-tighter">{contact.full_name}</h1>
                {contact.mortgage_inference && (
                    <span className="inline-block bg-pink-500/20 text-pink-400 text-xs font-black px-4 py-1 rounded-full uppercase tracking-widest border border-pink-500/30">
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
                <div className="p-6 bg-slate-800/20 border border-white/5 rounded-3xl space-y-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Radar Interests</p>
                    <div className="flex flex-wrap gap-2">
                        {contact.radar_interests.length > 0 ? (
                            contact.radar_interests.map((interest, i) => (
                                <span key={i} className="bg-slate-900 border border-white/5 px-4 py-2 rounded-xl text-xs font-bold text-slate-300">
                                    {interest}
                                </span>
                            ))
                        ) : (
                            <p className="text-slate-600 text-xs italic">No interests recorded yet.</p>
                        )}
                    </div>
                </div>
                {contact.mortgage_inference && (
                    <div className="p-6 bg-pink-500/5 border border-pink-500/10 rounded-3xl space-y-3">
                        <p className="text-xs font-black uppercase tracking-widest text-pink-500">Mortgage Inference</p>
                        <p className="text-white font-bold text-sm leading-relaxed">{contact.mortgage_inference.reasoning}</p>
                    </div>
                )}
                <div className="p-6 bg-slate-800/20 border border-white/5 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Touch Cadence</p>
                        <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                            {touchSummary.quarterCount >= 1 ? 'On Track' : 'Due This Quarter'}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">This Q</p>
                            <p className="text-xl font-black text-white">{touchSummary.quarterCount}</p>
                        </div>
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">This Year</p>
                            <p className="text-xl font-black text-white">{touchSummary.yearCount}</p>
                        </div>
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Last Touch</p>
                            <p className="text-xs font-bold text-white">
                                {touchSummary.lastTouch ? new Date(touchSummary.lastTouch).toLocaleDateString() : 'None'}
                            </p>
                        </div>
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Next Touch</p>
                            <p className="text-xs font-bold text-white">{formatShortDate(nextTouchDate)}</p>
                            <span className={`mt-2 inline-block text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-widest border ${nextTouchBadgeStyles}`}>
                                {nextTouchBadgeLabel}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => logTouch('call')} className="py-2 rounded-xl bg-slate-900 text-slate-200 text-xs font-black uppercase tracking-widest border border-white/5">
                            Called
                        </button>
                        <button onClick={() => logTouch('text')} className="py-2 rounded-xl bg-slate-900 text-slate-200 text-xs font-black uppercase tracking-widest border border-white/5">
                            Texted
                        </button>
                        <button onClick={() => logTouch('email')} className="py-2 rounded-xl bg-slate-900 text-slate-200 text-xs font-black uppercase tracking-widest border border-white/5">
                            Emailed
                        </button>
                    </div>
                </div>
                <div className="p-6 bg-slate-800/20 border border-white/5 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Cadence Settings</p>
                        <button
                            onClick={() => handleCadenceUpdate(profileCadenceDays, 'AUTO')}
                            className="text-xs font-black uppercase tracking-widest text-indigo-300 border border-indigo-400/30 px-3 py-1 rounded-full"
                        >
                            Use profile cadence
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[30, 60, 90, 120, 180].map(option => (
                            <button
                                key={`cadence-${option}`}
                                onClick={() => handleCadenceUpdate(option, 'MANUAL')}
                                className={`px-3 py-2 rounded-full text-xs font-black uppercase tracking-widest border ${
                                    cadenceSelection === option
                                        ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                                        : 'bg-slate-900 text-slate-400 border-white/5'
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
                            className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                        />
                        <button
                            onClick={() => {
                                const parsed = Number(customCadence);
                                if (!Number.isNaN(parsed) && parsed > 0) {
                                    void handleCadenceUpdate(parsed, 'MANUAL');
                                }
                            }}
                            className="px-4 py-2 rounded-xl bg-indigo-500/20 text-indigo-200 text-xs font-black uppercase tracking-widest border border-indigo-500/40"
                        >
                            Set
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex items-center justify-between gap-3 bg-slate-900/60 border border-white/5 rounded-2xl px-4 py-3 text-xs text-slate-300">
                            Safe mode
                            <input
                                type="checkbox"
                                checked={contact.safe_mode ?? false}
                                onChange={event => toggleContactFlag('safe_mode', event.target.checked)}
                                className="h-4 w-4 accent-indigo-500"
                            />
                        </label>
                        <label className="flex items-center justify-between gap-3 bg-slate-900/60 border border-white/5 rounded-2xl px-4 py-3 text-xs text-slate-300">
                            Do not contact
                            <input
                                type="checkbox"
                                checked={contact.do_not_contact ?? false}
                                onChange={event => toggleContactFlag('do_not_contact', event.target.checked)}
                                className="h-4 w-4 accent-rose-500"
                            />
                        </label>
                    </div>
                </div>
                <div className="p-6 bg-slate-800/20 border border-white/5 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Referral Pipeline</p>
                        <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                            Score {referralScore.score}
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Total</p>
                            <p className="text-xl font-black text-white">{referralScore.total}</p>
                        </div>
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Active</p>
                            <p className="text-xl font-black text-white">{referralScore.active}</p>
                        </div>
                        <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Won</p>
                            <p className="text-xl font-black text-white">{referralScore.won}</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <input
                            type="text"
                            value={referralName}
                            onChange={event => setReferralName(event.target.value)}
                            placeholder="Referred client name"
                            className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-xs text-white"
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={referralStage}
                                onChange={event => setReferralStage(event.target.value as ReferralStage)}
                                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                            >
                                {(['intro', 'engaged', 'showing', 'under_contract', 'closed', 'lost'] as ReferralStage[]).map(stage => (
                                    <option key={stage} value={stage}>
                                        {stage.replace('_', ' ')}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleAddReferral}
                                className="w-full bg-emerald-500/20 text-emerald-200 text-xs font-black uppercase tracking-widest rounded-xl border border-emerald-500/40"
                            >
                                Add Referral
                            </button>
                        </div>
                        <textarea
                            value={referralNotes}
                            onChange={event => setReferralNotes(event.target.value)}
                            placeholder="Notes (optional)"
                            className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-xs text-white min-h-[80px]"
                        />
                    </div>
                    <div className="space-y-3">
                        {referralEvents.length === 0 ? (
                            <p className="text-xs text-slate-600 italic">No referrals tracked yet.</p>
                        ) : (
                            referralEvents.map(event => (
                                <div key={event.id} className="bg-slate-900/60 border border-white/5 rounded-2xl p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-bold text-white">{event.referred_name}</p>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                                            {event.status}
                                        </span>
                                    </div>
                                    {event.notes && <p className="text-xs text-slate-400">{event.notes}</p>}
                                    <div className="grid grid-cols-2 gap-2">
                                        <select
                                            value={event.stage}
                                            onChange={eventChange =>
                                                handleUpdateReferral(event.id, { stage: eventChange.target.value as ReferralStage })
                                            }
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
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
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
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
                <div className="p-6 bg-slate-800/20 border border-white/5 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Notes</p>
                        <span className="text-xs font-black uppercase tracking-widest text-indigo-400">{notes.length} Total</span>
                    </div>
                    <textarea
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        className="w-full min-h-[96px] bg-slate-900 border border-white/5 rounded-2xl p-4 text-sm text-white font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Log a quick note about this contact..."
                    />
                    <button
                        onClick={handleAddNote}
                        className="w-full bg-indigo-500 text-white text-xs font-black uppercase tracking-widest py-3 rounded-2xl shadow-lg"
                    >
                        Save Note
                    </button>
                    <div className="space-y-2">
                        {notes.length === 0 ? (
                            <p className="text-xs text-slate-600 italic">No notes yet.</p>
                        ) : (
                            notes.slice(0, 3).map(note => (
                                <div key={note.id} className="text-xs text-slate-300 bg-slate-900/40 border border-white/5 rounded-xl px-3 py-2">
                                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                                        {new Date(note.created_at).toLocaleDateString()}
                                    </p>
                                    <p className="mt-1">{note.body}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="p-6 bg-slate-800/20 border border-white/5 rounded-3xl space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Timeline</p>
                        <span className="text-xs font-black uppercase tracking-widest text-slate-400">Touches + Notes</span>
                    </div>
                    <div className="space-y-2">
                        {timelineItems.length === 0 ? (
                            <p className="text-xs text-slate-600 italic">No activity recorded yet.</p>
                        ) : (
                            timelineItems.slice(0, 8).map(item => (
                                <div key={item.id} className="flex items-start justify-between gap-3 text-xs text-slate-300 bg-slate-900/40 border border-white/5 rounded-xl px-3 py-2">
                                    <div>
                                        <p className="font-bold uppercase tracking-widest">{item.label}</p>
                                        <p className="text-slate-500 text-xs mt-1">{item.detail}</p>
                                    </div>
                                    <span className="text-slate-500">{new Date(item.created_at).toLocaleDateString()}</span>
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

    const InputStyle = "w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-white font-bold outline-none transition-all focus:ring-2 focus:ring-indigo-500 appearance-none";

    return (
        <div className="max-w-md mx-auto p-6 space-y-8 pb-48">
            <div className="flex items-center gap-4 mb-4">
                <button onClick={() => navigate('/contacts')} className="p-2 text-slate-400 hover:text-white transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                </button>
                <h1 className="text-2xl font-black text-white uppercase tracking-tighter">{isEditing ? 'Edit' : 'Add'} Contact</h1>
            </div>

            <div className="bg-slate-800/40 border border-white/5 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">First Name</label>
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
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Last Name</label>
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
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Email</label>
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
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Phone</label>
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
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Tags + Notes</label>
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
                        <div>
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">About them</label>
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
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3 ml-1">Primary Tags</label>
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
                                                    ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-200'
                                                    : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-indigo-400/50 hover:text-indigo-200'
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
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3 ml-1">Secondary Tags</label>
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
                                                    ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                                                    : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-amber-400/50 hover:text-amber-200'
                                            }`}
                                            aria-pressed={isSelected}
                                        >
                                            {tag}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-slate-500 mt-3">Selected tags: {selectedTags.length ? selectedTags.join(', ') : 'None yet'}</p>
                        </div>
                    </div>
                </div>
                <button 
                    onClick={handleSave}
                    className="w-full bg-white text-slate-950 font-black uppercase tracking-[0.2em] py-5 rounded-2xl transition-all shadow-xl active:scale-95 mt-4"
                >
                    {isEditing ? 'Save Changes' : 'Add Contact'}
                </button>
            </div>
        </div>
    );
};

const getEstimatedInsurance = (price: number) => {
  if (price <= 300000) return 100;
  if (price <= 500000) return 100 + (price - 300000) * 0.000125;
  return 125 + (price - 500000) * 0.0001;
};

const Calculator: React.FC = () => {
  const [price, setPrice] = useState<number>(500000);
  const [down, setDown] = useState<number>(20);
  const [rate, setRate] = useState<number>(6.5);
  const [taxes, setTaxes] = useState<number>(6000);
  const [insurance, setInsurance] = useState<number>(() => getEstimatedInsurance(500000));
  const [insuranceEdited, setInsuranceEdited] = useState(false);
  const [pmiRate, setPmiRate] = useState<number>(0.5);
  const [showMode, setShowMode] = useState(false);
  const [profile, setProfile] = useState<RealtorProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    void (async () => {
      const savedProfile = await dataService.getProfile();
      setProfile(savedProfile);
    })();
  }, []);
  
  useEffect(() => {
    if (!insuranceEdited) {
      setInsurance(getEstimatedInsurance(price));
    }
  }, [insuranceEdited, price]);

  const monthlyInsurance = insurance;
  const monthlyTaxes = taxes / 12;
  const loanAmount = price * (1 - down / 100);
  const monthlyRate = rate / 100 / 12;
  const numPayments = 30 * 12;
  const monthlyPI = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
  const isPmiRequired = down < 20;
  const monthlyPmi = isPmiRequired ? (loanAmount * (pmiRate / 100)) / 12 : 0;
  const totalMonthly = monthlyPI + monthlyTaxes + monthlyInsurance + monthlyPmi;

  const InputStyle = "w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-white font-bold outline-none transition-all focus:ring-2 focus:ring-pink-500";
  
  if (showMode) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 p-6 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 overflow-y-auto">
        <button onClick={() => setShowMode(false)} className="absolute top-6 right-6 text-slate-500 uppercase font-black text-xs tracking-widest bg-slate-900 border border-white/5 px-6 py-3 rounded-full active:scale-95 transition-all">Exit Presentation</button>
        <div className="w-full max-w-lg space-y-10 text-center my-auto">
          <div className="space-y-4">
            <h4 className="text-xs font-black uppercase tracking-[0.5em] text-pink-500">Total Monthly Payment</h4>
            <div className="text-9xl font-black text-white tracking-tighter tabular-nums">${Math.round(totalMonthly).toLocaleString()}</div>
            <div className="flex justify-center gap-6 text-xs font-black text-slate-500 uppercase tracking-widest">
              <span>P&I: ${Math.round(monthlyPI)}</span>
              <span>Taxes: ${Math.round(monthlyTaxes)}</span>
              <span>Ins: ${Math.round(monthlyInsurance)}</span>
              {isPmiRequired && <span>PMI: ${Math.round(monthlyPmi)}</span>}
            </div>
          </div>
          <div className="bg-slate-900 border border-white/5 p-10 rounded-[3rem] space-y-8 shadow-2xl">
             <div className="space-y-4">
                <div className="flex justify-between items-end px-2"><label className="text-xs font-black uppercase tracking-widest text-slate-500">Price</label><span className="text-3xl font-black text-white">${price.toLocaleString()}</span></div>
                <input type="range" min="100000" max="2000000" step="10000" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-full h-4 bg-slate-800 rounded-full appearance-none cursor-pointer accent-pink-500" />
             </div>
             <div className="space-y-4">
                <div className="flex justify-between items-end px-2"><label className="text-xs font-black uppercase tracking-widest text-slate-500">Rate</label><span className="text-3xl font-black text-white">{rate}%</span></div>
                <input type="range" min="3" max="10" step="0.1" value={rate} onChange={e => setRate(Number(e.target.value))} className="w-full h-4 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500" />
             </div>
          </div>
          <div className="pt-8 border-t border-white/5 flex items-center justify-center gap-4">
            {profile.headshot ? <img src={profile.headshot} className="w-16 h-16 rounded-full border-2 border-white/10" alt="Agent" /> : <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center font-black">{profile.name.charAt(0)}</div>}
            <div className="text-left"><p className="text-xs font-black uppercase tracking-[0.3em] text-pink-500">Consultant</p><p className="text-2xl font-black text-white tracking-tighter">{profile.name}</p></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Quick Calc</h1>
          <button onClick={() => setShowMode(true)} className="bg-indigo-600 text-white text-xs font-black uppercase tracking-widest px-6 py-3 rounded-full shadow-xl">Show Mode</button>
        </div>
        <div className="bg-slate-800/60 backdrop-blur-md border border-white/10 rounded-[2.5rem] p-8 space-y-6">
            <div><label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Price</label><input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className={InputStyle} /></div>
            <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Down %</label><input type="number" value={down} onChange={e => setDown(Number(e.target.value))} className={InputStyle} /></div>
                <div><label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Rate</label><input type="number" step="0.1" value={rate} onChange={e => setRate(Number(e.target.value))} className={InputStyle} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Taxes (annual)</label>
                    <input type="number" value={taxes} onChange={e => setTaxes(Number(e.target.value))} className={InputStyle} />
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Insurance (monthly)</label>
                    <input
                        type="number"
                        value={insurance}
                        onChange={e => {
                            setInsurance(Number(e.target.value));
                            setInsuranceEdited(true);
                        }}
                        className={InputStyle}
                    />
                </div>
            </div>
            {isPmiRequired && (
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">PMI rate (annual %)</label>
                    <input
                        type="number"
                        step="0.1"
                        min={0}
                        value={pmiRate}
                        onChange={e => setPmiRate(Number(e.target.value))}
                        className={InputStyle}
                    />
                </div>
            )}
            <div className="pt-8 border-t border-white/5 mt-4 space-y-4">
                <div className="flex justify-between items-center text-slate-400 font-bold px-1"><span>Total Monthly</span><span className="text-3xl font-black text-white">${Math.round(totalMonthly).toLocaleString()}</span></div>
                <p className="text-xs text-slate-600 font-semibold text-center">Estimates only. Not a quote.</p>
            </div>
        </div>
    </div>
  );
}

const ContactsList: React.FC = () => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [segmentFilter, setSegmentFilter] = useState('');
    const [tagsFilterInput, setTagsFilterInput] = useState('');
    const [nextTouchFilter, setNextTouchFilter] = useState<'all' | 'due' | 'upcoming'>('all');
    const [sortMode, setSortMode] = useState<'name' | 'next-touch'>('name');
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showImportMenu, setShowImportMenu] = useState(false);
    const navigate = useNavigate();

    const refreshContacts = async () => {
        const data = await dataService.getContacts();
        setContacts(data);
    };

    useEffect(() => {
        void refreshContacts();
    }, []);

    const availableSegments = Array.from(
        new Set<string>(contacts.map(c => c.segment).filter((segment): segment is string => Boolean(segment)))
    ).sort((a, b) => a.localeCompare(b));
    const tagFilters = tagsFilterInput
        .split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0);

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
            if (segmentFilter && (contact.segment || '').toLowerCase() !== segmentFilter.toLowerCase()) return false;
            if (tagFilters.length > 0) {
                const contactTags = (contact.tags || []).map(tag => tag.toLowerCase());
                const hasMatchingTag = tagFilters.some(tag => contactTags.includes(tag));
                if (!hasMatchingTag) return false;
            }
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
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowAddMenu(false)}></div>
                <div className="relative bg-slate-900 border border-white/10 w-full max-w-sm rounded-[2.5rem] p-8 space-y-4 shadow-2xl animate-in fade-in slide-in-from-bottom-10 duration-300">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">Add Contact</h3>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Choose your entry mode</p>
                  </div>
                  <button 
                    onClick={() => { navigate('/commute'); setShowAddMenu(false); }} 
                    className="w-full bg-gradient-to-r from-pink-500 to-purple-600 p-6 rounded-3xl flex items-center gap-4 group hover:scale-[1.02] transition-transform shadow-xl"
                  >
                     <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white">
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                     </div>
                     <div className="text-left">
                        <p className="text-white font-black uppercase text-xs tracking-widest">Brain Dump</p>
                        <p className="text-white/60 text-xs font-bold">Fast voice ingestion</p>
                     </div>
                  </button>
                  <button 
                    onClick={() => { navigate('/contacts/add'); setShowAddMenu(false); }} 
                    className="w-full bg-slate-800 border border-white/5 p-6 rounded-3xl flex items-center gap-4 group hover:bg-slate-700 transition-colors shadow-lg"
                  >
                     <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                     </div>
                     <div className="text-left">
                        <p className="text-white font-black uppercase text-xs tracking-widest">Manual Entry</p>
                        <p className="text-slate-500 text-xs font-bold">Text & details</p>
                     </div>
                  </button>
                  <button onClick={() => setShowAddMenu(false)} className="w-full text-slate-600 font-black uppercase text-xs tracking-[0.2em] pt-4">Cancel</button>
                </div>
              </div>
            )}

            <ImportContactsModal
                isOpen={showImportMenu}
                onClose={() => setShowImportMenu(false)}
                onImported={() => void refreshContacts()}
            />

            <div className="flex justify-between items-center mb-6 px-2">
                <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Contacts</h1>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowImportMenu(true)}
                        className="text-slate-300 text-xs font-black uppercase tracking-widest border border-slate-600/60 px-4 py-2 rounded-full hover:text-white hover:border-slate-400 transition-colors"
                    >
                        Import contacts (CSV or Google)
                    </button>
                    <button onClick={() => setShowAddMenu(true)} className="text-pink-500 text-xs font-black uppercase tracking-widest border border-pink-500/30 px-4 py-2 rounded-full hover:bg-pink-500/10 transition-colors">Record New</button>
                </div>
            </div>
            <input type="text" placeholder="Search contacts..." className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full mb-6" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Segment</label>
                    <select
                        className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full"
                        value={segmentFilter}
                        onChange={e => setSegmentFilter(e.target.value)}
                    >
                        <option value="">All segments</option>
                        {availableSegments.map(segment => (
                            <option key={segment} value={segment}>{segment}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Tags</label>
                    <input
                        type="text"
                        placeholder="Filter by tag (comma separated)"
                        className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full"
                        value={tagsFilterInput}
                        onChange={e => setTagsFilterInput(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Next touch</label>
                    <select
                        className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full"
                        value={nextTouchFilter}
                        onChange={e => setNextTouchFilter(e.target.value as 'all' | 'due' | 'upcoming')}
                    >
                        <option value="all">All</option>
                        <option value="due">Due or overdue</option>
                        <option value="upcoming">Upcoming</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Sort</label>
                    <select
                        className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full"
                        value={sortMode}
                        onChange={e => setSortMode(e.target.value as 'name' | 'next-touch')}
                    >
                        <option value="name">Name</option>
                        <option value="next-touch">Next touch</option>
                    </select>
                </div>
            </div>
            <div className="bg-slate-800/40 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-xl">
                {filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <p className="text-slate-500 font-medium">No contacts found.</p>
                    </div>
                ) : (
                    filtered.map(({ contact, nextTouchLabel, nextTouchStatus }) => (
                        <div key={contact.id} className="p-6 flex justify-between items-center border-b border-white/5 hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => navigate(`/contacts/${contact.id}`)}>
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center font-black text-indigo-400">
                                    {contact.full_name.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-bold text-white text-lg">{contact.full_name || 'Unnamed Contact'}</div>
                                    <div className="text-xs text-slate-500 flex flex-wrap gap-2">
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
                                <div className="text-xs font-black uppercase tracking-widest text-slate-600 group-hover:text-slate-400 transition-colors">{contact.mortgage_inference?.opportunity_tag || 'Standard'}</div>
                                <button 
                                    onClick={() => navigate(`/contacts/edit/${contact.id}`)}
                                    aria-label={`Edit ${contact.full_name || 'contact'}`}
                                    className="p-2 bg-slate-900 border border-white/5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
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

const Settings: React.FC = () => {
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
      { value: 'custom', label: 'Custom', description: 'Pick your own cadence' },
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
            <h1 className="text-2xl font-black text-white uppercase tracking-tighter mb-8">Preferences</h1>
            <div className="space-y-8">
                <section className="bg-slate-800/40 border border-white/5 p-8 rounded-[2.5rem] space-y-6">
                    <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">Co-Branding</h2>
                    <div className="flex items-center gap-6">
                      <div className="relative group">
                        <div className="w-20 h-20 rounded-full bg-slate-950 border border-white/5 flex items-center justify-center overflow-hidden">
                          {profile.headshot ? <img src={profile.headshot} className="w-full h-full object-cover" alt="Profile" /> : <div className="text-4xl font-black text-slate-800">?</div>}
                        </div>
                        <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 cursor-pointer rounded-full transition-opacity">
                          <input type="file" accept="image/*" className="hidden" onChange={handleHeadshotUpload} />
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        </label>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-black text-slate-500 uppercase mb-2 block">Agent Name</label>
                        <input type="text" value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm" />
                      </div>
                    </div>
                </section>
                <section className="bg-slate-800/40 border border-white/5 p-8 rounded-[2.5rem] space-y-6">
                   <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">Touch Cadence</h2>
                   <p className="text-xs text-slate-400 leading-relaxed">
                        Choose how often you want follow-ups. This cadence drives radar eligibility and the due-this-week count.
                   </p>
                   <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Cadence</label>
                   <select
                      value={profile.cadence_type ?? DEFAULT_PROFILE.cadence_type}
                      onChange={handleCadenceChange}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm"
                    >
                      {cadenceOptions.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </option>
                      ))}
                   </select>
                   {profile.cadence_type === 'custom' && (
                      <div className="space-y-2">
                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Custom days</label>
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
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm"
                        />
                      </div>
                   )}
                </section>
                <section className="bg-slate-800/40 border border-white/5 p-8 rounded-[2.5rem] space-y-4">
                   <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">AI Engine</h2>
                   <p className="text-xs text-slate-400 leading-relaxed">
                        AI requests are handled through the app account. There is no user-facing API key to manage.
                   </p>
                   <button onClick={save} className="w-full bg-indigo-600 text-white font-black uppercase text-xs py-4 rounded-xl">Save Preferences</button>
                </section>
                <button onClick={handleReset} className="w-full text-red-500 font-black uppercase text-xs tracking-widest pt-4">Delete All Data</button>
            </div>
        </div>
    );
};

const BottomNav: React.FC = () => {
    const location = useLocation();
    const isActive = (path: string) => location.pathname === path || (path === '/contacts' && location.pathname.startsWith('/contacts'));
    const navItemClass = (path: string) => `flex flex-col items-center justify-center gap-1 transition-all ${isActive(path) ? 'text-pink-500 scale-110' : 'text-slate-500 hover:text-slate-300'}`;

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-2xl border-t border-white/5 px-8 py-4 flex justify-between items-center max-w-2xl mx-auto rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.5)]">
            <Link to="/" className={navItemClass('/')}><svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 9.5V21h5v-6h5v6h5V9.5L12 2z"/></svg><span className="text-xs font-black uppercase tracking-tighter">Radar</span></Link>
            <Link to="/actions" className={navItemClass('/actions')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3l3 8 4-16 3 8h5" /></svg><span className="text-xs font-black uppercase tracking-tighter">Actions</span></Link>
            <Link to="/mort" className={navItemClass('/mort')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg><span className="text-xs font-black uppercase tracking-tighter">Mort</span></Link>
            <Link to="/contacts" className={navItemClass('/contacts')}><svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg><span className="text-xs font-black uppercase tracking-tighter">Contacts</span></Link>
            <Link to="/tools" className={navItemClass('/tools')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg><span className="text-xs font-black uppercase tracking-tighter">Calc</span></Link>
            <Link to="/settings" className={navItemClass('/settings')}><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg><span className="text-xs font-black uppercase tracking-tighter">Prefs</span></Link>
        </nav>
    );
};

const Layout: React.FC<{children: React.ReactNode}> = ({ children }) => {
    return (
        <div className="min-h-screen bg-[#020617] text-slate-200">
            <header className="px-8 py-6 flex items-center justify-center max-w-2xl mx-auto">
                <Link to="/" className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gradient-to-br from-pink-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-2xl">M</div>
                    <span className="text-2xl font-black text-white italic tracking-tighter">MORT</span>
                </Link>
            </header>
            <main className="relative z-0">
                <div className="fixed top-0 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-cyan-600/5 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                {children}
            </main>
            <BottomNav />
        </div>
    );
};

const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <div className="min-h-screen bg-[#020617] text-slate-200 flex flex-col">
            <header className="px-8 py-8 flex items-center justify-center">
                <Link to="/" className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-2xl">M</div>
                    <span className="text-2xl font-black text-white italic tracking-tighter">MORT</span>
                </Link>
            </header>
            <main className="relative flex-1 flex items-center justify-center px-6">
                <div className="fixed top-0 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-cyan-600/5 rounded-full blur-[120px] pointer-events-none -z-10"></div>
                <div className="w-full">
                    {children}
                </div>
            </main>
            <footer className="px-6 py-6 text-center text-sm text-slate-400">
                <span className="font-[cursive]">Brought to you by Justin Leffew at Stratton Mortgage</span>
            </footer>
        </div>
    );
};

const AuthCallback: React.FC = () => {
    return (
        <div className="max-w-md mx-auto px-6 py-16 text-center">
            <div className="w-14 h-14 mx-auto mb-6 rounded-2xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16m-6-6l6 6-6 6" />
                </svg>
            </div>
            <h2 className="text-xl font-black text-white uppercase tracking-widest">Completing sign in</h2>
            <p className="text-xs text-slate-400 mt-3">Hang tight while we connect your session.</p>
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
            <div className="max-w-2xl mx-auto px-6 pb-6 flex justify-end">
                <button
                    onClick={handleSignOut}
                    className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white transition"
                >
                    Sign Out
                </button>
            </div>
            <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/actions" element={<DailyActions />} />
                <Route path="/mort" element={<div className="max-w-2xl mx-auto h-[calc(100vh-140px)] p-4"><MortgageAssist /></div>} />
                <Route path="/commute" element={<CommuteMode />} />
                <Route path="/contacts" element={<ContactsList />} />
                <Route path="/contacts/add" element={<EditContact />} />
                <Route path="/contacts/edit/:id" element={<EditContact />} />
                <Route path="/contacts/:id" element={<ContactDetail />} />
                <Route path="/tools" element={<Calculator />} />
                <Route path="/settings" element={<Settings />} />
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
