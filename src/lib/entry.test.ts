// @ts-nocheck -- This file runs in Bun's test runtime, outside the browser bundle.
import { describe, expect, test } from 'bun:test';
import { interpretEntry } from './entry';

function localDateAfter(days: number) {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() + days);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextWeekday(day: number) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	let daysAhead = (day - today.getDay() + 7) % 7;
	if (daysAhead === 0) daysAhead = 7;
	return localDateAfter(daysAhead);
}

function weekdayInNextCalendarWeek(day: number) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const daysUntilMonday = ((8 - today.getDay()) % 7) || 7;
	const daysAfterMonday = (day + 6) % 7;
	return localDateAfter(daysUntilMonday + daysAfterMonday);
}

describe('multiple upcoming weekdays', () => {
	test('creates one concrete date for every English weekday mentioned', () => {
		const entry = interpretEntry('Going to the gym Monday, Wednesday and Saturday');
		const dates = [nextWeekday(1), nextWeekday(3), nextWeekday(6)].sort();
		expect(entry.category).toBe('Habit');
		expect(entry.destination).toBe('Calendar');
		expect(entry.scheduledDate).toBe(dates[0]);
		expect(entry.scheduledDates).toEqual(dates);
	});

	test('understands the equivalent Danish weekday list', () => {
		const entry = interpretEntry('Jeg skal i træningscenter mandag, onsdag og lørdag');
		expect(entry.category).toBe('Habit');
		expect(entry.scheduledDates).toEqual([nextWeekday(1), nextWeekday(3), nextWeekday(6)].sort());
	});

	test('applies a shared next-week qualifier to every weekday in the list', () => {
		const entry = interpretEntry('Training next week: Monday, Wednesday and Friday');
		expect(entry.scheduledDate).toBe(weekdayInNextCalendarWeek(1));
		expect(entry.scheduledDates).toEqual([
			weekdayInNextCalendarWeek(1),
			weekdayInNextCalendarWeek(3),
			weekdayInNextCalendarWeek(5)
		]);
	});

	test('applies the equivalent Danish next-week qualifier to the whole list', () => {
		const entry = interpretEntry('Træning næste uge: mandag, onsdag og fredag');
		expect(entry.scheduledDates).toEqual([
			weekdayInNextCalendarWeek(1),
			weekdayInNextCalendarWeek(3),
			weekdayInNextCalendarWeek(5)
		]);
	});
});

describe('Danish entry interpretation', () => {
	test('understands reminders in weeks and 24-hour times', () => {
		const entry = interpretEntry('Mind mig om at ringe til tandlægen om to uger klokken 14.30');
		expect(entry.category).toBe('Reminder');
		expect(entry.destination).toBe('Reminder');
		expect(entry.scheduledDate).toBe(localDateAfter(14));
		expect(entry.scheduledTime).toBe('14:30');
	});

	test('understands completed durations expressed in Danish words', () => {
		const entry = interpretEntry('Jeg trænede i halvanden time i går');
		expect(entry.category).toBe('Habit');
		expect(entry.destination).toBe('Timeline');
		expect(entry.durationMinutes).toBeUndefined();
		expect(entry.detail).toBe('90 minutes');
		expect(entry.status).toBe('Completed');
	});

	test('understands Danish weekdays, people, and spoken clock times', () => {
		const entry = interpretEntry('Middag med Michael og Jennifer næste fredag klokken atten');
		expect(entry.category).toBe('Social');
		expect(entry.destination).toBe('Calendar');
		expect(entry.scheduledTime).toBe('18:00');
		expect(entry.people).toEqual(['Michael', 'Jennifer']);
	});

	test('understands Danish day and minute units', () => {
		const entry = interpretEntry('Løb i 45 minutter i dag');
		expect(entry.category).toBe('Habit');
		expect(entry.scheduledDate).toBe(localDateAfter(0));
		expect(entry.detail).toBe('45 minutes');
	});
});
