// Calendar-day helpers. Dates are handled at local noon so daylight-saving shifts never move a day.

export function localDateKey(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number) {
	const result = new Date(date);
	result.setHours(12, 0, 0, 0);
	result.setDate(result.getDate() + days);
	return result;
}

export function dateKeyAfter(days: number, from = new Date()) {
	return localDateKey(addDays(from, days));
}

export function parseDateKey(key: string) {
	return new Date(`${key}T12:00:00`);
}

export function describeSchedule(scheduledDate: string | undefined, scheduledTime: string | undefined, todayKey: string) {
	if (!scheduledDate) return scheduledTime ? `At ${scheduledTime}` : 'No date';
	return [relativeDayLabel(scheduledDate, todayKey), scheduledTime].filter(Boolean).join(' · ');
}

export function relativeDayLabel(key: string, todayKey: string) {
	const today = parseDateKey(todayKey);
	if (key === todayKey) return 'Today';
	if (key === localDateKey(addDays(today, 1))) return 'Tomorrow';
	if (key === localDateKey(addDays(today, -1))) return 'Yesterday';
	const date = parseDateKey(key);
	if (Number.isNaN(date.getTime())) return key;
	return new Intl.DateTimeFormat('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
	}).format(date);
}
