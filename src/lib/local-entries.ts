import type { EntryDestination, TimelineEntry } from '$lib/entry';

const DATABASE_NAME = 'trace';
const DATABASE_VERSION = 1;
const ENTRY_STORE = 'entries';

function openDatabase() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(ENTRY_STORE)) {
				const store = database.createObjectStore(ENTRY_STORE, { keyPath: 'id' });
				store.createIndex('capturedAt', 'capturedAt');
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function complete(transaction: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

function normalizeEntry(entry: TimelineEntry): TimelineEntry {
	const destination: EntryDestination = entry.destination || (entry.calendar ? 'Calendar' : entry.reminder ? 'Reminder' : 'Timeline');
	const scheduledTime = entry.scheduledTime || entry.eventTime || undefined;
	return {
		...entry,
		destination,
		scheduledTime,
		calendar: destination === 'Calendar',
		reminder: destination === 'Reminder',
		externalProvider:
			entry.externalProvider ||
			(destination === 'Calendar' ? 'Google Calendar' : destination === 'Reminder' ? (scheduledTime ? 'Google Calendar' : 'Google Tasks') : undefined),
		syncStatus: entry.syncStatus || (destination === 'Timeline' ? 'Local' : 'Ready')
	};
}

export async function listLocalEntries() {
	const database = await openDatabase();
	const transaction = database.transaction(ENTRY_STORE, 'readonly');
	const request = transaction.objectStore(ENTRY_STORE).getAll();
	const entries = await new Promise<TimelineEntry[]>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result as TimelineEntry[]);
		request.onerror = () => reject(request.error);
	});
	await complete(transaction);
	database.close();
	return entries
		.map(normalizeEntry)
		.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
}

export async function saveLocalEntry(entry: TimelineEntry) {
	await saveLocalEntries([entry]);
}

export async function saveLocalEntries(entries: TimelineEntry[]) {
	const database = await openDatabase();
	try {
		// Svelte state is proxy-based. IndexedDB only accepts structured-cloneable plain data.
		const serializableEntries = JSON.parse(JSON.stringify(entries.map(normalizeEntry))) as TimelineEntry[];
		const transaction = database.transaction(ENTRY_STORE, 'readwrite');
		const store = transaction.objectStore(ENTRY_STORE);
		for (const entry of serializableEntries) store.put(entry);
		await complete(transaction);
	} finally {
		database.close();
	}
}

export async function deleteLocalEntry(id: string) {
	const database = await openDatabase();
	const transaction = database.transaction(ENTRY_STORE, 'readwrite');
	transaction.objectStore(ENTRY_STORE).delete(id);
	await complete(transaction);
	database.close();
}
