// Frontend copy of the easy-request preview helper.
// The backend quoting agent owns the authoritative logic; this module only
// powers the "Check your windows" preview in the quote form so the user can
// see what they have before sending.

const SUPPORTED_COLORS = ["White", "Taupe"];
const SUPPORTED_GLASS = ["CozE (LowE)"];

export const STANDARD_STUDIO_PROFILE = {
  id: "studio-single-hung-v1",
  revision: 1,
  description:
    "Studio Single Hung · Studio 1 3/8 inch Fin Setback series · CozE Low-E glass · White or Taupe · call sizes. The quoting agent fills in any missing options.",
};

export function normalizeEasyRequest(request) {
  const lines = Array.isArray(request?.lines) ? request.lines : [];
  const settings = request?.settings || {};
  const source = request?.source || {};
  const easyRequest = source.easy_request || {};
  const useStandard = easyRequest.confirmed === true;
  const dimensionBasis = easyRequest.dimension_basis || "";

  const preview = lines.map((line) => ({
    ...line,
    style: line.style || "",
    width: line.width,
    height: line.height,
    units: line.units || "in",
    dimension_basis: line.dimension_basis || "",
    room: line.room || "",
    qty: Number(line.qty) || 0,
  }));

  const questions = [];

  if (!settings.dealer) questions.push("Which dealer account should this quote use?");
  if (!String(settings.yard || "").trim()) questions.push("Which shipping yard should this quote use?");
  if (settings.gross_margin === null || settings.gross_margin === undefined || settings.gross_margin === "")
    questions.push("What gross margin should be applied?");

  const unsupported =
    useStandard &&
    ((settings.color && !SUPPORTED_COLORS.includes(settings.color)) ||
      (settings.glass && !SUPPORTED_GLASS.includes(settings.glass)) ||
      (dimensionBasis && dimensionBasis !== "call"));

  if (useStandard && unsupported) {
    if (settings.color && !SUPPORTED_COLORS.includes(settings.color))
      questions.push("The standard config supports White or Taupe; other colors need review.");
    if (settings.glass && !SUPPORTED_GLASS.includes(settings.glass))
      questions.push("The standard config supports CozE Low-E glass; other glass needs review.");
    if (dimensionBasis && dimensionBasis !== "call")
      questions.push("The standard config uses call sizes; frame or rough-opening sizes need review.");
  }

  if (!lines.length && !String(request?.request_text || "").trim())
    questions.push("Describe your windows or add a window schedule.");

  lines.forEach((line, i) => {
    const prefix = `Line ${i + 1}`;
    if (!line.style) questions.push(`${prefix}: which window style?`);
    if (!line.width || !Number.isFinite(Number(line.width))) questions.push(`${prefix}: what is the width?`);
    if (!line.height || !Number.isFinite(Number(line.height))) questions.push(`${prefix}: what is the height?`);
    if (!line.dimension_basis) questions.push(`${prefix}: are the sizes call, frame, or rough opening?`);
  });

  const ok = questions.length === 0 && !unsupported;
  const routing = unsupported ? "review" : questions.length === 0 ? "auto" : "details";

  return { preview, ok, routing, questions };
}