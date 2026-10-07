-- Aqui Cal-Mex drinks available at Downtown Campbell, checked 2026-10-07.
-- Sources: https://www.aquicalmex.com/industrial-swirls/
--          https://www.aquicalmex.com/martini-craft-swirls/
--          https://www.aquicalmex.com/campbell-menu/
-- Prefix with Aqui for catalog search. Omit flights (log each drink), unnamed
-- beer/wine selections, and the Cupertino-only Aloha Mai Tai Swirl.
-- Seasonal names remain useful for logging past drinks; availability can change.
insert into public.drinks (name, normalized_name, is_alcoholic)
select name, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')), is_alcoholic
from (values
  ('Aqui Industrial Strength Margarita', true),
  ('Aqui Paradise Patrón Swirl', true),
  ('Aqui Sangria Swirl', true),
  ('Aqui Sunrise Swirl', true),
  ('Aqui Hornitos Cadillac Swirl', true),
  ('Aqui Agua Fresca Swirl', true),
  -- Monthly special: September 30 through October 27, 2026.
  ('Aqui Strawberry Guava Froze'' Swirl', true),
  ('Aqui Pineapple Remy Whip Swirl', true),
  ('Aqui Maker''s Mark Manhattan Craft Swirl', true),
  ('Aqui Modelo Chavela Swirl', true),
  -- Low alcohol still contains alcohol; it is distinct from Zero Proof.
  ('Aqui Low Alcohol Swirl', true),
  -- House and handmade rocks drinks.
  ('Aqui Hornitos Cadillac', true),
  ('Aqui Sangria', true),
  ('Aqui Carlitos Cadillac', true),
  ('Aqui Gran Centenario Paloma', true),
  ('Aqui Maker''s Mark Manhattan', true),
  ('Aqui Oliver Rocks', true),
  ('Aqui Skinny Margarita', true),
  ('Aqui Tito''s Strawberry Lemonade', true),
  -- Handmade Martini Craft Swirls: listed at all Aqui locations.
  ('Aqui Manhattan Martini Craft Swirl', true),
  ('Aqui 21 Seeds Valencia Martini Craft Swirl', true),
  ('Aqui Cucumber Mint Martini Craft Swirl', true),
  ('Aqui Gran Centenario Raspberry Martini Craft Swirl', true),
  ('Aqui Cosmo Martini Craft Swirl', true),
  ('Aqui Prickly Pear Lemon Drop Martini Craft Swirl', true),
  -- Campbell's zero-proof drinks; daily fruit flavors are not specified.
  ('Aqui Zero Proof Swirl', false),
  ('Aqui Agua Fresca', false)
) as menu(name, is_alcoholic)
on conflict (normalized_name) do nothing;
