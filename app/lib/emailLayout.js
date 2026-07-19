// ── Enveloppe HTML commune des emails — robuste au DARK MODE (PUR, aucun CSS moderne) ────────
// Bug constaté : un client en mode sombre INVERSE le fond des éléments SANS background déclaré et
// garde/fonce le texte → texte foncé (#202223) sur fond noir = illisible. Parades FIABLES en email :
//   • background-color EXPLICITE sur <body> ET sur le conteneur — un fond déclaré n'est PAS inversé ;
//   • <meta color-scheme> / <meta supported-color-schemes> — respectés par les clients qui les gèrent
//     (Apple Mail…), signalent que le rendu est pensé pour un fond clair ;
//   • couleur de texte foncée TOUJOURS posée AVEC le fond blanc → jamais de dark-on-dark.
// `inner` : fragment HTML du corps (déjà stylé). Retour : document HTML complet, prêt à envoyer.
export function emailShell(inner) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;background-color:#ffffff;color:#202223;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
${inner}
</div>
</body>
</html>`;
}
