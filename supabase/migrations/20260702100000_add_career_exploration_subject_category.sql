-- Add "Career Exploration" as a Beyond Academics subject section, alongside
-- the existing "Passion Projects" section. Both now sit directly under
-- Beyond Academics in the app's subject-picking UI (no separate "Section"
-- step any more -- see db/docs/SUBJECT_HIERARCHY.md), with this row only
-- used to group/label subjects via <optgroup>, not to gate navigation.
insert into public.subject_categories (name, type, sort_order, is_active)
values ('Career Exploration', 'beyond_academic', 4, true);
