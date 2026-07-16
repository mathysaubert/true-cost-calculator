-- C4a : compteur mensuel de commandes DISTINCTES ingérées (fondation du plafond d'alerting).
-- Ajoute usage.orders_count + une fonction d'incrément ATOMIQUE
--   INSERT ... ON CONFLICT (shop_domain, month) DO UPDATE SET orders_count = orders_count + delta
-- (impossible via .upsert() JS, qui pose une valeur littérale). Idempotent : ADD COLUMN IF NOT
-- EXISTS + CREATE OR REPLACE FUNCTION. Le compteur tourne "à vide" en C4a (personne ne le lit
-- encore) ; le branchement sur l'envoi d'alerte est C4b.

ALTER TABLE public.usage
  ADD COLUMN IF NOT EXISTS orders_count INTEGER NOT NULL DEFAULT 0;

-- Incrément atomique du compteur mensuel de commandes pour une boutique.
-- SECURITY INVOKER (défaut) : la RLS de `usage` gouverne l'accès ; seul le service role
-- (côté serveur, RLS bypass) l'appelle. p_delta = nombre de order_id distincts nouveaux ce sync.
CREATE OR REPLACE FUNCTION public.increment_usage_orders(p_shop TEXT, p_month TEXT, p_delta INTEGER)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.usage (shop_domain, month, orders_count)
  VALUES (p_shop, p_month, p_delta)
  ON CONFLICT (shop_domain, month)
  DO UPDATE SET orders_count = public.usage.orders_count + EXCLUDED.orders_count,
                updated_at   = NOW();
$$;
