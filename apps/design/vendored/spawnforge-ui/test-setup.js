import '@testing-library/jest-dom/vitest';
// jsdom does not implement window.matchMedia — provide a default stub.
// Tests that need specific matchMedia behavior can override with vi.spyOn().
if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
            addListener: () => undefined,
            removeListener: () => undefined,
        }),
    });
}
