import { useLoaderData } from "react-router";

export const loader = async () => {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
  return {
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY
      ? `${process.env.SHOPIFY_API_KEY.slice(0, 8)}...${process.env.SHOPIFY_API_KEY.slice(-4)}`
      : "NOT SET",
    SHOPIFY_API_SECRET: secret
      ? `SET — length:${secret.length}, prefix:${secret.slice(0, 6)}`
      : "NOT SET",
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || "NOT SET",
    SCOPES: process.env.SCOPES || "NOT SET (will default to undefined)",
    DATABASE_URL: process.env.DATABASE_URL ? "SET" : "NOT SET",
    DIRECT_URL: process.env.DIRECT_URL ? "SET" : "NOT SET",
    SUPABASE_URL: process.env.SUPABASE_URL || "NOT SET",
    ANTHROPIC_API_KEY: anthropicKey
      ? `SET — length:${anthropicKey.length}, prefix:${anthropicKey.slice(0, 7)}`
      : "NOT SET",
    NODE_ENV: process.env.NODE_ENV || "unknown",
  };
};

export default function Debug() {
  const data = useLoaderData();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Debug — True Cost Calculator</title>
      </head>
      <body style={{ fontFamily: "monospace", padding: "2rem", background: "#f9f9f9" }}>
        <h2>Environment Variables Status</h2>
        <p style={{ color: "#666", fontSize: "0.9rem" }}>
          Secrets are partially masked. This page is public — remove in production.
        </p>
        <pre
          style={{
            background: "#fff",
            border: "1px solid #ddd",
            padding: "1.5rem",
            borderRadius: "6px",
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
        <p style={{ marginTop: "2rem", color: "#666", fontSize: "0.85rem" }}>
          Expected SHOPIFY_API_SECRET prefix for Shopify Apps: a 32-char hex string (no prefix) or a <code>shpss_</code> prefixed key.<br />
          If Secret is NOT SET or the length looks wrong, update it in Vercel → Settings → Environment Variables.
        </p>
      </body>
    </html>
  );
}
