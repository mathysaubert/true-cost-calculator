import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  console.log("[auth.$] loader hit:", request.url);
  await authenticate.admin(request);
  console.log("[auth.$] authenticate.admin completed");
  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
