import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import JobsHub from "@/pages/JobsHub";
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={["/jobs"]}><JobsHub /></MemoryRouter>);
