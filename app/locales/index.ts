/**
 * Translation resources
 *
 * This file assembles the full bundle of translated strings the app uses, in
 * both English and Spanish. For each language it pairs this app's own
 * `common` strings with the `kit` strings shared across all AMPL tools, so a
 * single resource object covers both the local UI and the shared header,
 * footer, and widgets. Both the server-side and browser-side i18next setups
 * import this one bundle, keeping the two sides in lockstep.
 *
 * @version v0.1.0
 */

import enCommon from "./en/common.json";
import esCommon from "./es/common.json";
import kitEn from "@ampl/kit/locales/en";
import kitEs from "@ampl/kit/locales/es";

const resources = {
  en: { common: enCommon, kit: kitEn },
  es: { common: esCommon, kit: kitEs },
} as const;

export default resources;
