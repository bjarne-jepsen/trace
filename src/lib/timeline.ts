import type { EntryCategory, TimelineEntry } from './entry';
import { localDateKey } from './dates';

/** Categories that live on the timeline. Shopping items are a list, not traces. */
export const TIMELINE_CATEGORIES: EntryCategory[] = ['Wellbeing', 'Habit', 'Reminder', 'Place', 'Social', 'Person', 'Note'];

export function entryCaptureDateKey(entry: TimelineEntry) {
	return localDateKey(new Date(entry.capturedAt));
}

/** The day an entry belongs to: when it was planned for, otherwise when it was captured. */
export function entryDateKey(entry: TimelineEntry) {
	return entry.scheduledDate || entryCaptureDateKey(entry);
}

/** Structured score first; entries saved before scores were stored only have it in the detail text. */
export function wellbeingScoreOf(entry: TimelineEntry) {
	if (entry.category !== 'Wellbeing') return undefined;
	if (typeof entry.wellbeingScore === 'number') return entry.wellbeingScore;
	const legacy = Number(entry.detail.match(/(\d+(?:\.\d+)?)\s*\/\s*10/)?.[1]);
	return Number.isFinite(legacy) && legacy >= 0 && legacy <= 10 ? legacy : undefined;
}
