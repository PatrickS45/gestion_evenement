// Composants d'interface partagés.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ParticipantType } from '../domain/model';
import { loadQrCode } from '../app/lazy';
import { GAUGE_LEVELS, gaugePercent, type GaugeLevel } from '../domain/gauge';
import { textOn } from '../domain/colors';

/** Type de participant : pastille de couleur + libellé (jamais la couleur seule, F-13). */
export function TypeBadge({ type, large = false }: { type: ParticipantType | null | undefined; large?: boolean }) {
  const t = type ?? { id: '', label: 'Sans type', color: '#8b91a0' };
  return (
    <span className={`badge${large ? ' badge-large' : ''}`}>
      <span className="badge-dot" style={{ background: t.color }} aria-hidden="true" />
      {t.label}
    </span>
  );
}

/** Bandeau plein aux couleurs du type, texte lisible calculé (écran de scan, F-54). */
export function TypeBanner({ type }: { type: ParticipantType }) {
  return (
    <p style={{ background: type.color, color: textOn(type.color), margin: 0, padding: '10px 16px', fontSize: 24, fontWeight: 800, letterSpacing: 1, textAlign: 'center', textTransform: 'uppercase' }}>
      {type.label}
    </p>
  );
}

export function GaugeBar({ present, capacity, level, height = 16, showLabel = true }: {
  present: number; capacity: number; level: GaugeLevel; height?: number; showLabel?: boolean;
}) {
  const l = GAUGE_LEVELS[level];
  const pct = gaugePercent(present, capacity);
  return (
    <div>
      <div className="gauge-track" style={{ height }} role="progressbar" aria-valuemin={0} aria-valuemax={capacity}
        aria-valuenow={present} aria-valuetext={`${present} personnes présentes pour une jauge de ${capacity} (${pct} %)`}>
        <div className="gauge-fill" style={{ width: `${Math.min(100, pct)}%`, background: l.color }} />
      </div>
      {showLabel && (
        <p style={{ color: l.color, fontWeight: 700, marginTop: 8 }}>
          <span aria-hidden="true">{l.icon} </span>{l.label} · {pct} % de la jauge
        </p>
      )}
    </div>
  );
}

export function QrImage({ text, size = 240, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    loadQrCode()
      .then((QRCode) => QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#1c1d22', light: '#ffffff' } }))
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => setSrc(''));
    return () => { alive = false; };
  }, [text, size]);
  return src
    ? <img src={src} width={size} height={size} alt={label} style={{ display: 'block' }} />
    : <div style={{ width: size, height: size, background: 'var(--line-soft)', borderRadius: 8 }} aria-hidden="true" />;
}

/** Fenêtre modale native (gestion du focus et de la touche Échap par le navigateur). */
export function Modal({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="modal-title" className={className}>
      {open && (
        <div className="dialog-body">
          <div className="row-between">
            <h2 id="modal-title" style={{ fontSize: 18 }}>{title}</h2>
            <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Fermer</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Diagramme en colonnes, une série (affluence, présence). */
export function ColumnChart({ values, labels, highlight, summary, format = String, height = 200 }: {
  values: number[]; labels: string[]; highlight?: number; summary: string; format?: (v: number) => string; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Dessiné à la largeur réelle : les libellés gardent leur taille sur téléphone
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => { if (entry) setW(Math.max(280, Math.round(entry.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const M = { top: 18, right: 8, bottom: 26, left: 36 };
  const plotW = W - M.left - M.right, plotH = height - M.top - M.bottom;
  const rawMax = Math.max(1, ...values);
  const step = rawMax <= 4 ? 1 : 10 ** Math.floor(Math.log10(rawMax / 2));
  const max = Math.ceil(rawMax / (step * 2)) * step * 2;
  const slot = plotW / Math.max(1, values.length);
  const bar = Math.max(2, Math.min(22, slot - 2));
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const every = Math.max(1, Math.ceil(values.length / Math.max(3, Math.floor(W / 80))));
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={summary} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
        {[0, max / 2, max].map((t) => (
          <g key={t} aria-hidden="true">
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="#efefeb" />
            <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#4a4f5c">{format(t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const h = (v / max) * plotH;
          const x = M.left + i * slot + (slot - bar) / 2;
          const r = Math.min(4, bar / 2, h);
          return (
            <g key={i} aria-hidden="true">
              {h > 0 && (
                <path d={`M${x},${y(0)}V${y(v) + r}Q${x},${y(v)} ${x + r},${y(v)}H${x + bar - r}Q${x + bar},${y(v)} ${x + bar},${y(v) + r}V${y(0)}Z`}
                  fill={i === highlight ? '#16181d' : '#8a90a0'} opacity={hover === null || hover === i ? 1 : 0.5} />
              )}
              {i === highlight && h > 0 && <text x={x + bar / 2} y={y(v) - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1c1d22">{format(v)}</text>}
              {i % every === 0 && <text x={M.left + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="#4a4f5c">{labels[i]}</text>}
              <rect x={M.left + i * slot} y={M.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div aria-hidden="true" style={{
          position: 'absolute', top: 0, left: `${((M.left + hover * slot + slot / 2) / W) * 100}%`,
          transform: hover > values.length / 2 ? 'translateX(-100%)' : undefined,
          background: '#1c1d22', color: '#fff', fontSize: 13, padding: '6px 10px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          <strong>{labels[hover]}</strong> · {format(values[hover] ?? 0)}
        </div>
      )}
    </div>
  );
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSlug(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'evenement';
}
