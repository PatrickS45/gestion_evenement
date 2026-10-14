// Personnalisation des pages publiques (F-14) : couleurs appliquées, logo, réglage par l'organisateur.
import { useState, type CSSProperties } from 'react';
import {
  appliedColor, brandPalette, LOGO_MAX_HEIGHT, LOGO_MAX_LENGTH, LOGO_MAX_WIDTH, MIN_CONTRAST, type Branding,
} from '../domain/branding';

/** Variables de couleur des pages publiques ; sans couleur choisie, celles de l'application. */
export function brandStyle(b: Branding | undefined): CSSProperties | undefined {
  const p = b && brandPalette(b);
  if (!p) return undefined;
  return { '--accent': p.accent, '--accent-soft': p.accentSoft, '--brand': p.page } as CSSProperties;
}

export function BrandLogo({ branding, organizer, center = false }: { branding: Branding | undefined; organizer: string; center?: boolean }) {
  if (!branding?.logo) return null;
  return <img src={branding.logo} alt={`Logo de ${organizer || "l'organisateur"}`} style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain', alignSelf: center ? 'center' : 'flex-start' }} />;
}

/** Réduit le logo sur le poste, en image intégrée : WebP si possible, sinon PNG, puis JPEG si trop lourd. */
export async function resizeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choisissez une image PNG, JPEG ou WebP.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_MAX_WIDTH / bitmap.width, LOGO_MAX_HEIGHT / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const [type, quality] of [['image/webp', 0.9], ['image/png', undefined], ['image/jpeg', 0.85], ['image/jpeg', 0.6]] as const) {
    const url = canvas.toDataURL(type, quality);
    if (url.startsWith(`data:${type}`) && url.length <= LOGO_MAX_LENGTH) return url;
  }
  throw new Error('Image trop détaillée, même réduite : essayez un logo plus simple.');
}

/** Réglage de la couleur et du logo, avec aperçu et contrôle de lisibilité. */
export function BrandingEditor({ value, onSave, disabled }: { value: Branding; onSave: (b: Branding) => Promise<void>; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const applied = draft.color ? appliedColor(draft.color) : null;

  const pickLogo = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    try { setDraft({ ...draft, logo: await resizeLogo(file) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Image illisible'); }
  };

  return (
    <div className="stack">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="br-own">Couleur principale</label>
          <label className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer' }}>
            <input id="br-own" type="checkbox" checked={!!draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.checked ? '#2459c4' : null })} disabled={disabled} />
            <span>Utiliser la couleur de l'organisateur</span>
          </label>
          {draft.color && (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="color" aria-label="Couleur choisie" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} disabled={disabled}
                style={{ width: 56, height: 44, padding: 0, border: '1px solid var(--line)', borderRadius: 8 }} />
              <code>{draft.color}</code>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="br-logo">Logo (PNG, JPEG ou WebP)</label>
          <input id="br-logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
            onChange={(e) => void pickLogo(e.target.files?.[0])} />
          <span className="hint">Réduit automatiquement à {LOGO_MAX_WIDTH} × {LOGO_MAX_HEIGHT} pixels au plus.</span>
          {draft.logo && <div><button type="button" className="btn btn-ghost btn-small" onClick={() => setDraft({ ...draft, logo: null })}>Retirer le logo</button></div>}
        </div>
      </div>

      {applied && (
        <p className={applied.adjusted ? 'notice notice-warn' : 'small'} role="status">
          {applied.adjusted
            ? <>Couleur trop claire pour une lecture suffisante : elle est assombrie en <code>{applied.color}</code> (contraste {applied.contrast.toFixed(1).replace('.', ',')}:1, {MIN_CONTRAST.toString().replace('.', ',')}:1 requis).</>
            : <>Contraste {applied.contrast.toFixed(1).replace('.', ',')}:1 : lecture suffisante ({MIN_CONTRAST.toString().replace('.', ',')}:1 requis).</>}
        </p>
      )}

      <div aria-hidden="true" className="public" style={{ ...brandStyle(draft), minHeight: 0, borderRadius: 12, padding: 16 }}>
        <div className="public-card stack" style={{ margin: 0 }}>
          <BrandLogo branding={draft} organizer="" />
          <p style={{ fontWeight: 700 }}>Aperçu du formulaire</p>
          <p className="notice notice-info">Message d'information</p>
          <span className="btn" style={{ alignSelf: 'flex-start' }}>Je m'inscris</span>
        </div>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      <div><button type="button" className="btn" disabled={disabled} onClick={() => { setError(''); onSave(draft).catch((err) => setError(err instanceof Error ? err.message : 'Enregistrement impossible')); }}>Enregistrer l'apparence</button></div>
    </div>
  );
}
