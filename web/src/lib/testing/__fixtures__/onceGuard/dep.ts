// FIXTURE dependency — a dependency-free module for the bare-automock fixture.
// Not a real module: exists so `vi.mock('.../dep')` with no factory has
// something to automock without dragging real dependencies into the child run.
export function helper(): string {
  return 'real';
}

export function other(): number {
  return 1;
}
