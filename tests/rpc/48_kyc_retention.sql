-- MARELE AUDIT 2026-08-03 — SecuritySectorAudit #1 (HIGH, GDPR).
-- Proves purge_expired_pii() now purges KYC identity docs for people NOT on the
-- platform while retaining them for approved (active) applicants:
--   A rejected 100d ago  -> purged (storage object + kyc row + app PII scrubbed)
--   B approved           -> retained
--   C rejected 10d ago   -> retained (dispute window not passed)
-- Runner wraps in BEGIN/ROLLBACK as postgres (purge is SECURITY DEFINER owner).

do $$
declare
  v_a uuid; v_b uuid; v_c uuid;
  v_ka uuid; v_kb uuid; v_kc uuid;
  v_pa text := 'appA/buletin.jpg'; v_pb text := 'appB/buletin.jpg'; v_pc text := 'appC/buletin.jpg';
  n int; v_name text;
begin
  -- A: rejected 100 days ago -> should be purged.
  insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, email, details, reviewed_at, created_at)
  values ('a0000000-0000-0000-0000-000000000001','courier','rejected','Ion Respins','+37360000001','a@x.md','{"x":1}'::jsonb, now() - interval '100 days', now() - interval '110 days')
  returning id into v_a;
  -- B: approved -> retained.
  insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, email, details, reviewed_at, created_at)
  values ('a0000000-0000-0000-0000-000000000002','courier','approved','Ana Aprobat','+37360000002','b@x.md','{"x":2}'::jsonb, now() - interval '200 days', now() - interval '210 days')
  returning id into v_b;
  -- C: rejected 10 days ago -> retained (< 90d).
  insert into public.onboarding_applications (user_id, applicant_type, status, full_name, phone, email, details, reviewed_at, created_at)
  values ('a0000000-0000-0000-0000-000000000004','courier','rejected','Cel Recent','+37360000003','c@x.md','{"x":3}'::jsonb, now() - interval '10 days', now() - interval '20 days')
  returning id into v_c;

  insert into public.kyc_documents (application_id, doc_type, storage_path) values (v_a,'id_card', v_pa) returning id into v_ka;
  insert into public.kyc_documents (application_id, doc_type, storage_path) values (v_b,'id_card', v_pb) returning id into v_kb;
  insert into public.kyc_documents (application_id, doc_type, storage_path) values (v_c,'id_card', v_pc) returning id into v_kc;

  insert into storage.objects (id, bucket_id, name) values (gen_random_uuid(),'kyc-documents', v_pa);
  insert into storage.objects (id, bucket_id, name) values (gen_random_uuid(),'kyc-documents', v_pb);
  insert into storage.objects (id, bucket_id, name) values (gen_random_uuid(),'kyc-documents', v_pc);

  perform public.purge_expired_pii();

  -- A purged: kyc row gone, storage object gone, application PII scrubbed.
  select count(*) into n from public.kyc_documents where id = v_ka;
  if n <> 0 then raise exception 'FAIL: A kyc_documents row not purged (% rows)', n; end if;
  select count(*) into n from storage.objects where bucket_id='kyc-documents' and name = v_pa;
  if n <> 0 then raise exception 'FAIL: A kyc storage object not purged (% rows)', n; end if;
  select full_name into v_name from public.onboarding_applications where id = v_a;
  if v_name <> 'Solicitant șters' then raise exception 'FAIL: A application PII not scrubbed (full_name=%)', v_name; end if;

  -- B retained (approved).
  select count(*) into n from public.kyc_documents where id = v_kb;
  if n <> 1 then raise exception 'FAIL: B (approved) kyc purged — must be retained'; end if;
  select count(*) into n from storage.objects where bucket_id='kyc-documents' and name = v_pb;
  if n <> 1 then raise exception 'FAIL: B (approved) storage purged — must be retained'; end if;
  select full_name into v_name from public.onboarding_applications where id = v_b;
  if v_name <> 'Ana Aprobat' then raise exception 'FAIL: B (approved) PII scrubbed — must be retained'; end if;

  -- C retained (rejected < 90d).
  select count(*) into n from public.kyc_documents where id = v_kc;
  if n <> 1 then raise exception 'FAIL: C (rejected 10d) kyc purged — dispute window not passed'; end if;
  select count(*) into n from storage.objects where bucket_id='kyc-documents' and name = v_pc;
  if n <> 1 then raise exception 'FAIL: C (rejected 10d) storage purged — must be retained'; end if;

  raise notice 'PASS: KYC retention — rejected>90d purged (storage+row+PII), approved & recent-rejected retained';
end $$;
