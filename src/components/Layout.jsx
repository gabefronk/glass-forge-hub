import { Outlet } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-background">
      <YaFeesSidebar />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}