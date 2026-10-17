insert into public.drinks (name, normalized_name, is_alcoholic)
select name, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')), true
from (values
  ('Vodka Shot'),
  ('Gin Shot'),
  ('Tequila Shot'),
  ('Whiskey Shot'),
  ('Bourbon Shot'),
  ('Scotch Shot'),
  ('Rum Shot'),
  ('Mezcal Shot'),
  ('Brandy Shot'),
  ('Cognac Shot'),
  ('Fireball Shot'),
  ('Jägermeister Shot'),
  ('Soju Shot')
) as shots(name)
on conflict (normalized_name) do nothing;
