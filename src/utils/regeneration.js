const REJECTION_PREFIX = '[rejected]';
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

function normalizeReason(value) {
  return value.trim().replace(/\s+/g, ' ').replace(/"{3,}/g, '"');
}

export function validateRejectionReason(value) {
  if (typeof value !== 'string') throw new Error('El motivo de rechazo es obligatorio.');
  // Collapse to a single line and strip triple-quote sequences so this text
  // can be safely wrapped in a """ ... """ delimiter block when injected into
  // the Claude prompt (see generate-content.js/generate-carousel.js) without
  // letting the reviewer's own text break out of that delimiter.
  const reason = normalizeReason(value);
  if (!reason) throw new Error('El motivo de rechazo es obligatorio.');
  if (reason.length < MIN_REASON_LENGTH) {
    throw new Error(`El motivo debe tener al menos ${MIN_REASON_LENGTH} caracteres.`);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`El motivo no puede superar ${MAX_REASON_LENGTH} caracteres.`);
  }
  return reason;
}

export function formatRegenerationNote(reason) {
  return `${REJECTION_PREFIX} ${validateRejectionReason(reason)}`;
}

export function getRegenerationReason(notes) {
  if (typeof notes !== 'string') return null;
  const line = notes.split(/\r?\n/).find(item => item.trim().toLowerCase().startsWith(REJECTION_PREFIX));
  const reason = line?.trim().slice(REJECTION_PREFIX.length).trim();
  return reason || null;
}

export function buildRegenerationFields(regenerationNote) {
  if (!getRegenerationReason(regenerationNote)) {
    throw new Error('La nota de regeneración no contiene un motivo válido.');
  }
  return {
    Estado:               'En cola',
    'Paso completado':     '',
    'Caption generado':    '',
    'Descripción visual':  '',
    Hook:                  '',
    'URL imagen':          '',
    'URL imagen branded':  '',
    'Imagen preview':      [],
    'Slides JSON':         '',
    'URL Video':           '',
    Notas:                 regenerationNote,
  };
}
