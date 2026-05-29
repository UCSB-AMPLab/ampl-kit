/**
 * Shared UI Spanish strings
 *
 * This file is the Spanish counterpart to the shared-UI English strings — the
 * same footer, language switcher, account widget, "report a problem" dialog,
 * and "no access" page text, translated for Spanish-speaking users. A consuming
 * tool merges it into its own translation bundle under the `kit` namespace.
 *
 * BORRADOR — estas cadenas en español todavía NO están revisadas. Necesitan la
 * revisión de dos pasos en español colombiano antes de darse por finales. Esto
 * cubre las claves header, accountWidget, reportProblem y noAccess; las dos
 * claves de footer ya venían como borrador y se conservan.
 *
 * @version v0.1.0
 */
export default {
  email: {
    footer: {
      transactional: "Este es un mensaje transaccional automático de AMPL.",
      tagline: "Archives, Memory, and Preservation Lab · UC Santa Barbara",
      unsubscribeLabel: "Darte de baja",
    },
    unsubscribe: {
      pageTitle: "Darte de baja de los correos de AMPL",
      heading: "Darte de baja",
      explain:
        "Al confirmar, esta dirección quedará excluida de todos los mensajes automáticos de AMPL. La exclusión es global: cubre todas las herramientas —Calamus, Scheduling y las que vengan más adelante—, no solo la que te envió este mensaje.",
      button: "Confirmar baja",
      confirmedHeading: "Te has dado de baja",
      confirmedBody:
        "Hemos quitado tu dirección de nuestra lista. Ya no recibirás mensajes automáticos de ninguna herramienta de AMPL.",
    },
  },
  footer: {
    terms: "Términos de uso",
    accessibility: "Accesibilidad",
  },
  header: {
    localeLabel: "Cambiar idioma",
  },
  accountWidget: {
    signOut: "Cerrar sesión",
  },
  reportProblem: {
    trigger: "Reportar un problema",
    title: "Reportar un problema",
    body: "La función de reporte de problemas estará disponible pronto. Por ahora, escríbenos directamente al laboratorio.",
    submit: "Enviar",
    close: "Cerrar",
  },
  noAccess: {
    overline: "ACCESO DENEGADO",
    title: "No tienes acceso a esta herramienta",
    body: "Comunícate con el administrador de la herramienta para solicitar acceso.",
    back: "Volver",
  },
} as const;
