import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enAgents from '../locales/en/agents.json';
import enCommon from '../locales/en/common.json';
import enErrors from '../locales/en/errors.json';
import enIntegration from '../locales/en/integration.json';
import enGuide from '../locales/en/guide.json';
import enSetup from '../locales/en/setup.json';
import enOffice from '../locales/en/office.json';
import enSettings from '../locales/en/settings.json';
import enTasks from '../locales/en/tasks.json';
import enTeam from '../locales/en/team.json';
import enShop from '../locales/en/shop.json';
import enArcade from '../locales/en/arcade.json';
import enTour from '../locales/en/tour.json';
import twAgents from '../locales/zh-TW/agents.json';
import twCommon from '../locales/zh-TW/common.json';
import twErrors from '../locales/zh-TW/errors.json';
import twIntegration from '../locales/zh-TW/integration.json';
import twGuide from '../locales/zh-TW/guide.json';
import twSetup from '../locales/zh-TW/setup.json';
import twOffice from '../locales/zh-TW/office.json';
import twSettings from '../locales/zh-TW/settings.json';
import twTasks from '../locales/zh-TW/tasks.json';
import twTeam from '../locales/zh-TW/team.json';
import twShop from '../locales/zh-TW/shop.json';
import twArcade from '../locales/zh-TW/arcade.json';
import twTour from '../locales/zh-TW/tour.json';

export const SUPPORTED_LOCALES = ['en', 'zh-TW'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = Locale | 'system';

export const NAMESPACES = ['common', 'agents', 'tasks', 'office', 'settings', 'errors', 'integration', 'setup', 'guide', 'team', 'shop', 'arcade', 'tour'] as const;

export const resources = {
  en: { common: enCommon, agents: enAgents, tasks: enTasks, office: enOffice, settings: enSettings, errors: enErrors, integration: enIntegration, setup: enSetup, guide: enGuide, team: enTeam, shop: enShop, arcade: enArcade, tour: enTour },
  'zh-TW': { common: twCommon, agents: twAgents, tasks: twTasks, office: twOffice, settings: twSettings, errors: twErrors, integration: twIntegration, setup: twSetup, guide: twGuide, team: twTeam, shop: twShop, arcade: twArcade, tour: twTour },
} as const;

/**
 * Maps OS locale tags to a supported locale. Traditional Chinese regions and
 * scripts map to zh-TW; Simplified Chinese deliberately falls back to English
 * rather than showing Traditional characters to a Simplified reader.
 */
export function resolveSystemLocale(tags: readonly string[]): Locale {
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) {
      if (/hant|tw|hk|mo/.test(tag)) return 'zh-TW';
      continue;
    }
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function resolveLocale(preference: LocalePreference): Locale {
  if (preference !== 'system') return preference;
  const tags = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return resolveSystemLocale(tags);
}

export function initI18n(preference: LocalePreference) {
  const lng = resolveLocale(preference);
  void i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'en',
    ns: NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React escapes; values are never rendered as HTML
    returnNull: false,
  });
  document.documentElement.lang = lng;
  return i18n;
}

export async function applyLocale(preference: LocalePreference) {
  const lng = resolveLocale(preference);
  document.documentElement.lang = lng;
  await i18n.changeLanguage(lng);
}

export { i18n };
