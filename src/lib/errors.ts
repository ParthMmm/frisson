export function isAbortError(error: unknown) {
	return (
		error instanceof DOMException ||
		(typeof error === 'object' && error !== null && 'name' in error)
	) && (error as { name?: unknown }).name === 'AbortError';
}
