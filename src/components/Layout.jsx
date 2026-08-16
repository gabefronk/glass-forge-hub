import { Outlet } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";

export default function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <YaFeesSidebar />
      <main className="sm:ml-60 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}