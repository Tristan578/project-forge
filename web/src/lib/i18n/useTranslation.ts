import { useTranslations } from 'next-intl';

/**
 * Thin wrapper around next-intl's useTranslations.
 * Use this hook in all components to keep the dependency abstracted.
 *
 * @param namespace - Optional message namespace (e.g. 'common', 'editor', 'auth')
 * @returns Translation function `t` scoped to the given namespace
 */
export function useT(namespace?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useTranslations(namespace as any);
}
