import { Contact } from '../types';

const DEFAULT_CADENCE_DAYS = 90;

export type NextTouchStatus = 'overdue' | 'due' | 'upcoming';

const getValidDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getCadenceDaysForContact = (contact: Pick<Contact, 'cadence_days'>) => {
  const cadenceDays = contact.cadence_days ?? DEFAULT_CADENCE_DAYS;
  return cadenceDays > 0 ? cadenceDays : DEFAULT_CADENCE_DAYS;
};

export const getNextTouchDate = (contact: Pick<Contact, 'last_contacted_at' | 'sale_date' | 'cadence_days'>) => {
  const baseDate = getValidDate(contact.last_contacted_at) ?? getValidDate(contact.sale_date);
  if (!baseDate) return null;
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + getCadenceDaysForContact(contact));
  return nextDate;
};

export const getNextTouchStatus = (nextDate: Date | null, now = new Date()): NextTouchStatus => {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (!nextDate) return 'due';
  if (nextDate < startOfToday) return 'overdue';
  if (nextDate < endOfToday) return 'due';
  return 'upcoming';
};

export const formatShortDate = (date: Date | null) => {
  if (!date) return 'Today';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
