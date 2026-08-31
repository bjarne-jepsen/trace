import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';

export function createSupabaseClient() {
	const url = env.PUBLIC_SUPABASE_URL;
	const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

	if (!url || !publishableKey) return null;
	return createBrowserClient(url, publishableKey);
}

export function hasSupabaseConfiguration() {
	return Boolean(env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
