import { useTranslations } from 'next-intl';
import type { Messages, NamespaceKeys, NestedKeyOf } from 'use-intl';

/**
 * Thin wrapper around next-intl's useTranslations.
 * Use this hook in all components to keep the dependency abstracted.
 *
 * The generic parameter `N` is forwarded to `useTranslations` so that callers
 * benefit from namespace-scoped key autocompletion and type-checked message
 * access. Without this forwarding the return type widens to the `any`-backed
 * default produced when no `AppConfig.Messages` augmentation is present.
 *
 * @param namespace - Optional message namespace (e.g. 'common', 'editor', 'auth')
 * @returns Translation function `t` scoped to the given namespace
 */
type MessageNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

export function useT<N extends MessageNamespace>(namespace?: N): ReturnType<typeof useTranslations<N>> {
  return useTranslations(namespace);
}
