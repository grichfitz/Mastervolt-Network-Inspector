-- Manual yacht provisioning (platform ownership). Safe to re-run.

insert into public.yachts (slug, name)
values ('serenity', 'Serenity')
on conflict (slug) do update
  set name = excluded.name,
      updated_at = now();
