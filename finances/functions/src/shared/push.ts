/**
 * Clé publique VAPID (Web Push), partagée par l'application (abonnement de
 * l'appareil) et la Cloud Function (signature des envois). Publique par
 * nature ; la clé privée correspondante est dans Secret Manager
 * (`VAPID_PRIVATE_KEY`).
 */
export const VAPID_PUBLIC_KEY = 'BFfiW8CSPxMddbLFZb1bb4GRlbeuUCH39sMYKRG0fmiVM_W_W9kDojmKBUQ1rPR8meaaanaY9-qABzIqGLZ4RMo'

/** Contenu d'une notification, lu par le service worker (public/push-sw.js). */
export interface PushPayload {
  title: string
  body: string
  /** Page ouverte au toucher de la notification. */
  url: string
  /** Une notification de même tag remplace la précédente. */
  tag: string
}
