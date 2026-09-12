import { useCallback, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { invokeEdgeFunction, describeFunctionError } from "../lib/edgeFunctions";
import type { EnrollmentRequest, EnrollmentRequestPackage, EnrollmentRequestPackageMember, EnrollmentRequestPaymentProof, EnrollmentType } from "../types/database";

export type EnrollmentRequestPackageWithCourseType = EnrollmentRequestPackage & {
  course_types: { name: string; color: string } | null;
  /** The OTHER children a shared line is shared with; empty on an individual one. */
  co_sharer_student_ids: string[];
};

export type EnrollmentRequestWithDetails = EnrollmentRequest & {
  packages: EnrollmentRequestPackageWithCourseType[];
  payment_proofs: EnrollmentRequestPaymentProof[];
};

export type NewPackageInput = {
  course_type_id: number;
  program_type_id?: number | null;
  hours: number;
  package_size_label: string;
  is_bundle_pool_selection?: boolean;
  bundle_pool_label?: string | null;
  /** Confirming this line creates a SHARED (parent-owned) pool. */
  is_shared?: boolean;
  /**
   * The OTHER children it is shared with — never the student this request is
   * for, who becomes a member at confirm time because a new student has no id
   * until then.
   */
  co_sharer_student_ids?: string[];
};

export function useEnrollmentRequests() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Two extra queries (packages, proofs) batched by enrollment_request_id
  // rather than a nested PostgREST embed with per-embed ordering — this
  // codebase has hit embedding/ordering edge cases before (see useInvoices.ts)
  // and prefers resolving relations client-side.
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("enrollment_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error || !data) {
      setLoading(false);
      setError(error?.message ?? null);
      return [];
    }

    const ids = data.map((r) => r.id);
    const [packagesRes, proofsRes] = ids.length === 0
      ? [{ data: [] as EnrollmentRequestPackageWithCourseType[], error: null }, { data: [] as EnrollmentRequestPaymentProof[], error: null }]
      : await Promise.all([
          supabase
            .from("enrollment_request_packages")
            .select("*, course_types(name, color)")
            .in("enrollment_request_id", ids)
            .order("sort_order", { ascending: true }),
          supabase
            .from("enrollment_request_payment_proofs")
            .select("*")
            .in("enrollment_request_id", ids)
            .order("uploaded_at", { ascending: true }),
        ]);

    // A failure here (RLS/grants regression, transient error) would
    // otherwise silently render every request as if it had zero packages
    // and zero payment proofs — surface it instead of swallowing it.
    if (packagesRes.error || proofsRes.error) {
      setLoading(false);
      setError(packagesRes.error?.message ?? proofsRes.error?.message ?? "Failed to load package/payment-proof details");
      return [];
    }

    // Who each shared line is to be shared with. Fetched separately for the
    // same reason the two queries above are: this codebase resolves relations
    // client-side rather than nesting embeds. A line with no rows here is an
    // ordinary individual package.
    const packageIds = (packagesRes.data ?? []).map((p) => p.id as string);
    const { data: memberRows, error: membersErr } = packageIds.length === 0
      ? { data: [] as EnrollmentRequestPackageMember[], error: null }
      : await supabase
          .from("enrollment_request_package_members")
          .select("enrollment_request_package_id, student_id")
          .in("enrollment_request_package_id", packageIds);
    setLoading(false);
    if (membersErr) {
      setError(membersErr.message);
      return [];
    }
    const coSharersByPackage = new Map<string, string[]>();
    for (const m of (memberRows ?? []) as EnrollmentRequestPackageMember[]) {
      const list = coSharersByPackage.get(m.enrollment_request_package_id) ?? [];
      list.push(m.student_id);
      coSharersByPackage.set(m.enrollment_request_package_id, list);
    }

    const packagesByRequest = new Map<string, EnrollmentRequestPackageWithCourseType[]>();
    for (const row of (packagesRes.data ?? []) as EnrollmentRequestPackageWithCourseType[]) {
      const p = { ...row, co_sharer_student_ids: coSharersByPackage.get(row.id) ?? [] };
      const list = packagesByRequest.get(p.enrollment_request_id) ?? [];
      list.push(p);
      packagesByRequest.set(p.enrollment_request_id, list);
    }
    const proofsByRequest = new Map<string, EnrollmentRequestPaymentProof[]>();
    for (const proof of (proofsRes.data ?? []) as EnrollmentRequestPaymentProof[]) {
      const list = proofsByRequest.get(proof.enrollment_request_id) ?? [];
      list.push(proof);
      proofsByRequest.set(proof.enrollment_request_id, list);
    }

    setError(null);
    return data.map((r) => ({
      ...(r as EnrollmentRequest),
      packages: packagesByRequest.get(r.id) ?? [],
      payment_proofs: proofsByRequest.get(r.id) ?? [],
    })) as EnrollmentRequestWithDetails[];
  }, []);

  // Creates the request row, then its package line items, then triggers the
  // invoice+payment-link email. If the package insert fails the parent row
  // is rolled back (deleted) rather than left behind package-less — unlike
  // the request→email step below, a request with zero packages has nothing
  // for the admin to resend or a parent to pay, so there's no useful
  // "retry from the queue" state to preserve here.
  const createEnrollmentRequest = useCallback(async (input: {
    enrollment_type: EnrollmentType;
    student_id?: string | null;
    first_name: string;
    last_name: string;
    parent_full_name?: string | null;
    parent_id?: string | null; // the parent ACCOUNT, copied onto students.parent_id on confirm
    email: string; // "send updates to" contact (notification email, or student email fallback)
    student_email?: string | null; // creates the student login
    notification_email?: string | null; // the second "send updates to" address as entered
    curriculum?: string | null;
    report_card_url?: string | null;
    phone_number?: string | null; // guardian phone
    student_phone_number?: string | null; // the student's own phone
    address?: string | null;
    country?: string | null;
    graduation_year?: number | null;
    birthday?: string | null;
    school?: string | null;
    note?: string | null;
    pc_teacher_id?: string | null;
    created_by_user_id: string;
    packages: NewPackageInput[];
  }) => {
    setLoading(true);
    const { packages, ...requestFields } = input;

    const { data: request, error: requestError } = await supabase
      .from("enrollment_requests")
      .insert(requestFields)
      .select("*")
      .single();
    if (requestError || !request) {
      setLoading(false);
      const message = requestError?.message ?? "Failed to create enrollment request";
      setError(message);
      return { data: null, error: message };
    }

    // Co-sharers live in their own table, so they're stripped out of the line
    // insert and written against the ids it returns.
    const { data: packageRows, error: packagesError } = await supabase
      .from("enrollment_request_packages")
      .insert(packages.map((p, i) => ({
        course_type_id: p.course_type_id,
        program_type_id: p.program_type_id ?? null,
        hours: p.hours,
        package_size_label: p.package_size_label,
        is_bundle_pool_selection: p.is_bundle_pool_selection ?? false,
        bundle_pool_label: p.bundle_pool_label ?? null,
        is_shared: p.is_shared ?? false,
        enrollment_request_id: request.id,
        sort_order: i,
      })))
      .select("*");

    if (packagesError || !packageRows || packageRows.length !== packages.length) {
      const { error: rollbackError } = await supabase.from("enrollment_requests").delete().eq("id", request.id);
      setLoading(false);
      if (rollbackError) console.error("Failed to roll back a package-less enrollment request:", rollbackError, request.id);
      const message = packagesError?.message ?? "Failed to save package details";
      setError(message);
      return { data: null, error: message };
    }

    // A shared line whose co-sharer failed to save would be confirmed later as
    // a pool shared with nobody — a silently wrong package the family has by
    // then paid for. Roll the whole request back instead, the same way a
    // package-less one is.
    // Matched back by sort_order rather than by position, so nothing depends
    // on the insert returning rows in the order they were sent.
    const lineIdBySortOrder = new Map<number, string>(
      packageRows.map((row) => [row.sort_order as number, row.id as string]),
    );
    const memberRows = packages.flatMap((p, i) =>
      (p.co_sharer_student_ids ?? []).map((studentId) => ({
        enrollment_request_package_id: lineIdBySortOrder.get(i) as string,
        student_id: studentId,
      })),
    );
    if (memberRows.length > 0) {
      const { error: membersError } = await supabase
        .from("enrollment_request_package_members")
        .insert(memberRows);
      if (membersError) {
        const { error: rollbackError } = await supabase.from("enrollment_requests").delete().eq("id", request.id);
        setLoading(false);
        if (rollbackError) console.error("Failed to roll back an enrollment request with unsaved co-sharers:", rollbackError, request.id);
        setError(membersError.message);
        return { data: null, error: membersError.message };
      }
    }

    setLoading(false);
    setError(null);
    return {
      data: { ...(request as EnrollmentRequest), packages: packageRows as EnrollmentRequestPackage[] },
      error: null,
    };
  }, []);

  const sendInvoiceEmail = useCallback(async (opts: {
    enrollmentRequestId: string;
    coordinatorName?: string;
    invoicePdfBase64?: string;
  }) => {
    const { data, error } = await invokeEdgeFunction("send-enrollment-invoice", {
      body: {
        enrollment_request_id: opts.enrollmentRequestId,
        coordinator_name: opts.coordinatorName,
        invoice_pdf_base64: opts.invoicePdfBase64,
      },
    });
    if (error) return { error: await describeFunctionError(error) };
    if (data?.error) return { error: data.error as string };
    return { error: null };
  }, []);

  const reviewPayment = useCallback(async (opts: {
    enrollmentRequestId: string;
    action: "confirm" | "reject" | "resend_rejection";
    rejectionReason?: string;
  }) => {
    const { data, error } = await invokeEdgeFunction("review-enrollment-payment", {
      body: {
        enrollment_request_id: opts.enrollmentRequestId,
        action: opts.action,
        rejection_reason: opts.rejectionReason,
      },
    });
    if (error) return { data: null, error: await describeFunctionError(error) };
    if (data?.error) return { data: null, error: data.error as string };
    return { data, error: null };
  }, []);

  // Quick-edit for a request still "Awaiting Payment" — lets an admin fix a
  // typo (wrong email, address, etc.) before the parent has paid, without
  // deleting and recreating the whole request. Package details (course
  // type/hours/label) aren't editable here, same as course type already
  // wasn't — delete and re-create for those, since a multi-package request
  // has no single "hours" field left to patch.
  const updateEnrollmentRequest = useCallback(async (id: string, input: Partial<{
    first_name: string;
    last_name: string;
    parent_full_name: string | null;
    email: string;
    student_email: string | null;
    notification_email: string | null;
    curriculum: string | null;
    report_card_url: string | null;
    phone_number: string | null; // guardian phone
    student_phone_number: string | null; // the student's own phone
    address: string | null;
    country: string | null;
    graduation_year: number | null;
    birthday: string | null;
    school: string | null;
    note: string | null;
  }>) => {
    const { data, error } = await supabase
      .from("enrollment_requests")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) return { data: null, error: error?.message ?? "Failed to update enrollment request" };
    return { data: data as EnrollmentRequest, error: null };
  }, []);

  // Deletes a request outright — used for "Awaiting Payment" rows that were
  // created in error, and (from the wipe script's app-side equivalent) as
  // part of clearing test data. Confirmed/rejected/awaiting-review rows
  // still exist in the queue for their audit trail, so this is only ever
  // exposed in the UI for pending_payment rows. Package/proof child rows
  // cascade-delete with it.
  const deleteEnrollmentRequest = useCallback(async (id: string) => {
    const { error } = await supabase.from("enrollment_requests").delete().eq("id", id);
    return { error: error?.message ?? null };
  }, []);

  // Payment proofs live in a private bucket — admins view them via a
  // short-lived signed URL rather than a public link.
  const getProofSignedUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 3600);
    if (error || !data) return { url: null, error: error?.message ?? "Failed to sign URL" };
    return { url: data.signedUrl, error: null };
  }, []);

  return {
    loading,
    error,
    fetchAll,
    createEnrollmentRequest,
    updateEnrollmentRequest,
    deleteEnrollmentRequest,
    sendInvoiceEmail,
    reviewPayment,
    getProofSignedUrl,
  };
}
