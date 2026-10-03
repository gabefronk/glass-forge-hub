// A job with an open service item is never "Complete". Wherever a job's status is shown
// (Jobs list, job page, workspace panel), run it through this with the open count.
export const SERVICE_OPEN_STATUS = { label: "Service open", key: "service_open", bg: "#FCEDEC", text: "#A43432" };

export function holdForService(status, openCount) {
  if (!openCount || status?.key !== "complete") return status;
  return SERVICE_OPEN_STATUS;
}
