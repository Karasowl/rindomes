import { RindoMesApp } from "@/components/rindomes-app";
import { I18nProvider } from "@/lib/i18n";

export default function AppPage() {
  return (
    <I18nProvider>
      <RindoMesApp />
    </I18nProvider>
  );
}
