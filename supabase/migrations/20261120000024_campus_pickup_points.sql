-- Requested canonical UST pickup points. Existing UUIDs are retained so historic listings and
-- booking snapshots remain valid; only their display metadata changes.
update public.campus_pickup_points
set label = v.label,
    description = v.description,
    sort_order = v.sort_order,
    is_active = true,
    is_sample = false
from (values
  ('ffffffff-0000-4000-8000-000000000001'::uuid, 'Main Gate (Gate 1)', 'Meet at the Main Gate public waiting area.', 1),
  ('ffffffff-0000-4000-8000-000000000002'::uuid, 'P.Noval Gate (Gate 7)', 'Meet at the P.Noval Gate public waiting area.', 2),
  ('ffffffff-0000-4000-8000-000000000003'::uuid, 'Lacson Gate (Gate 14)', 'Meet at the Lacson Gate public waiting area.', 3),
  ('ffffffff-0000-4000-8000-000000000004'::uuid, 'Dapitan Gate (Gate 11)', 'Meet at the Dapitan Gate public waiting area.', 4),
  ('ffffffff-0000-4000-8000-000000000005'::uuid, 'Main Building', 'Meet at the Main Building public lobby.', 5)
) as v(id, label, description, sort_order)
where campus_pickup_points.id = v.id;

insert into public.campus_pickup_points (id, label, description, sort_order, is_active, is_sample)
values ('ffffffff-0000-4000-8000-000000000006', 'UST Hospital', 'Meet at the UST Hospital public lobby.', 6, true, false)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true,
  is_sample = false;
