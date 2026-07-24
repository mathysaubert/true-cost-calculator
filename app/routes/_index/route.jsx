import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>True Cost Calculator</h1>
        <p className={styles.text}>
          Calculez votre vraie marge nette, une fois payés vos droits de douane, votre TVA à l'import, vos frais Shopify, vos frais de paiement et votre publicité. Arrêtez de perdre de l'argent sur des produits que vous croyez rentables.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Adresse de votre boutique</span>
              <input className={styles.input} type="text" name="shop" />
              <span>ex. : ma-boutique.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Se connecter
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Votre vraie marge, tout compris</strong>. Chaque vente est
            calculée avec vos droits de douane, votre TVA à l'import, vos frais
            Shopify et de paiement, et votre publicité.
          </li>
          <li>
            <strong>Repérez les produits qui vous font perdre de l'argent</strong>.
            Vous recevez un email dès qu'un produit passe sous votre objectif de
            marge.
          </li>
          <li>
            <strong>Sachez si votre publicité peut être rentable</strong>. L'app
            vous dit combien votre publicité doit vous rapporter avant que vous
            lanciez vos campagnes.
          </li>
        </ul>
      </div>
    </div>
  );
}
