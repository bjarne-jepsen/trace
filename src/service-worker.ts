/// <reference lib="webworker" />
import { base, build, files, prerendered, version } from '$service-worker';

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const CACHE = `trace-${version}`;
const FONT_CACHE = 'trace-fonts';
// The prerendered page is the app shell. Without it the installed app cannot start offline.
const SHELL = `${base}/`;
const ASSETS = [...new Set([...build, ...files, ...prerendered, SHELL])];
const IMMUTABLE = new Set(build);
const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== FONT_CACHE).map((key) => caches.delete(key))))
	);
});

async function fromCache(request: Request | string, options?: CacheQueryOptions) {
	return (await caches.open(CACHE)).match(request, options);
}

async function networkFirst(request: Request, fallback: () => Promise<Response | undefined>) {
	try {
		return await fetch(request);
	} catch {
		return (await fallback()) || Response.error();
	}
}

async function staleWhileRevalidate(request: Request) {
	const cache = await caches.open(FONT_CACHE);
	const cached = await cache.match(request);
	const refresh = fetch(request)
		.then((response) => {
			if (response.ok) void cache.put(request, response.clone());
			return response;
		})
		.catch(() => undefined);
	return cached || (await refresh) || Response.error();
}

worker.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);

	if (FONT_ORIGINS.has(url.origin)) {
		event.respondWith(staleWhileRevalidate(request));
		return;
	}
	if (url.origin !== worker.location.origin) return;

	// Hashed build files never change, so the cache can answer first.
	if (IMMUTABLE.has(url.pathname)) {
		event.respondWith(fromCache(url.pathname).then((cached) => cached || fetch(request)));
		return;
	}

	// Pages: prefer the network for updates, fall back to the shell that matches the cached build.
	// Query strings such as "?source=pwa" or "?capture=voice" all open the same page.
	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request, () => fromCache(SHELL)));
		return;
	}

	event.respondWith(networkFirst(request, () => fromCache(request, { ignoreSearch: true })));
});
