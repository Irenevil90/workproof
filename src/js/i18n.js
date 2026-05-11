/**
 * WorkProof i18n v4 — EN / ES
 * Approach: data-i18n attrs for static content + scheduled re-scan for dynamic content
 */

const T = {
  en: {},  // English is default, no translation needed
  es: {
    // Landing
    'Contribution': 'Contribución',
    'verified on-chain': 'verificada en blockchain',
    'Admin': 'Administrador',
    'Competitor': 'Competidor',
    'Create challenge': 'Crear reto',
    'Join challenge': 'Unirse al reto',
    'Create a challenge, set the reward pool, configure metrics and deploy on-chain.': 'Crea un reto, define el fondo de premios y despliega en blockchain.',
    'Browse open challenges, join on-chain, submit daily proof of work and vote on peers.': 'Explora retos abiertos, únete en blockchain y vota a tus compañeros.',
    'Peer-validated, privacy-first recognition. Company admins set the challenge. Competitors prove their work. Blockchain settles the reward.': 'Reconocimiento entre pares. Los admins crean el reto. Los competidores demuestran su trabajo. La blockchain liquida el premio.',
    // Wizard steps
    'Configure your contribution challenge': 'Configura tu reto de contribución',
    "Who's competing?": '¿Quién compite?',
    'What gets measured?': '¿Qué se mide?',
    'Set the prize pool': 'Define el fondo de premios',
    'Ready to deploy': 'Listo para desplegar',
    'Set up a verified, tamper-proof recognition program for your team. Peer-validated. Blockchain-settled. Privacy-first.': 'Programa de reconocimiento verificado para tu equipo. Validado entre pares. Liquidado en blockchain.',
    'Set the size of the team and how long the challenge runs.': 'Define el tamaño del equipo y la duración del reto.',
    'Funds are locked in a Solana smart contract escrow. Released automatically to winners\' wallets — no manual processing.': 'Fondos bloqueados en custodia Solana. Liberados automáticamente a las wallets ganadoras.',
    // Labels
    'CHALLENGE NAME': 'NOMBRE DEL RETO',
    'COMPANY / TEAM NAME': 'EMPRESA / EQUIPO',
    'NUMBER OF EMPLOYEES': 'NÚM. DE PARTICIPANTES',
    'CHALLENGE DURATION': 'DURACIÓN DEL RETO',
    'TOTAL REWARD AMOUNT': 'IMPORTE DEL PREMIO',
    'START DATE': 'FECHA INICIO',
    'END DATE': 'FECHA FIN',
    'TOP N REWARDED': 'TOP N PREMIADOS',
    'VOTING THRESHOLD': 'UMBRAL DE VOTACIÓN',
    'or days directly:': 'o días directamente:',
    'participants (3–50)': 'participantes (3–50)',
    // Buttons
    '← Exit': '← Salir',
    '← Back': '← Atrás',
    'Continue →': 'Continuar →',
    '🚀 Deploy challenge': '🚀 Desplegar reto',
    'Back': 'Atrás',
    // Opt cards
    'Winner takes all': 'El ganador se lo lleva todo',
    'Podium rewards': 'Premios al podio',
    'Wider recognition': 'Reconocimiento amplio',
    'Scaled tier': 'Nivel escalonado',
    'Simple': 'Simple',
    'Strong ✓': 'Fuerte ✓',
    'Strict': 'Estricto',
    '3/5 peers agree': '3/5 compañeros',
    '4/5 peers agree': '4/5 compañeros',
    '5/5 unanimous': '5/5 unánime',
    // Dashboard nav items
    'Leaderboard': 'Clasificación',
    'Vote inbox': 'Votos pendientes',
    'Badges': 'Insignias',
    'My profile': 'Mi perfil',
    'Chain status': 'Estado blockchain',
    'Settings': 'Configuración',
    'Back to home': 'Inicio',
    'Leave challenge': 'Abandonar reto',
    'Proof of work': 'Prueba de trabajo',
    'Home': 'Inicio',
    // Competitor browser
    'Open challenges': 'Retos abiertos',
    'Connect wallet to see your challenges and join new ones': 'Conecta tu wallet para ver tus retos',
    'Connect Phantom': 'Conectar Phantom',
    'Join challenge →': 'Unirse →',
    'Open dashboard →': 'Abrir panel →',
    'Details': 'Detalles',
    'locked · auto-released': 'bloqueado · liberación automática',
    'days left': 'días restantes',
    // Modal
    'Set your display name': 'Elige tu nombre visible',
    'First name': 'Nombre',
    'Last name': 'Apellido',
    'Skip for now': 'Omitir por ahora',
    // Stats
    'Active challenge': 'Reto activo',
    'remaining': 'restante',
    'Participants': 'Participantes',
    'Avg consensus': 'Consenso medio',
    'Prize pool': 'Fondo de premios',
    'Your rank': 'Tu posición',
    // Vote
    'Yes, good day': 'Sí, buen día',
    'Not really': 'No mucho',
    'Skip': 'Omitir',
    'Cannot vote on your own activity': 'No puedes votar tu propia actividad',
    'Honest voting protects your reputation.': 'Votar honestamente protege tu reputación.',
    'no one can see who voted what.': 'nadie puede ver quién votó qué.',
    // POW
    "Today's score": 'Puntuación de hoy',
    'Based on connected sources': 'Basado en fuentes conectadas',
    'Commit score on-chain': 'Registrar en blockchain',
    'Committed history': 'Historial registrado',
    'No commits yet.': 'Sin registros todavía.',
    'Submitted today — come back tomorrow': 'Enviado hoy — vuelve mañana',
    'Connect Calendar': 'Conectar Calendario',
    'Connect GitHub': 'Conectar GitHub',
    // Profile
    'Display name': 'Nombre visible',
    'Save profile': 'Guardar perfil',
    'On-chain proof': 'Prueba en blockchain',
    'Voting reputation': 'Reputación de voto',
    'Reputation score': 'Puntuación',
    'Vote weight': 'Peso del voto',
    // Chain status
    'Devnet live': 'Devnet activo',
    'Disconnected': 'Desconectado',
    // Leaderboard
    'Rankings': 'Clasificación',
    'Names visible to voters': 'Nombres visibles para votar',
    'Vote is always anonymous on-chain': 'El voto es siempre anónimo en blockchain',
  }
};

let currentLang = localStorage.getItem('wp_lang') || 'en';

function t(key) {
  if (currentLang === 'en') return key;
  return T.es[key] || key;
}

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'es' : 'en';
  localStorage.setItem('wp_lang', currentLang);
  applyTranslations();
  updateLangToggle();
}

// Main translation function — applies to all visible text
function applyTranslations() {
  if (currentLang === 'en') {
    // Restore original text from data-i18n attrs
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      el.textContent = el.getAttribute('data-i18n');
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      el.placeholder = el.getAttribute('data-i18n-placeholder');
    });
    return;
  }

  // Spanish: translate data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  // Also scan buttons and nav items by text content
  var btns = document.querySelectorAll('button, .nav-item, .opt-title, .opt-desc, .stat-label, .field-label, label');
  btns.forEach(function(el) {
    // Skip elements with child elements (complex structure)
    if (el.children.length > 1) return;
    var icon = el.querySelector('.nav-icon, .medal, .stat-icon');
    var txt = el.textContent.trim();
    if (icon) txt = txt.replace(icon.textContent, '').trim();
    if (!txt || txt.length < 2 || /^[\d.,%#→←↗]/i.test(txt)) return;
    var tr = t(txt);
    if (tr !== txt) {
      if (icon) {
        el.innerHTML = icon.outerHTML + ' ' + tr;
      } else {
        el.textContent = tr;
      }
    }
  });
}

function updateLangToggle() {
  var btn = document.getElementById('lang-toggle');
  if (!btn) return;
  btn.textContent = currentLang === 'en' ? '🇪🇸 ES' : '🇬🇧 EN';
  btn.title = currentLang === 'en' ? 'Cambiar a Español' : 'Switch to English';
}

// Re-apply after any screen navigation or content rebuild
var _i18nTimer = null;
function _scheduleTranslation() {
  clearTimeout(_i18nTimer);
  _i18nTimer = setTimeout(function() {
    if (currentLang === 'es') applyTranslations();
  }, 100);
}

document.addEventListener('DOMContentLoaded', function() {
  applyTranslations();
  updateLangToggle();
  
  // Watch for DOM changes to re-translate dynamic content
  if (window.MutationObserver && currentLang === 'es') {
    new MutationObserver(function(muts) {
      var relevant = muts.some(function(m) { return m.addedNodes.length > 0; });
      if (relevant) _scheduleTranslation();
    }).observe(document.body, { childList: true, subtree: true });
  }
});
