// Modules chargés à la demande : l'application démarre plus vite sur le téléphone d'un agent.
// Le service worker garde tous les fichiers de l'application (public/sw.js) : un poste coupé du réseau
// peut activer sa caméra ou ouvrir un écran qu'il n'avait encore jamais ouvert.
import { lazy } from 'react';

const loaders = {
  camera: () => import('../ui/CameraScanner'),
  participants: () => import('../pages/Participants'),
  settings: () => import('../pages/Settings'),
  exports: () => import('../pages/Exports'),
  members: () => import('../pages/Members'),
  dataProtection: () => import('../pages/DataProtection'),
  qrcode: () => import('qrcode'),
};

export const LazyCameraScanner = lazy(() => loaders.camera().then((m) => ({ default: m.CameraScanner })));
export const LazyParticipants = lazy(() => loaders.participants().then((m) => ({ default: m.Participants })));
export const LazySettings = lazy(() => loaders.settings().then((m) => ({ default: m.Settings })));
export const LazyExports = lazy(() => loaders.exports().then((m) => ({ default: m.Exports })));
export const LazyMembers = lazy(() => loaders.members().then((m) => ({ default: m.Members })));
export const LazyDataProtection = lazy(() => loaders.dataProtection().then((m) => ({ default: m.DataProtection })));

export const loadQrCode = () => loaders.qrcode().then((m) => m.default);
