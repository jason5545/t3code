import { useState } from "react";

import { selectInterfaceLocale } from "../../locale/autoTranslateRuntime";
import { isLocale, LOCALE_OPTIONS, readLocalePreference } from "../../locale/locale";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** Device-local preference: never sent to an environment or provider. */
export function LanguageSettings() {
  const [locale, setLocale] = useState(readLocalePreference);
  return (
    <SettingsSection id="interface-language" title="Language">
      <SettingsRow
        title="Interface language"
        description="Choose the language for this device. Chat messages, code, and provider names are not translated."
        control={
          <Select
            value={locale}
            onValueChange={(value) => {
              if (!isLocale(value)) return;
              setLocale(value);
              selectInterfaceLocale(value);
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Interface language">
              <SelectValue>
                {LOCALE_OPTIONS.find((option) => option.value === locale)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {LOCALE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
