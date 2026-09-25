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
  dip_switch_bank: { label: "DIP switch bank", caption: "Control board DIP switch bank (CTS 206-8) with green power + blue status LEDs. Match positions to SA-0078 before changing anything.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/a9177da86_dip-bank.jpg" },
  potentiometer_row: { label: "Potentiometer row", caption: "Potentiometer row — ACCEL, DECEL, MAX SPEED, SPEED, FORCE, FINE FORCE. Do not adjust from memory — refer to SA-0089.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/2c4879682_pots-row.jpg" },
  motor_hub_ports: { label: "Motor hub ports with cables", caption: "Motor hub / control board ports — ENCODER, CLUTCH, BRAKE, AUX OUT, SENSOR, SUPER CABLE. Use this view for the port-swap vs cable-swap decision.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/a1cc73344_motor-hub-ports.jpg" },
  touchscreen: { label: "12-in-1 touchscreen soft-reset page", caption: "12-in-1 touchscreen soft-reset page — move the door fully closed, then press CLOSE.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/ae79362ba_touchscreen-reset.jpg" },
  motion_sensor: { label: "Motion sensor faceplate", caption: "Motion sensor faceplate (Summit). Check alignment and that the lens is clean and unobstructed.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/79a5a8028_motion-sensor.jpg" },
};

// Stronger card shadow for the Summit section — gives cards pop in bright daylight.
export const SUMMIT_CARD_SHADOW = "0 1px 3px rgba(21,24,26,.08), 0 12px 28px -14px rgba(21,24,26,.22)";

// Summit field troubleshooter meta (v1.1) — golden rules, DIP functions, blink codes,
// potentiometers, and the light-pattern decoder. Source of truth for the DIP page,
// potentiometer page, and per-node reference panels.
export const SUMMIT_META = {
  name: "Summit Automation Field Troubleshooter",
  version: "1.1",
  summit_tech_phone: "480-500-5468",
  provenance_levels: {
    factory: "From a published Summit document (SA-sheet cited)",
    field_verified: "Confirmed working on a real BFS job",
    unconfirmed: "Best-practice inference - verify with Summit before relying on it",
  },
  golden_rules: [
    "Try the factory SOFT RESET before anything else - it is Summit's published first fix for flashing lights, stopping short, and not moving. [factory: SA-0037]",
    "UNLOCK is the ONLY stop button during limit programming. Outside programming, holding STOP 10 sec is the reset trigger - that is normal. [field_verified + SA-0037]",
    "Never hard reset a programmed door - hard reset = memory wipe of open/close limits and current limits. [factory: SA-0037 term definitions]",
    "DIP 8 = Memory Reset (factory name, SA-0078). Flipping it wipes programming. Only touch it when you intend to reprogram.",
    "12-in-1 touchscreen NEVER plugs direct to the motor hub - daughter board required or permanent damage. [factory: SA-0032]",
    "Red 2nd battery lead stays disconnected until permanent power / final trim. [factory: SA-0015]",
    "Awning/tilt-up: mandatory 18-minute dwell time between full cycles - warranty item. [factory: SA-0090]",
  ],
  dip_switch_functions: {
    source: "factory: SA-0078 (06/24/2025) - Peak/Everest. Function is active when the switch is flipped RIGHT. Does not apply to Mesa or Pivot systems.",
    1: "Current Limit Bypass",
    2: "Everest Motor",
    3: "Eyeball Sensor Bypass",
    4: "Battery Fault Bypass",
    5: "Desensitize current trip - Stage 1",
    6: "Desensitize current trip - Stage 2",
    7: "90-Degree Master Control Box",
    8: "Memory Reset (wipes programming - the factory name for what we call DIP 8 programming mode)",
  },
  blink_codes: {
    source: "factory: SA-0078 - Wall switch RED LED / control box battery switch GREEN LED. Count blinks between pauses. Does not apply to Mesa or Pivot.",
    1: "Door Unlocked",
    2: "Eyeball/Beam sensors blocked, or eyeball sensor failure",
    3: "Encoder fault",
    4: "Motion sensor fault - shorted sensor wire, wireless device failure, or wireless device dead battery",
    5: "Potential battery failure - allow 24 hours with system programmed to verify",
  },
  potentiometers: {
    source: "factory: SA-0089 (03/03/2026) - 2017 / 2019 / 2019 Fast+ control boxes",
    functions: "Acceleration, Deceleration, Max Speed, Fast Speed, Forward Crawl Speed, Reverse Crawl Speed, Force (Gross), Fine-tune Force (+/-10%)",
    note: "Ships at 20% force, ~1.2 Amp (fine tune 1.18-1.22A). Layouts differ by box year - see SA-0089 before touching. Adjust for slamming, stalling on heavy panels, or crawl-speed complaints.",
  },
  light_decoder: [
    { pattern: "SLOW flashing red + blue after power-up", meaning: "Soft-reset prompt - board lost position", action: "Manually close, press CLOSE", source: "factory: SA-0037" },
    { pattern: "RAPID flashing red + blue", meaning: "Confirmation: programming mode entered, password accepted, or feature toggled", action: "Continue your sequence", source: "factory: SA-0037" },
    { pattern: "Red + blue together ~5 sec after a button combo", meaning: "Auto-Open or Self-Close just toggled (press 1-4 in that window = 2/4/6/8 hr timer)", action: "Repeat combo to toggle back off if accidental", source: "factory: SA-0037" },
    { pattern: "RAPID red + SLOW blue", meaning: "Wrong password entered", action: "Re-enter; factory code 1234", source: "factory: SA-0037" },
    { pattern: "FLASHING red only", meaning: "ERROR state - COUNT the blinks between pauses to identify it (SA-0078 blink codes)", action: "1=unlocked, 2=eyeball sensor blocked/failed, 3=encoder, 4=motion sensor, 5=battery", source: "factory: SA-0078" },
    { pattern: "SOLID red, buttons ignored", meaning: "Passcode-armed switch waiting for code, OR dead data pair / wrong port", action: "Enter 1234 first, then wiring chain", source: "field_verified + factory: SA-0037" },
  ],
};

// Door-type diagram registry. URLs empty until the six diagrams arrive.
export const SUMMIT_DIAGRAMS = {
  biparting: { label: "Bi-Parting (Lift & Slide motor)", caption: "Bi-parting doors with Lift & Slide motor — motor placement in the in-wall pocket.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/1968ce750_ill-biparting.jpg" },
  pocketing: { label: "Pocketing", caption: "Pocketing doors — automation motor placement within the in-wall pocket (SA-0049).", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/b0067f4da_ill-pocketing.jpg" },
  stacking_multislide: { label: "Stacking / Multi-slide", caption: "Stacking doors — automation motor placement within the stub bay (SA-0052).", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/518c2c982_ill-stacking-multislide.jpg" },
  "90_degree": { label: "90-Degree Cornerless", caption: "90-degree stacking cornerless doors — motor placement within the stud bay (SA-0040).", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/60b154391_ill-90-degree.jpg" },
  pivot: { label: "Pivot", caption: "Above-header pivot door — automation motor placement within the stub bay (SA-0047).", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/557591e34_ill-pivot.jpg" },
  awning: { label: "Tilt-Up Awning Window", caption: "Tilt-up awning window — gas-strut actuator layout.", url: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/0d9a96c53_ill-awning.jpg" },
};

export function diagramKeyForSystemType(systemType) {
  const map = {
    "Bi-parting": "biparting",
    "Pocketing": "pocketing",
    "Multi-slide": "stacking_multislide",
    "Stacking": "stacking_multislide",
    "90-Degree Cornerless": "90_degree",
    "Pivot": "pivot",
    "Tilt-Up Awning Window": "awning",
  };
  return map[systemType] || null;
}