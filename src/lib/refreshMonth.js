import { base44 } from "@/api/base44Client";
export async function refreshMonth(month, onProgress = () => {}) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Choose a valid month.");
  const [year, number] = month.split("-").map(Number);
  const scope = { start_date: month + "-01", end_date: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
  const results = {}, errors = [];
  for (const [name, label, body] of [
    ["syncGoogleCalendarEvents", "Pulling Google Calendar", { ...scope, pull_only: true }],
    ["fetchProbuildPosts", "Pulling ProBuild notes and pricing", scope],
    ["fetchCalendarEvents", "Recalculating calendar labor", scope],
    ["auditFieldReports", "Checking this month's field reports", { ...scope, force: true }]
  ]) {
    onProgress(label);
    try {
      const response = await base44.functions.invoke(name, body);
      const data = response.data;
      if (data?.error || data?.ok === false) throw new Error(data.error || "The source reported an incomplete refresh.");
      results[name] = data;
    } catch (error) {
      errors.push(label + ": " + (error?.response?.data?.error || error.message || "Request failed"));
    }
  }
  if (errors.length) throw new Error(errors.join(" · "));
  return results;
}
