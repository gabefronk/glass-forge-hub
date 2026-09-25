// Shared static reference data for the Summit field-service section.
// No pricing lives here — this is crew reference only.

export const DIP_SWITCHES = [
  {
    number: 1,
    name: "Current limit bypass",
    description: "Bypasses the motor current-limit safety circuit.",
    warning: "Use only for diagnostics. Restore before returning the door to service.",
  },
  {
    number: 2,
    name: "Everest motor",
    description: "Selects the Everest motor profile on the control board.",
    warning: "Must match the installed motor. A mismatch prevents the door from running correctly.",
  },
  {
    number: 3,
    name: "Eyeball sensor bypass",
    description: "Bypasses the photo-eye (eyeball) safety sensor.",
    warning: "Never leave bypassed in normal operation — the door will not reverse on an obstruction.",
  },
  {
    number: 4,
    name: "Battery fault bypass",
    description: "Bypasses the battery-fault detection circuit.",
    warning: "Use only for diagnostics. Restore before returning the door to service.",
  },
  {
    number: 5,
    name: "Desensitize current trip — stage 1",
    description: "Adjusts current-trip sensitivity, first stage.",
    warning: "Alters how the door responds to obstructions. Change deliberately per SA-0078.",
  },
  {
    number: 6,
    name: "Desensitize current trip — stage 2",
    description: "Adjusts current-trip sensitivity, second stage.",
    warning: "Alters how the door responds to obstructions. Change deliberately per SA-0078.",
  },
  {
    number: 7,
    name: "90-degree master box",
    description: "Configures the master control box for 90-degree (quarter-turn) applications.",
    warning: "Set only when the installation is a 90-degree master box.",
  },
  {
    number: 8,
    name: "Memory reset",
    description: "Resets the control board memory.",
    warning: "Clears all learned settings. Re-teach limits and travel after resetting.",
  },
];

export const SUMMIT_DOCS = [
  { label: "Field sheet Rev 4", url: "https://drive.google.com/file/d/1BW9WaidpHocXNIEro-fAGYSVDJKCR1kF/view", note: "Quick field reference." },
  { label: "BiPart field guide", url: "https://drive.google.com/file/d/1iSGa_9M3bVRGPalrNyZsdmWsOYC5kXxB/view", note: "BiPart door setup and service." },
  { label: "SA-0078 — DIP switch + error codes", url: "https://drive.google.com/file/d/16ccsKSwLksMimBNDLwzZW-nOJUkHS4S9/view", note: "DIP switch map and blink code definitions." },
  { label: "SA-0089 — Potentiometers", url: "https://drive.google.com/file/d/1RHHlVW1W5Y24DdZnzytCAHvb57ZukEG5/view", note: "Pot locations, adjustments, and baselines (2017 & 2019 manuals)." },
  { label: "Motion sensor", url: "https://drive.google.com/file/d/1bvJhjiO8bP8wOTwR7gEzfKnZ3rh7H0V2/view", note: "Motion sensor setup and service." },
  { label: "Full cert folder", url: "https://drive.google.com/drive/folders/1Poe1RCwsbX0LNrX5yjGiF_FpjK5cIkrY", note: "Entire Summit certification library in Drive." },
];

// Doc links keyed for troubleshooter leaf reuse.
export const DOC = {
  fieldSheet: { label: "Field sheet Rev 4", url: SUMMIT_DOCS[0].url },
  bipart: { label: "BiPart field guide", url: SUMMIT_DOCS[1].url },
  sa0078: { label: "SA-0078 — DIP switch + error codes", url: SUMMIT_DOCS[2].url },
  sa0089: { label: "SA-0089 — Potentiometers", url: SUMMIT_DOCS[3].url },
  motion: { label: "Motion sensor", url: SUMMIT_DOCS[4].url },
  folder: { label: "Full cert folder", url: SUMMIT_DOCS[5].url },
};

// Real job-site hardware photo registry. URLs stay empty until the photos arrive;
// PhotoSlot renders a neutral "photo coming" placeholder. No stock or AI images —
// only real photos of the actual hardware.
export const SUMMIT_PHOTOS = {
  dip_switch_bank: { label: "DIP switch bank", caption: "Control board DIP switch bank — Rev 4 layout. Match positions to SA-0078 before changing anything.", url: "" },
  potentiometer_row: { label: "Potentiometer row", caption: "Potentiometer row on the control board. Do not adjust from memory — refer to SA-0089.", url: "" },
  motor_hub_ports: { label: "Motor hub ports with cables", caption: "Motor hub ports with cables. Use this view for the port-swap vs cable-swap decision.", url: "" },
  touchscreen: { label: "Wall touchscreen control", caption: "Wall-mounted touchscreen control (9-in-1 / 12-in-1). Confirm the screen responds before deeper checks.", url: "" },
  motion_sensor: { label: "Motion sensor faceplate", caption: "Motion sensor faceplate. Check alignment and that the lens is clean and unobstructed.", url: "" },
};

// Stronger card shadow for the Summit section — gives cards pop in bright daylight.
export const SUMMIT_CARD_SHADOW = "0 1px 3px rgba(21,24,26,.08), 0 12px 28px -14px rgba(21,24,26,.22)";