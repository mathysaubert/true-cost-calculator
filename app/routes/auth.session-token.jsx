import { addDocumentResponseHeaders } from "../shopify.server";

const MAX_BOUNCES = 3;
const COOKIE_TTL = 90;

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)bounce_count=(\d+)/);
  const bounceCount = match ? parseInt(match[1], 10) : 0;

  const responseHeaders = new Headers({ "Content-Type": "text/html;charset=utf-8" });
  addDocumentResponseHeaders(request, responseHeaders);

  if (bounceCount >= MAX_BOUNCES) {
    console.error("[auth.session-token] redirect loop detected after", bounceCount, "bounces");
    responseHeaders.set("Set-Cookie", "bounce_count=0; Path=/; Max-Age=0; SameSite=None; Secure");
    return new Response(
      `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Auth Error</title></head>
<body style="font-family:sans-serif;padding:2rem;color:#333;max-width:600px;margin:auto">
  <h2 style="color:#c0392b">Authentication Loop Detected</h2>
  <p>The app is stuck in an authentication redirect loop (${bounceCount} bounces). This almost always means one of these:</p>
  <ol>
    <li><strong>SHOPIFY_API_SECRET is wrong on Vercel</strong>: the JWT can't be verified</li>
    <li><strong>App is not installed in this store</strong>: Token Exchange fails with <code>invalid_subject_token</code></li>
  </ol>
  <h3>How to fix:</h3>
  <p><strong>Option 1 · Verify SHOPIFY_API_SECRET:</strong></p>
  <ol>
    <li>Go to <a href="https://partners.shopify.com" target="_top">Shopify Partners</a> → Your App → <em>API credentials</em></li>
    <li>Copy the <strong>API secret key</strong> (not the API key)</li>
    <li>Update <code>SHOPIFY_API_SECRET</code> in Vercel → Settings → Environment Variables</li>
    <li>Redeploy</li>
  </ol>
  <p><strong>Option 2 · Re-install the app:</strong></p>
  <ol>
    <li>In Shopify Partners, click <em>Test your app</em> → select your dev store</li>
    <li>Complete the installation flow</li>
  </ol>
  <hr style="margin:1.5rem 0">
  <pre style="font-size:0.75rem;background:#f5f5f5;padding:1rem;border-radius:4px;overflow:auto">API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}
Secret set: ${!!process.env.SHOPIFY_API_SECRET}
Secret prefix: ${process.env.SHOPIFY_API_SECRET?.slice(0, 6) || "N/A"}
App URL: ${process.env.SHOPIFY_APP_URL || "NOT SET"}
Shop: ${shop}</pre>
</body>
</html>`,
      { headers: responseHeaders, status: 200 }
    );
  }

  responseHeaders.set(
    "Set-Cookie",
    `bounce_count=${bounceCount + 1}; Path=/; Max-Age=${COOKIE_TTL}; SameSite=None; Secure`
  );

  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Loading...</title>
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; font-family: sans-serif; color: #666; }
    .msg { text-align: center; }
    .spinner { width: 32px; height: 32px; border: 3px solid #eee; border-top-color: #666;
               border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="msg">
    <div class="spinner"></div>
    <p>Authenticating…</p>
  </div>
  <script data-api-key="${apiKey}" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
</body>
</html>`,
    { headers: responseHeaders, status: 200 }
  );
};
