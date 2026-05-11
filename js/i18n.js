/**
 * WorkProof — i18n (EN / ES)
 * Toggle with toggleLanguage() or the flag button in the UI
 */

const TRANSLATIONS = {
  en: {
    // Landing
    'Connect Phantom to continue': 'Connect Phantom to continue',
    'Contribution': 'Contribution',
    'verified on-chain': 'verified on-chain',
    'Peer-validated, privacy-first recognition. Company admins set the challenge. Competitors prove their work. Blockchain settles the reward.':
      'Peer-validated, privacy-first recognition. Company admins set the challenge. Competitors prove their work. Blockchain settles the reward.',
    'Admin': 'Admin',
    'Competitor': 'Competitor',
    'Create a challenge, set the reward pool, configure metrics and deploy on-chain.':
      'Create a challenge, set the reward pool, configure metrics and deploy on-chain.',
    'Browse open challenges, join on-chain, submit daily proof of work and vote on peers.':
      'Browse open challenges, join on-chain, submit daily proof of work and vote on peers.',
    'Create challenge': 'Create challenge',
    'Join challenge': 'Join challenge',
    // Wizard
    'Configure your contribution challenge': 'Configure your contribution challenge',
    'Who\'s competing?': "Who's competing?",
    'What gets measured?': 'What gets measured?',
    'Set the prize pool': 'Set the prize pool',
    'Ready to deploy': 'Ready to deploy',
    // Dashboard
    'Leaderboard': 'Leaderboard',
    'Vote inbox': 'Vote inbox',
    'Badges': 'Badges',
    'My profile': 'My profile',
    'Chain status': 'Chain status',
    'Settings': 'Settings',
    'Yes, good day': 'Yes, good day',
    'Not really': 'Not really',
    'Skip': 'Skip',
    'Connect Calendar': 'Connect Calendar',
    'Connect': 'Connect',
    // Competitor
    'Open challenges': 'Open challenges',
    'Browse and join on-chain contribution challenges': 'Browse and join on-chain contribution challenges',
    'Join challenge →': 'Join challenge →',
    'Preview': 'Preview',
    'My proof of work': 'My proof of work',
    'Leave challenge': 'Leave challenge',
    'Proof of work': 'Proof of work',
    'Set your display name': 'Set your display name',
    'First name': 'First name',
    'Last name': 'Last name',
    'Skip for now': 'Skip for now',
    'Join challenge →': 'Join challenge →',
    'Was this a productive day?': 'Was this a productive day?',
    'Cannot vote on your own activity': 'Cannot vote on your own activity',
    'Today\'s computed score': "Today's computed score",
    'Commit score on-chain': 'Commit score on-chain',
    'Committed history': 'Committed history',
    'Display name': 'Display name',
    'Save profile': 'Save profile',
    'On-chain proof': 'On-chain proof',
    'Participants': 'Participants',
    'Prize pool': 'Prize pool',
    'Your rank': 'Your rank',
  },
  es: {
    // Landing
    'Connect Phantom to continue': 'Conectar Phantom para continuar',
    'Contribution': 'Contribución',
    'verified on-chain': 'verificada en blockchain',
    'Peer-validated, privacy-first recognition. Company admins set the challenge. Competitors prove their work. Blockchain settles the reward.':
      'Reconocimiento entre pares, privacidad primero. Los admins crean el reto. Los competidores demuestran su trabajo. La blockchain liquida el premio.',
    'Admin': 'Administrador',
    'Competitor': 'Competidor',
    'Create a challenge, set the reward pool, configure metrics and deploy on-chain.':
      'Crea un reto, define el fondo de premios, configura métricas y despliega en blockchain.',
    'Browse open challenges, join on-chain, submit daily proof of work and vote on peers.':
      'Explora retos abiertos, únete en blockchain, envía tu prueba de trabajo diaria y vota a tus compañeros.',
    'Create challenge': 'Crear reto',
    'Join challenge': 'Unirse al reto',
    // Wizard
    'Configure your contribution challenge': 'Configura tu reto de contribución',
    "Who's competing?": '¿Quién compite?',
    'What gets measured?': '¿Qué se mide?',
    'Set the prize pool': 'Define el fondo de premios',
    'Ready to deploy': 'Listo para desplegar',
    // Dashboard
    'Leaderboard': 'Clasificación',
    'Vote inbox': 'Votos pendientes',
    'Badges': 'Insignias',
    'My profile': 'Mi perfil',
    'Chain status': 'Estado blockchain',
    'Settings': 'Configuración',
    'Yes, good day': 'Sí, buen día',
    'Not really': 'No mucho',
    'Skip': 'Omitir',
    'Connect Calendar': 'Conectar Calendario',
    'Connect': 'Conectar',
    // Competitor
    'Open challenges': 'Retos abiertos',
    'Browse and join on-chain contribution challenges': 'Explora y únete a retos de contribución en blockchain',
    'Join challenge →': 'Unirse al reto →',
    'Preview': 'Vista previa',
    'My proof of work': 'Mi prueba de trabajo',
    'Leave challenge': 'Abandonar reto',
    'Proof of work': 'Prueba de trabajo',
    'Set your display name': 'Elige tu nombre visible',
    'First name': 'Nombre',
    'Last name': 'Apellido',
    'Skip for now': 'Omitir por ahora',
    'Was this a productive day?': '¿Fue un día productivo?',
    'Cannot vote on your own activity': 'No puedes votar tu propia actividad',
    "Today's computed score": 'Puntuación calculada hoy',
    'Commit score on-chain': 'Registrar puntuación en blockchain',
    'Committed history': 'Historial registrado',
    'Display name': 'Nombre visible',
    'Save profile': 'Guardar perfil',
    'On-chain proof': 'Prueba en blockchain',
    'Participants': 'Participantes',
    'Prize pool': 'Fondo de premios',
    'Your rank': 'Tu posición',
    // Extra ES
    'Active challenge': 'Reto activo',
    'Days committed': 'Días registrados',
    'Peer validations': 'Validaciones de compañeros',
    'Anonymous': 'Anónimo',
    'anonymous': 'anónimo',
    'your vote is anonymous': 'tu voto es anónimo',
    'No one can see who voted what.': 'Nadie puede ver quién votó qué.',
    'Days left': 'Días restantes',
    'locked in escrow': 'bloqueado en custodia',
    'auto-released': 'liberación automática',
    'Connect Phantom to join challenges': 'Conecta Phantom para unirte a retos',
    'Not connected': 'No conectado',
  }
};

let currentLang = localStorage.getItem('wp_lang') || 'en';

function t(key) {
  return TRANSLATIONS[currentLang]?.[key] || key;
}

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'es' : 'en';
  localStorage.setItem('wp_lang', currentLang);
  applyTranslations();
  updateLangToggle();
}

function applyTranslations() {
  // Translate all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key);
    if (el.tagName === 'INPUT' && el.placeholder) {
      el.placeholder = translation;
    } else {
      el.textContent = translation;
    }
  });

  // Translate all elements with data-i18n-html (allows inner HTML)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    el.innerHTML = t(key);
  });
}

function updateLangToggle() {
  const btn = document.getElementById('lang-toggle');
  if (btn) {
    btn.textContent = currentLang === 'en' ? '🇪🇸 ES' : '🇬🇧 EN';
    btn.title = currentLang === 'en' ? 'Cambiar a Español' : 'Switch to English';
  }
}

// Run on load
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  updateLangToggle();
});
