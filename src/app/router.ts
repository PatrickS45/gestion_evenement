// Navigation par l'ancre de l'URL (#/…) : fonctionne sans configuration serveur
// et garde les jetons des pages publiques hors des journaux du serveur.
import { useEffect, useState } from 'react';

export function parseRoute(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parseRoute(hash);
}

export function href(...parts: string[]): string {
  return '#/' + parts.map(encodeURIComponent).join('/');
}

export function navigate(...parts: string[]): void {
  window.location.hash = href(...parts);
}

/** Adresse absolue d'une page publique (formulaire, page d'accès), à partager. */
export function publicUrl(...parts: string[]): string {
  return `${window.location.origin}${window.location.pathname}${href(...parts)}`;
}
