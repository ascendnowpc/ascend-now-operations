-- Rename Batu Ozcelik's student id from the old bare-sequence format (S1) to
-- the new mnemonic format (20260804000500/000600) so the one real student in
-- the system matches the format every new student now gets. Uses his
-- original sequence number (1) rather than burning a fresh nextval() — he
-- was already S1 (sequence value 1); this only changes how that renders,
-- not his position: BATO26-1.
--
-- students.id is referenced by 14 FK columns across the schema, verified
-- live via information_schema (content_uploads, coordinator_logs,
-- enrollment_requests, generated_papers, invoices,
-- monthly_report_student_stats, monthly_report_student_subject_stats,
-- package_renewal_requests, pc_student_assignments,
-- session_log_pool_resolutions, session_logs, student_packages,
-- subject_notes, submissions) — more than this repo's own docs listed from
-- memory, which is exactly why it was checked live instead of assumed.
-- Postgres enforces those FKs with NOT DEFERRABLE constraint triggers, so
-- updating the parent and its children in either order would fail the
-- constraint mid-transaction. session_replication_role = replica disables
-- all triggers (including FK enforcement) for the transaction, same
-- technique already used by
-- 20260803000000_purge_teachers_students_sessions.sql ("to sidestep FK
-- ordering").
--
-- Checked live: no storage.objects row has a 'S1/' (or bare 'S1') path in
-- any bucket, so there are no student-scoped storage files that also need
-- moving alongside this rename.

begin;
set local session_replication_role = replica;

update public.students set id = 'BATO26-1' where id = 'S1';

update public.content_uploads set student_id = 'BATO26-1' where student_id = 'S1';
update public.coordinator_logs set student_id = 'BATO26-1' where student_id = 'S1';
update public.enrollment_requests set student_id = 'BATO26-1' where student_id = 'S1';
update public.generated_papers set student_id = 'BATO26-1' where student_id = 'S1';
update public.invoices set student_id = 'BATO26-1' where student_id = 'S1';
update public.monthly_report_student_stats set student_id = 'BATO26-1' where student_id = 'S1';
update public.monthly_report_student_subject_stats set student_id = 'BATO26-1' where student_id = 'S1';
update public.package_renewal_requests set student_id = 'BATO26-1' where student_id = 'S1';
update public.pc_student_assignments set student_id = 'BATO26-1' where student_id = 'S1';
update public.session_log_pool_resolutions set student_id = 'BATO26-1' where student_id = 'S1';
update public.session_logs set student_id = 'BATO26-1' where student_id = 'S1';
update public.student_packages set student_id = 'BATO26-1' where student_id = 'S1';
update public.subject_notes set student_id = 'BATO26-1' where student_id = 'S1';
update public.submissions set student_id = 'BATO26-1' where student_id = 'S1';

set local session_replication_role = default;
commit;
