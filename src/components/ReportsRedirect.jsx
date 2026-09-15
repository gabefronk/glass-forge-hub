import { Navigate, useLocation } from "react-router-dom";

// Reports has been merged into the Jobs tab as a "Field reports" view. Old
// /reports deep links (saved reports, project opens) redirect to /jobs with
// their query params preserved so the Jobs hub can route into the reports view.
export default function ReportsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: "/jobs", search: loc.search }} replace />;
}