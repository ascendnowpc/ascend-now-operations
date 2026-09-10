import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

import LoginPage from "./pages/LoginPage";
import PublicPaymentPage from "./pages/PublicPaymentPage";

import AdminOverviewPage from "./pages/admin/AdminOverviewPage";
import AdminPcsPage from "./pages/admin/AdminPcsPage";
import AdminCcsPage from "./pages/admin/AdminCcsPage";
import AdminCcAssignmentsPage from "./pages/admin/AdminCcAssignmentsPage";
import AdminCcDetailPage from "./pages/admin/AdminCcDetailPage";
import AdminPcDetailPage from "./pages/admin/AdminPcDetailPage";
import AdminUsersPage from "./pages/admin/AdminUsersPage";
import AdminAdminsPage from "./pages/admin/AdminAdminsPage";
import AdminAdminFormPage from "./pages/admin/AdminAdminFormPage";
import AdminProfilePage from "./pages/admin/AdminProfilePage";
import AdminTeachersPage from "./pages/admin/AdminTeachersPage";
import AdminStudentsPage from "./pages/admin/AdminStudentsPage";
import AdminTeacherViewPage from "./pages/admin/AdminTeacherViewPage";
import AdminTeacherFormPage from "./pages/admin/AdminTeacherFormPage";
import AdminTeacherSubjectsPage from "./pages/admin/AdminTeacherSubjectsPage";
import AdminProgramTypesPage from "./pages/admin/AdminProgramTypesPage";
import AdminSubjectsManagePage from "./pages/admin/AdminSubjectsManagePage";
import AdminSessionLogsPage from "./pages/admin/AdminSessionLogsPage";
import AdminSessionLogViewPage from "./pages/admin/AdminSessionLogViewPage";
import AdminSessionLogFormPage from "./pages/admin/AdminSessionLogFormPage";

import TeacherProfilePage from "./pages/teacher/TeacherProfilePage";
import PcProfilePage from "./pages/teacher/PcProfilePage";
import TeacherSubjectsPage from "./pages/teacher/TeacherSubjectsPage";
import TeacherNotesPage from "./pages/teacher/TeacherNotesPage";
import TeacherSessionsPage from "./pages/teacher/TeacherSessionsPage";
import TeacherStudentLogsPage from "./pages/teacher/TeacherStudentLogsPage";
import TeacherSessionViewPage from "./pages/teacher/TeacherSessionViewPage";
import TeacherSessionFormPage from "./pages/teacher/TeacherSessionFormPage";
import AdminStudentDetailPage from "./pages/admin/AdminStudentDetailPage";
import AdminHomeworkViewPage from "./pages/admin/AdminHomeworkViewPage";
import AdminPcAssignmentsPage from "./pages/admin/AdminPcAssignmentsPage";
import AdminPackagesPage from "./pages/admin/AdminPackagesPage";
import AdminReportsPage from "./pages/admin/AdminReportsPage";
import AdminTeacherHoursPage from "./pages/admin/AdminTeacherHoursPage";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import AdminAnalysisPage from "./pages/admin/AdminAnalysisPage";
import AdminZoomInvoicesPage from "./pages/admin/AdminZoomInvoicesPage";
import AdminEnrollStudentPage from "./pages/admin/AdminEnrollStudentPage";
import AdminEnrollmentsPage from "./pages/admin/AdminEnrollmentsPage";
import AdminParentsPage from "./pages/admin/AdminParentsPage";
import AdminParentFormPage from "./pages/admin/AdminParentFormPage";
import AdminParentPackagesPage from "./pages/admin/AdminParentPackagesPage";
import AdminParentPackageFormPage from "./pages/admin/AdminParentPackageFormPage";
import AdminStudentFormPage from "./pages/admin/AdminStudentFormPage";

import TeacherHomeworkPage from "./pages/teacher/TeacherHomeworkPage";
import TeacherHomeworkReviewPage from "./pages/teacher/TeacherHomeworkReviewPage";
import TeacherWholePaperReviewPage from "./pages/teacher/TeacherWholePaperReviewPage";
import TeacherQuestionPhotoReviewPage from "./pages/teacher/TeacherQuestionPhotoReviewPage";
import TeacherStudentsPage from "./pages/teacher/TeacherStudentsPage";
import TeacherStudentDetailPage from "./pages/teacher/TeacherStudentDetailPage";
import TeacherHoursPage from "./pages/teacher/TeacherHoursPage";
import TeacherInvoicesPage from "./pages/teacher/TeacherInvoicesPage";
import TeacherRenewalRequestsPage from "./pages/teacher/TeacherRenewalRequestsPage";
import AdminRenewalRequestsPage from "./pages/admin/AdminRenewalRequestsPage";
import AdminCoordinatorLogsPage from "./pages/admin/AdminCoordinatorLogsPage";
import AdminCoordinatorLogFormPage from "./pages/admin/AdminCoordinatorLogFormPage";
import AdminCoordinatorLogViewPage from "./pages/admin/AdminCoordinatorLogViewPage";
import TeacherCoordinatorLogsPage from "./pages/teacher/TeacherCoordinatorLogsPage";
import TeacherCoordinatorLogFormPage from "./pages/teacher/TeacherCoordinatorLogFormPage";
import TeacherCoordinatorLogViewPage from "./pages/teacher/TeacherCoordinatorLogViewPage";

import StudentOverviewPage from "./pages/student/StudentOverviewPage";
import StudentPackagesPage from "./pages/student/StudentPackagesPage";
import StudentReportsPage from "./pages/student/StudentReportsPage";
import StudentSessionsPage from "./pages/student/StudentSessionsPage";
import StudentProfilePage from "./pages/student/StudentProfilePage";
import StudentMyPcPage from "./pages/student/StudentMyPcPage";
import StudentMyCcPage from "./pages/student/StudentMyCcPage";
import StudentHomeworkPage from "./pages/student/StudentHomeworkPage";
import StudentHomeworkAttemptPage from "./pages/student/StudentHomeworkAttemptPage";

import ParentChildrenPage from "./pages/parent/ParentChildrenPage";
import ParentChildOverviewPage from "./pages/parent/ParentChildOverviewPage";
import ParentChildActivityPage from "./pages/parent/ParentChildActivityPage";
import ParentChildSessionsPage from "./pages/parent/ParentChildSessionsPage";
import ParentChildHomeworkPage from "./pages/parent/ParentChildHomeworkPage";
import ParentChildReportsPage from "./pages/parent/ParentChildReportsPage";
import { ParentChildCoachPage, ParentChildCounsellorPage } from "./pages/parent/ParentChildCoachPage";
import ParentProfilePage from "./pages/parent/ParentProfilePage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pay/:token" element={<PublicPaymentPage />} />

          {/* ----------------- Admin routes ----------------- */}
          <Route
            path="/admin"
            element={<Navigate to="/admin/overview" replace />}
          />
          <Route
            path="/admin/overview"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/admins"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminAdminsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/admins/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminAdminFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/admins/:userId/edit"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminAdminFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/profile"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teachers"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminTeachersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/pcs"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPcsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/pcs/:id"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPcDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ccs"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminCcsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ccs/:id"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminCcDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/cc-assignments"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminCcAssignmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminStudentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teachers/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminTeacherFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teachers/:id"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminTeacherViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teachers/:id/edit"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminTeacherFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teacher-subjects"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminTeacherSubjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/program-types"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminProgramTypesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/subjects"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminSubjectsManagePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/session-logs"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminSessionLogsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/session-logs/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminSessionLogFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/session-logs/:id"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminSessionLogViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/session-logs/:id/edit"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminSessionLogFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminStudentFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students/:id"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminStudentDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/homework/:paperId"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminHomeworkViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/pc-assignments"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPcAssignmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/packages"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminPackagesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/teacher-hours"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminTeacherHoursPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/analysis"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminAnalysisPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/zoom-invoices"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminZoomInvoicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/parents"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminParentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/parents/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminParentFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/parents/:id/packages"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminParentPackagesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/parents/:id/packages/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminParentPackageFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/parents/:id/edit"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminParentFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students/enroll"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminEnrollStudentPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/enrollments"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminEnrollmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/renewal-requests"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminRenewalRequestsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/coordinator-logs"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminCoordinatorLogsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/coordinator-logs/new"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminCoordinatorLogFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/coordinator-logs/:id"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminCoordinatorLogViewPage />
              </ProtectedRoute>
            }
          />

          {/* ----------------- Teacher / Performance Coach routes ----------------- */}
          <Route
            path="/teacher"
            element={<Navigate to="/teacher/sessions" replace />}
          />
          <Route
            path="/teacher/profile"
            element={
              // Coaches and counsellors use the merged /teacher/pc-profile
              // instead (personal info + username/password + their public
              // profile all in one place).
              <ProtectedRoute allowedRoles={["teacher"]}>
                <TeacherProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/pc-profile"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <PcProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/subjects"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherSubjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/sessions"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherSessionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/sessions/new"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherSessionFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/sessions/:id"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherSessionViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/sessions/:id/edit"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherSessionFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/student-logs"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherStudentLogsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/notes"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherNotesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/homework"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherHomeworkPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/homework/:paperId"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherHomeworkReviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/homework/:paperId/whole-paper"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherWholePaperReviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/homework/:paperId/question/:questionId"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherQuestionPhotoReviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/students"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherStudentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/students/:id"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherStudentDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/renewal-requests"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherRenewalRequestsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/coordinator-logs"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherCoordinatorLogsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/coordinator-logs/new"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherCoordinatorLogFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/coordinator-logs/:id"
            element={
              <ProtectedRoute allowedRoles={["performance_coach", "college_counselor"]}>
                <TeacherCoordinatorLogViewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/invoices"
            element={
              <ProtectedRoute allowedRoles={["teacher"]}>
                <TeacherInvoicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/hours"
            element={
              <ProtectedRoute allowedRoles={["teacher", "performance_coach", "college_counselor"]}>
                <TeacherHoursPage />
              </ProtectedRoute>
            }
          />

          {/* ----------------- Student routes ----------------- */}
          <Route path="/student" element={<Navigate to="/student/overview" replace />} />
          <Route
            path="/student/overview"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/packages"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentPackagesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/reports"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/sessions"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentSessionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/homework"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentHomeworkPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/homework/:paperId"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentHomeworkAttemptPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/my-pc"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentMyPcPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/my-cc"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentMyCcPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/profile"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentProfilePage />
              </ProtectedRoute>
            }
          />

          {/* ----------------- Parent routes ----------------- */}
          {/* A parent's dashboard spans siblings, so the landing page is the
              children list rather than one record's overview; every per-child
              screen carries that child's id in the URL. */}
          <Route path="/parent" element={<Navigate to="/parent/children" replace />} />
          <Route
            path="/parent/children"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildrenPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId/activity"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildActivityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId/sessions"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildSessionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId/homework"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildHomeworkPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId/reports"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId/coach"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildCoachPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/children/:studentId/counsellor"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentChildCounsellorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parent/profile"
            element={
              <ProtectedRoute allowedRoles={["parent"]}>
                <ParentProfilePage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
