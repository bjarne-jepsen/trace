import type { EntryCategory, TimelineEntry } from './entry';
import { addDays, localDateKey, parseDateKey } from './dates';

export type InsightRange = 7 | 30 | 'all';

export const INSIGHT_CATEGORIES: EntryCategory[] = ['Wellbeing', 'Habit', 'Reminder', 'Place', 'Social', 'Note'];

const MAX_WEEK_BARS = 26;

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

export function activityMinutesOf(entry: TimelineEntry) {
	if (entry.category !== 'Habit') return undefined;
	if (typeof entry.activityMinutes === 'number') return entry.activityMinutes;
	const legacy = Number(entry.detail.match(/(\d+)\s*minutes?/i)?.[1]);
	return Number.isFinite(legacy) && legacy > 0 ? legacy : undefined;
}

/** A planned session has not happened yet, even if its date has passed. */
function isDoneActivity(entry: TimelineEntry) {
	return entry.category === 'Habit' && entry.status !== 'Planned' && entry.status !== 'Tentative';
}

function average(values: number[]) {
	return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export type InsightBar = { key: string; label: string; count: number; current: boolean };

export function computeInsights(timeline: TimelineEntry[], range: InsightRange, todayKey: string) {
	const today = parseDateKey(todayKey);
	const past = timeline.filter((entry) => entryDateKey(entry) <= todayKey);
	const earliest = past.reduce((first, entry) => (entryDateKey(entry) < first ? entryDateKey(entry) : first), todayKey);
	const startKey = range === 'all' ? earliest : localDateKey(addDays(today, -(range - 1)));
	const entries = past.filter((entry) => entryDateKey(entry) >= startKey);
	const previous =
		range === 'all'
			? []
			: past.filter((entry) => {
					const key = entryDateKey(entry);
					return key < startKey && key >= localDateKey(addDays(today, -(range * 2 - 1)));
				});

	const activities = entries.filter(isDoneActivity);
	const activityMinutes = activities.reduce((total, entry) => total + (activityMinutesOf(entry) || 0), 0);
	const scores = entries.map(wellbeingScoreOf).filter((score): score is number => score !== undefined);
	const previousScores = previous.map(wellbeingScoreOf).filter((score): score is number => score !== undefined);
	const averageWellbeing = average(scores);
	const previousWellbeing = average(previousScores);
	const reminders = entries.filter((entry) => entry.destination === 'Reminder');
	// A social plan whose day has passed most likely happened; a tentative one may not have.
	const social = entries.filter((entry) => entry.category === 'Social' && entry.status !== 'Tentative').length;
	const previousSocial = previous.filter((entry) => entry.category === 'Social' && entry.status !== 'Tentative').length;
	const activeDays = new Set(entries.map(entryDateKey)).size;

	const bars: InsightBar[] = [];
	if (range !== 'all') {
		for (let offset = range - 1; offset >= 0; offset -= 1) {
			const date = addDays(today, -offset);
			const key = localDateKey(date);
			const everyFifth = range === 30 && (offset % 5 === 0);
			bars.push({
				key,
				label:
					range === 7
						? new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' }).format(date)
						: everyFifth
							? String(date.getDate())
							: '',
				count: entries.filter((entry) => entryDateKey(entry) === key).length,
				current: offset === 0
			});
		}
	} else {
		const monday = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));
		const thisWeek = monday(today);
		const firstWeek = monday(parseDateKey(earliest));
		const weeks = Math.min(MAX_WEEK_BARS, Math.round((thisWeek.getTime() - firstWeek.getTime()) / (7 * 86400000)) + 1);
		for (let index = weeks - 1; index >= 0; index -= 1) {
			const start = addDays(thisWeek, -7 * index);
			const startKey = localDateKey(start);
			const endKey = localDateKey(addDays(start, 6));
			bars.push({
				key: startKey,
				label: start.getDate() <= 7 ? new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(start) : '',
				count: entries.filter((entry) => {
					const key = entryDateKey(entry);
					return key >= startKey && key <= endKey;
				}).length,
				current: index === 0
			});
		}
	}

	const periodName = range === 'all' ? 'in total' : `in the last ${range} days`;
	const stories = [
		entries.length
			? `${plural(entries.length, 'trace', 'traces')} across ${plural(activeDays, 'day', 'days')} ${periodName}.`
			: `Nothing captured ${periodName} yet.`,
		activities.length
			? `${plural(activities.length, 'activity', 'activities')} done${activityMinutes ? `, ${activityMinutes} minutes in all` : ''}.`
			: 'No exercise or habit activity logged.',
		range === 'all' || social === previousSocial
			? `${plural(social, 'social moment', 'social moments')} ${periodName}.`
			: `${plural(social, 'social moment', 'social moments')}, ${social > previousSocial ? 'more' : 'fewer'} than the ${range} days before.`,
		averageWellbeing === null
			? 'Say a score like “6 out of 10” in wellbeing check-ins to see how they change.'
			: `Wellbeing averaged ${averageWellbeing.toFixed(1)} / 10 over ${plural(scores.length, 'scored check-in', 'scored check-ins')}${
					previousWellbeing !== null && previousScores.length >= 2 && scores.length >= 2
						? `, ${averageWellbeing > previousWellbeing ? 'up' : averageWellbeing < previousWellbeing ? 'down' : 'unchanged'} from ${previousWellbeing.toFixed(1)}`
						: ''
				}.`
	];

	return {
		entries,
		startKey,
		activeDays,
		bars,
		weeksCapped: range === 'all' && bars.length === MAX_WEEK_BARS && firstWeekBefore(earliest, bars[0]?.key),
		stories,
		averageWellbeing,
		wellbeingCount: scores.length,
		activityCount: activities.length,
		activityMinutes,
		reminderCount: reminders.length,
		remindersDone: reminders.filter((entry) => entry.status === 'Completed').length,
		categoryCounts: INSIGHT_CATEGORIES.map((category) => {
			const count = entries.filter((entry) => entry.category === category).length;
			return { category, count, percentage: entries.length ? Math.round((count / entries.length) * 100) : 0 };
		})
	};
}

function firstWeekBefore(earliest: string, firstBar?: string) {
	return Boolean(firstBar && earliest < firstBar);
}
