import { AMSCO_SERIES, selectedSeries } from "./amscoConfiguratorModel.js";
import { standardSizeGrid } from "./amscoStandardSizes.js";
import { createBuilderLine } from "./windowBuilderModel.js";

export const CONFIGURATOR_PAGES = ["Product Selection", "Size & Unit Details", "Design Options", "Advanced Options", "Grilles", "Installation Options", "Service", "Informational Values", "Ratings", "Line Level Attributes"];

// Exact Studio SH call-menu values observed in Navigator on 2026-09-11.
// Pricebook grid breakpoints are not the same as selectable catalog call sizes.
export const STUDIO_SH_CALL_SIZES = Object.freeze({
  widths: Object.freeze([12, 18, 24, 30, 36, 42, 48]),
  heights: Object.freeze([24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96])
});
export const COZE_CHOICES = ["CozE (LowE)", "CozE Tint (LowE 240)", "CozE Max (LowE 340)", "CozE HV (LowE 366)", "CozE Solar (LowE 180)", "CozE HV Bird Glass"];
export function newConfiguratorLine() {
  return createBuilderLine(undefined, { style: "", options: { series: AMSCO_SERIES[0].value } });
}
export function isPristineConfiguratorLine(line) {
  return !line.style && !line.width && !line.height && !line.room && !line.mark && Number(line.qty) === 1 &&
    (line.dimension_basis || "call") === "call" &&
    Object.entries(line.options || {}).every(([key, value]) => key === "series" && value === AMSCO_SERIES[0].value);
}
export function numberWideChoices(line) {
  // Only expose multi-wide choices observed for this operation. Other saved
  // assemblies remain visible as saved choices, never silently coerced.
  return /single hung/i.test(line.style || "") && !/geometric/i.test(line.style) ? [1, 2, 3, 4, 5, 6] :
    /casement/i.test(line.style || "") ? [1, 2] : [1];
}
export function changeProduct(line, style, series = selectedSeries(line)) {
  const options = { ...line.options, series };
  for (const key of ["number_wide", "operation", "sash_split", "unit_type"]) delete options[key];
  return { ...line, style, width: "", height: "", dimension_basis: "call", options };
}
export function changeConfiguratorSeries(line, series) {
  // The selection branch starts over when series changes; explicit finish and
  // glass requirements stay on the line so they cannot disappear unnoticed.
  return changeProduct(line, "", series);
}
export function changeNumberWide(line, number) {
  const options = { ...line.options };
  if (number === "") delete options.number_wide;
  else options.number_wide = Number(number);
  delete options.operation;
  return { ...line, width: "", height: "", options };
}
export function callSizeMenu(line, series = selectedSeries(line)) {
  if (!line.style || Number(line.options?.number_wide || 1) !== 1) return null;
  if (series === AMSCO_SERIES[0].value && line.style === "Studio Single Hung") {
    return { source: "online", widths: [...STUDIO_SH_CALL_SIZES.widths],
      heightsByWidth: Object.fromEntries(STUDIO_SH_CALL_SIZES.widths.map(width => [width, [...STUDIO_SH_CALL_SIZES.heights]])) };
  }
  const grid = standardSizeGrid(line, series);
  return grid ? { ...grid, source: "pricebook" } : null;
}
export function chooseCallWidth(line, width, menu = callSizeMenu(line)) {
  const value = width === "" ? "" : Number(width);
  const heights = menu?.heightsByWidth[String(value)] || [];
  return { width: value, height: heights.includes(Number(line.height)) ? Number(line.height) : "", dimension_basis: "call" };
}
export function configurationReadiness(line, { legacy = false } = {}) {
  const series = selectedSeries(line), wide = line.options?.number_wide ?? (legacy ? 1 : "");
  const product = !!series && !!line.style?.trim() && line.style !== "Custom" &&
    Number.isInteger(Number(wide)) && Number(wide) >= 1 && Number(wide) <= 6;
  const size = product && [line.width, line.height].every(value => value !== "" && Number.isFinite(Number(value)) && Number(value) > 0) &&
    ["call", "frame", "rough_opening"].includes(line.dimension_basis);
  const quantity = Number.isInteger(Number(line.qty)) && Number(line.qty) >= 1 && Number(line.qty) <= 1000;
  return { product, size, quantity, canSave: size && quantity };
}
export function frameSize(line, price) {
  const frame = price?.status === "priced" ? price.frame_dimensions : null;
  if (frame && [frame.width, frame.height].every(value => Number.isFinite(Number(value)) && Number(value) > 0)) return frame;
  if (line.dimension_basis === "frame") return { width: line.width, height: line.height };
  if (selectedSeries(line) === AMSCO_SERIES[0].value && line.style === "Studio Single Hung" && Number(line.options?.number_wide || 1) === 1 && line.dimension_basis === "call") {
    return { width: Number(line.width) > .5 ? Number(line.width) - .5 : "", height: Number(line.height) > .5 ? Number(line.height) - .5 : "" };
  }
  return null;
}
