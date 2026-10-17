-- Brand catalogs checked 2026-10-16; each spirit also gets a shot entry.
-- Sources: https://www.diageo.com/en/our-brands
-- https://www.pernod-ricard.com/en/house-brands
-- https://www.bacardilimited.com/our-brands/portfolio/
-- https://www.brown-forman.com/brands
-- https://www.titosvodka.com/about
-- https://www.hennessy.com/en-int/collection
-- https://www.jinro-soju.com/products
insert into public.drinks (name, normalized_name, is_alcoholic)
select name || suffix,
  lower(regexp_replace(btrim(name || suffix), '\s+', ' ', 'g')),
  true
from (values
  -- Vodka
  ('Smirnoff Vodka'),
  ('Absolut Vodka'),
  ('Tito''s Handmade Vodka'),
  ('Grey Goose Vodka'),
  ('Ketel One Vodka'),
  ('Ciroc Vodka'),
  -- Tequila
  ('Don Julio Tequila'),
  ('Patron Tequila'),
  ('Casamigos Tequila'),
  ('Herradura Tequila'),
  ('El Jimador Tequila'),
  -- Whiskey, bourbon, and Scotch
  ('Jack Daniel''s Tennessee Whiskey'),
  ('Jameson Irish Whiskey'),
  ('Bulleit Bourbon'),
  ('Crown Royal Canadian Whisky'),
  ('Johnnie Walker Scotch Whisky'),
  ('Dewar''s Scotch Whisky'),
  ('Woodford Reserve Bourbon'),
  -- Rum
  ('Bacardi Rum'),
  ('Captain Morgan Spiced Rum'),
  ('Malibu Coconut Rum'),
  -- Gin
  ('Tanqueray Gin'),
  ('Bombay Sapphire Gin'),
  ('Beefeater Gin'),
  -- Mezcal, cognac, and soju
  ('Del Maguey Mezcal'),
  ('Hennessy Cognac'),
  ('Martell Cognac'),
  ('D''usse Cognac'),
  ('Jinro Soju'),
  -- Liqueurs
  ('Baileys Irish Cream'),
  ('Kahlua Coffee Liqueur')
) as spirits(name)
cross join (values (''), (' Shot')) as servings(suffix)
on conflict (normalized_name) do nothing;
