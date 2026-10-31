// The job's flashing / install guide (Oct 31): the exact version its customer approved, stored
// as a private Hub file and opened through a 5-minute signed link, so installers don't need
// access to Gabe's Drive.
import { useState } from 'react';
import { base44 } from '@/api/base44Client';

// The tab opens on the click (so it isn't blocked as a popup) and is pointed at the signed link
// once it arrives.
export async function openPrivateFile(fileUri) {
  const tab = window.open('', '_blank');
  try {
    const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 300 });
    if (tab) tab.location.href = signed_url; else window.location.assign(signed_url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export default function FlashingGuideLink({ job, color }) {
  const [state, setState] = useState('');
  if (!job?.flashing_method) return null;
  if (!job.flashing_guide_file_uri) return <span>{job.flashing_method}</span>;
  const open = () => {
    setState('Opening…');
    openPrivateFile(job.flashing_guide_file_uri).then(() => setState(''), () => setState("Couldn't open the guide"));
  };
  return (
    <button type="button" onClick={open} title={job.flashing_guide_version ? `Version ${job.flashing_guide_version}, as approved with the YA quote` : undefined}
      className="m-0 cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] hover:underline" style={{ color }}>
      {state || job.flashing_method}
    </button>
  );
}
