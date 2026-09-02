import { getServerTranslator } from '@/lib/i18n/server';

export default async function AppFooter() {
  const { t } = await getServerTranslator();
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span>{t('footer.rights')}</span>
      </div>
    </footer>
  );
}
