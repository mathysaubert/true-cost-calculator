// ════════════════════════════════════════════════════════════════════════════════
//  LOT 35 — D0 : « Annuler » de la barre de sauvegarde remet la valeur enregistrée (Réglages).
//  Rendu CLIENT réel de React 19 (react-dom/client, jsdom) des VRAIS composants de
//  app/components/settings/Fields.jsx, chargés par Vite. GARDE-FOU rapide pour `npm test` : la PREUVE
//  est scripts/browser_reset_check.mjs (vrai navigateur, vrai polaris.js, code d'app-bridge.js).
//  Les éléments simulés reproduisent le comportement MESURÉ dans ce vrai navigateur (2026-09-25) :
//    • s-text-field : valeur de départ lue dans l'attribut `value` ; la propriété `defaultValue`
//      écrit cet attribut par setAttribute ;
//    • Polaris surcharge setAttribute et IGNORE un attribut dont le nom figure dans les props React
//      de l'élément (donc `value`) : seule la méthode DOM native (ou le HTML analysé) le crée ;
//    • s-text-field.formResetCallback : value = defaultValue || "" ;
//    • s-select.formResetCallback : value vidée → l'option portant l'attribut `selected`, sinon la
//      première option.
//  jsdom n'appelle pas formResetCallback (pas d'ElementInternals) : resetForm() le fait, comme le
//  navigateur. Chemins : arrivée par le menu, page chargée en entier (rendu serveur + hydratation),
//  valeur ré-enregistrée, champ vide, témoin sans correctif.
//  Pour lancer : node tests/lot35_settings_reset.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { JSDOM } from "jsdom";
import { createServer } from "vite";

// Modules chargés par Vite AVANT d'installer le DOM (Vite lit sa configuration hors navigateur).
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { NumberField, TextField, DateField, SelectField } = await vite.ssrLoadModule("/app/components/settings/Fields.jsx");
const { I18nProvider } = await vite.ssrLoadModule("/app/lib/i18n/context.jsx");
const { CATALOGS } = await vite.ssrLoadModule("/app/locales/index.js");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const G = globalThis;
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "customElements", "Event", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  if (k === "navigator") { try { Object.defineProperty(G, "navigator", { value: dom.window.navigator, configurable: true }); } catch { /* lecture seule */ } continue; }
  G[k] = dom.window[k] ?? G[k];
}
G.IS_REACT_ACT_ENVIRONMENT = true;

// Surcharge de setAttribute de polaris.js, restreinte à ce qui a été mesuré : l'écriture de l'attribut
// `value` est ignorée quand `value` figure dans les props React de l'élément.
class PolarisBase extends dom.window.HTMLElement {
  setAttribute(name, v) {
    const key = Object.keys(this).find((k) => k.startsWith("__reactProps$"));
    if (name === "value" && key && this[key] && "value" in this[key]) return;
    super.setAttribute(name, v);
  }
}
class PolarisTextField extends PolarisBase {
  get defaultValue() { return this.getAttribute("value") ?? ""; }
  set defaultValue(v) { this.setAttribute("value", v == null ? "" : String(v)); }
  get value() { return this._typed ?? this.defaultValue; }
  set value(v) { this._typed = v; }
  formResetCallback() { this.value = this.defaultValue || ""; }
}
class PolarisSelect extends PolarisBase {
  get value() {
    if (this._typed) return this._typed;
    const opts = [...this.querySelectorAll("s-option")];
    const sel = opts.find((o) => o.hasAttribute("selected")) ?? opts[0];
    return sel ? String(sel.value ?? sel.getAttribute("value") ?? "") : "";
  }
  set value(v) { this._typed = v; }
  formResetCallback() { this.value = ""; }
}
class PolarisOption extends PolarisBase {
  get value() { return this._v ?? this.getAttribute("value"); }
  set value(v) { this._v = v; }
  get selected() { return this._sel ?? this.hasAttribute("selected"); }
  set selected(v) { this._sel = v; }
}
dom.window.customElements.define("s-text-field", PolarisTextField);
dom.window.customElements.define("s-select", PolarisSelect);
dom.window.customElements.define("s-option", PolarisOption);

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot, hydrateRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const h = React.createElement;
const resetForm = (form) => { form.reset(); for (const el of form.querySelectorAll("s-text-field, s-select")) el.formResetCallback(); };
const tree = (saved) => h(I18nProvider, { locale: "fr", catalogs: { en: CATALOGS.en, fr: CATALOGS.fr }, currency: "EUR", timeZone: "UTC" },
  h("form", { id: "f" },
    h(NumberField, { name: "packaging_cost_per_order", label: "Emballage", value: saved.packaging }),
    h(TextField, { name: "label", label: "Libellé", value: saved.label }),
    h(DateField, { name: "active_from", label: "Début", value: saved.date }),
    h(SelectField, { name: "vat_regime", label: "TVA", value: saved.vat, options: [{ value: "assujetti", label: "Assujetti" }, { value: "franchise", label: "Franchise" }] })));
const fields = (c) => ({ num: c.querySelector('[name="packaging_cost_per_order"]'), txt: c.querySelector('[name="label"]'), date: c.querySelector('[name="active_from"]'), sel: c.querySelector('[name="vat_regime"]') });
const SAVED = { packaging: 0.8, label: "Abonnement", date: "2026-09-01", vat: "franchise" };
const typeAll = (f) => { f.num.value = "99"; f.txt.value = "Autre"; f.date.value = "2026-12-31"; f.sel.value = "assujetti"; };

console.log("\n── 1. Arrivée par le menu (rendu client React 19) ──");
{
  const c = document.createElement("div"); document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => root.render(tree(SAVED)));
  const f = fields(c);
  ok(f.num.value === "0.8" && f.sel.value === "franchise", "affichage initial = valeurs enregistrées");
  const selOpt = [...f.sel.querySelectorAll("s-option")].filter((o) => o.hasAttribute("selected")).map((o) => o.value);
  ok(f.num.getAttribute("value") === "0.8" && f.txt.getAttribute("value") === "Abonnement" && f.date.getAttribute("value") === "2026-09-01" && selOpt.join() === "franchise", "valeur de départ posée : attribut value (nombre, texte, date) malgré la surcharge Polaris ; attribut selected sur la seule option enregistrée (liste)");
  typeAll(f);
  ok(f.num.value === "99" && f.sel.value === "assujetti", "saisie du marchand prise en compte");
  resetForm(c.querySelector("form"));
  ok(f.num.value === "0.8" && f.txt.value === "Abonnement" && f.date.value === "2026-09-01" && f.sel.value === "franchise", "« Annuler » remet les valeurs enregistrées (jamais un champ vide)");
  await act(async () => root.render(tree({ ...SAVED, packaging: 1.2 })));
  typeAll(f); resetForm(c.querySelector("form"));
  ok(f.num.value === "1.2", "après un enregistrement (nouvelle valeur 1,2), « Annuler » remet 1,2");
  await act(async () => root.unmount()); c.remove();
}

console.log("\n── 2. Page chargée en entier (rendu serveur + hydratation) ──");
{
  const c = document.createElement("div"); document.body.appendChild(c);
  c.innerHTML = renderToString(tree(SAVED));
  const hydrationWarnings = [];
  const origError = console.error;
  console.error = (...args) => { const m = args.map(String).join(" "); if (/hydrat/i.test(m)) hydrationWarnings.push(m); else origError(...args); };
  let root;
  await act(async () => { root = hydrateRoot(c, tree(SAVED), { onRecoverableError: (e) => { failures++; console.log(`  ✗ hydratation : ${e.message}`); } }); });
  const f = fields(c);
  typeAll(f); resetForm(c.querySelector("form"));
  console.error = origError;
  ok(f.num.value === "0.8" && f.txt.value === "Abonnement" && f.date.value === "2026-09-01" && f.sel.value === "franchise", "« Annuler » remet les valeurs enregistrées");
  ok(hydrationWarnings.length === 0, `aucun écart d'hydratation entre le rendu serveur et le client (${hydrationWarnings.length})`);
  ok(!/defaultvalue/i.test(renderToString(tree(SAVED))), "rendu serveur inchangé : attribut value seul, pas d'attribut defaultValue");
  await act(async () => root.unmount()); c.remove();
}

console.log("\n── 3. Réglage non renseigné ──");
{
  const c = document.createElement("div"); document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => root.render(tree({ packaging: null, label: null, date: null, vat: "" })));
  const f = fields(c);
  typeAll(f); resetForm(c.querySelector("form"));
  ok(f.num.value === "" && f.txt.value === "", "champ non renseigné : « Annuler » le laisse vide (non renseigné), sans valeur inventée");
  await act(async () => root.unmount()); c.remove();
}

console.log("\n── 4. Témoin : la cause reproduite sans le correctif ──");
{
  const c = document.createElement("div"); document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => root.render(h("form", null, h("s-text-field", { name: "raw", value: "0.8" }))));
  const el = c.querySelector('[name="raw"]');
  el.value = "99"; resetForm(c.querySelector("form"));
  ok(el.value === "" && el.getAttribute("value") == null, "sans defaultValue, React 19 pose value en propriété : « Annuler » vide le champ (défaut du test boutique 1 reproduit)");
  await act(async () => root.unmount()); c.remove();
}

await vite.close();
console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 35 (Annuler remet la valeur enregistrée) : ✓ Tous les tests passent" : ` BILAN LOT 35 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
