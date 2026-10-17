import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Renders a page into <div id="root">. The root div has `display: contents` (set in each index.html),
 * so for layout and CSS the page's elements behave as direct children of <body>, like before.
 */
export function mount(page: ReactNode): void {
	const root = document.getElementById('root');
	if (!root) throw new Error('#root not found');
	createRoot(root).render(<StrictMode>{page}</StrictMode>);
}
