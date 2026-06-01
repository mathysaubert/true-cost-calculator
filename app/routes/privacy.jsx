export const meta = () => [
  { title: "Politique de confidentialité — True Cost Calculator" },
];

export default function Privacy() {
  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#202223", lineHeight: "1.7" }}>
      <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "4px" }}>Politique de confidentialité</h1>
      <p style={{ fontSize: "14px", color: "#6D7175", marginBottom: "40px" }}>
        True Cost Calculator — Sprintweb — Dernière mise à jour : 1er juin 2026
      </p>

      <Section title="1. Qui sommes-nous">
        <p>True Cost Calculator est une application Shopify développée par Sprintweb (Mathys Aubert). Cette politique décrit comment nous collectons, utilisons et protégeons vos données dans le cadre de l'utilisation de l'application.</p>
      </Section>

      <Section title="2. Données collectées">
        <p>Dans le cadre du fonctionnement de l'application, nous collectons et traitons les données suivantes :</p>
        <ul>
          <li>Le domaine de votre boutique Shopify (identifiant de session)</li>
          <li>Les données produits importées depuis votre catalogue Shopify (nom, prix de vente, coût fournisseur)</li>
          <li>Les paramètres de calcul saisis dans l'application (prix d'achat, catégorie produit, pays d'import, frais divers)</li>
          <li>L'historique de vos calculs de marge et annotations associées</li>
          <li>Les seuils d'alerte configurés</li>
        </ul>
        <p>Nous ne collectons pas d'informations personnelles sur vos clients (acheteurs finaux).</p>
      </Section>

      <Section title="3. Utilisation des données">
        <p>Les données collectées sont utilisées exclusivement pour :</p>
        <ul>
          <li>Calculer et afficher votre marge nette réelle</li>
          <li>Sauvegarder votre historique de calculs</li>
          <li>Générer des recommandations personnalisées via l'API Anthropic Claude</li>
          <li>Gérer votre abonnement et votre accès aux fonctionnalités</li>
        </ul>
        <p>Vos données ne sont jamais vendues, louées ou partagées avec des tiers à des fins commerciales.</p>
      </Section>

      <Section title="4. Services tiers">
        <ul>
          <li><strong>Supabase</strong> — stockage de la base de données (hébergé en Europe)</li>
          <li><strong>Anthropic Claude API</strong> — génération des recommandations IA (les données transmises ne sont pas utilisées pour entraîner les modèles)</li>
          <li><strong>Sentry</strong> — surveillance des erreurs techniques</li>
          <li><strong>Vercel</strong> — hébergement de l'application</li>
        </ul>
      </Section>

      <Section title="5. Conservation des données">
        <p>Vos données sont conservées tant que votre boutique a l'application installée. En cas de désinstallation, vos données sont supprimées dans un délai de 30 jours conformément aux webhooks RGPD Shopify.</p>
      </Section>

      <Section title="6. Vos droits (RGPD)">
        <ul>
          <li>Droit d'accès à vos données</li>
          <li>Droit de rectification</li>
          <li>Droit à l'effacement (droit à l'oubli)</li>
          <li>Droit à la portabilité des données</li>
        </ul>
        <p>Pour exercer ces droits : <a href="mailto:mathys.aubert@icloud.com" style={{ color: "#008060" }}>mathys.aubert@icloud.com</a></p>
      </Section>

      <Section title="7. Sécurité">
        <p>L'accès à vos données est sécurisé par authentification OAuth Shopify. Chaque boutique n'accède qu'à ses propres données. Les communications sont chiffrées via HTTPS.</p>
      </Section>

      <Section title="8. Contact">
        <p><a href="mailto:mathys.aubert@icloud.com" style={{ color: "#008060" }}>mathys.aubert@icloud.com</a></p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: "32px" }}>
      <h2 style={{ fontSize: "17px", fontWeight: "600", marginBottom: "12px", color: "#202223" }}>{title}</h2>
      <div style={{ fontSize: "15px", color: "#3D4043" }}>{children}</div>
    </section>
  );
}
