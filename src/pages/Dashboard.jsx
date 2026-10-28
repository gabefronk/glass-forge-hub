import Todos from "@/pages/Todos";
import { useAuth } from "@/lib/AuthContext";
import PersonalWorkContext from "@/components/dashboard/PersonalWorkContext";
import TodayPlayByPlay from "@/components/dashboard/TodayPlayByPlay";

// The Today tab: today's schedule as a play-by-play above the task lists, the
// same tasks and actions as before, and the week-ahead job context below.
export default function Dashboard() {
  const { user } = useAuth();
  const identity = user?.id || "signed-out";
  return (
    <Todos
      key={identity}
      dayPlan={({ tasks, jobs, today, loading, error }) => (
        <TodayPlayByPlay key={identity} today={today} tasks={tasks} jobs={jobs} tasksLoading={loading} tasksError={error} />
      )}
      context={<PersonalWorkContext key={identity} />}
    />
  );
}
