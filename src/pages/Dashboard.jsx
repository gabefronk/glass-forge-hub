import Todos from "@/pages/Todos";
import { useAuth } from "@/lib/AuthContext";
import PersonalWorkContext from "@/components/dashboard/PersonalWorkContext";

export default function Dashboard() {
  const { user } = useAuth();
  return <Todos key={user?.id || "signed-out"} context={<PersonalWorkContext key={user?.id || "signed-out"} />} />;
}
