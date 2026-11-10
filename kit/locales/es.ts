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
    auth: {
      // Account-access messages rendered by the AuthEmail entrypoint.
      // {{minutes}} is the link lifetime.
      linkSubject: "[AMPL] Tu enlace para iniciar sesión",
      linkPreheader: "Usa este enlace para iniciar sesión en AMPL.",
      linkHeading: "Inicia sesión en AMPL",
      linkBody: "Alguien pidió un enlace para iniciar sesión en las herramientas de AMPL con esta dirección de correo. Si fuiste tú, usa el botón de abajo.",
      linkButton: "Iniciar sesión",
      linkNote: "El enlace sirve una sola vez y vence en {{minutes}} minutos. Si no lo pediste, puedes ignorar este correo.",
      githubSubject: "[AMPL] Inicia sesión con GitHub",
      githubPreheader: "Para entrar a tu cuenta de AMPL, usa GitHub.",
      githubHeading: "Inicia sesión con GitHub",
      githubBody: "Alguien pidió un enlace para iniciar sesión con esta dirección de correo. No enviamos ninguno, porque a tu cuenta de AMPL se entra con GitHub.",
      githubButton: "Ir a iniciar sesión",
      githubNote: "Si no lo pediste, puedes ignorar este correo.",
    },
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
    signIn: "Iniciar sesión",
    menuLabel: "Menú",
  },
  nav: {
    ariaLabel: "Navegación del sitio del laboratorio",
    tools: "Herramientas",
    projects: "Proyectos",
    opportunities: "Oportunidades",
    people: "Personas",
  },
  switcher: {
    current: "Actual",
    switchTo: "Cambiar a",
    tagline: {
      calamus: "Practica leer manuscritos",
      scheduling: "reservas y encuestas",
    },
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
