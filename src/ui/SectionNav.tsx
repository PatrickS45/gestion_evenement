// Sommaire d'une longue page : colonne fixe sur ordinateur, rangée défilante sur téléphone.
// La section visible est mise en évidence.
import { useEffect, useState, type ReactNode } from 'react';

/** Fait défiler jusqu'à un élément sans toucher à l'ancre de l'URL, qui porte la navigation. */
export function scrollToId(id: string) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  // Le focus suit, pour le clavier et les lecteurs d'écran
  if (el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el?.focus({ preventScroll: true });
}

/** Lien vers une section de la même page. */
export function InPageLink({ to, children }: { to: string; children: ReactNode }) {
  return <a href={`#${to}`} onClick={(e) => { e.preventDefault(); scrollToId(to); }}>{children}</a>;
}

export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    // Section active : la dernière dont le titre est passé sous la barre d'application
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = sections[0]?.id ?? '';
      for (const sec of sections) {
        const el = document.getElementById(sec.id);
        if (el && el.getBoundingClientRect().top <= 140) current = sec.id;
      }
      // En bas de page, la dernière section est forcément la bonne
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1]?.id ?? current;
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [sections]);

  return (
    <nav className="section-nav no-print" aria-label="Sections de la page">
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`} aria-current={s.id === active ? 'true' : undefined}
          onClick={(e) => { e.preventDefault(); scrollToId(s.id); }}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
