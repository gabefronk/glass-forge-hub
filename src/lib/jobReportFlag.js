// Email report feature flag: the composition core and review UI exist, but the
// send path is undecided (Outlook draft vs primary-alias change is Gabriel's
// call). Keep the UI dark until the draft function exists and he has chosen.
// Nothing here publishes unfinished email UI with the job-page cleanup.
export const JOB_REPORT_EMAIL_ENABLED = false;
