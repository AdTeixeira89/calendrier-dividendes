import { FirebaseError } from 'firebase/app'

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Adresse e-mail invalide.',
  'auth/missing-email': 'Veuillez saisir votre adresse e-mail.',
  'auth/missing-password': 'Veuillez saisir votre mot de passe.',
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
  'auth/user-not-found': 'E-mail ou mot de passe incorrect.',
  'auth/user-disabled': 'Ce compte a été désactivé.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse e-mail.',
  'auth/weak-password': 'Mot de passe trop faible (8 caractères minimum).',
  'auth/password-does-not-meet-requirements': 'Le mot de passe ne respecte pas les exigences de sécurité.',
  'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/network-request-failed': 'Connexion impossible. Vérifiez votre réseau.',
  'permission-denied': "Action non autorisée. Le code d'invitation est peut-être expiré ou déjà utilisé.",
  unavailable: 'Service momentanément indisponible. Réessayez.',
  'failed-precondition': "Configuration de la base de données incomplète (index manquant). Signalez ce message.",
}

/** Message d'erreur lisible en français à partir d'une erreur Firebase. */
export function toUserMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    // Erreurs des Cloud Functions (askFinance…) : message déjà rédigé en français côté serveur.
    if (error.code.startsWith('functions/')) return error.message
    return MESSAGES[error.code] ?? `Une erreur est survenue (${error.code}).`
  }
  if (error instanceof Error && error.message) return error.message
  return 'Une erreur inattendue est survenue.'
}
