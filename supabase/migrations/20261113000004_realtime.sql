-- =====================================================================
-- 4 of 4 · Real-time updates
--
-- Tablets subscribe to two kinds of rows:
--   events.version       bumped by every seating change  → reload that event's seating
--   restaurants.version  bumped when layouts or live events change → reload the menu / layouts
-- Supabase Realtime only sends changes for tables in this publication, and it checks the
-- RLS rules from file 2, so a tablet only hears about its own restaurant.
-- =====================================================================

alter publication supabase_realtime add table public.restaurants, public.events;
