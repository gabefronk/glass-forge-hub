import { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Link2, Plus, MapPin } from "lucide-react";

// Score a job by similarity to the row being assigned.
// Heavier weight on hard identifiers (PO/OE), then shared name tokens.
function scoreJob(row, job) {
  let score = 0;
  const rowPO = (row.po_number || "").toLowerCase();
  const rowOE = (row.oe_number || "").toLowerCase();
  if (rowPO && (job.po_numbers || []).map(s => s.toLowerCase()).includes(rowPO)) score += 1000;
  if (rowOE && (job.oe_numbers || []).map(s => s.toLowerCase()).includes(rowOE)) score += 1000;

  const norm = (row.job_name_norm || "").toLowerCase();
  const name = (job.canonical_name || "").toLowerCase();
  const aliases = (job.aliases || []).join(" ").toLowerCase();
  const haystack = `${name} ${aliases}`;

  // Token overlap (tokens > 2 chars to skip short noise)
  const rowTokens = norm.split(/\s+/).filter(t => t.length > 2);
  for (const t of rowTokens) {
    if (haystack.includes(t)) score += 1;
  }
  // Builder token bonus (first token is usually the builder)
  if (rowTokens.length > 0 && name.startsWith(rowTokens[0])) score += 2;
  return score;
}

export default function JobAssignPicker({ row, jobs, onAssign, onCreate }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let candidates = jobs;
    if (q) {
      candidates = jobs.filter(j => {
        const name = (j.canonical_name || "").toLowerCase();
        const aliases = (j.aliases || []).join(" ").toLowerCase();
        const addr = (j.address || "").toLowerCase();
        const pos = (j.po_numbers || []).join(" ").toLowerCase();
        const oes = (j.oe_numbers || []).join(" ").toLowerCase();
        return [name, aliases, addr, pos, oes].some(s => s.includes(q));
      });
    }
    return [...candidates]
      .map(j => ({ job: j, score: scoreJob(row, j) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.job);
  }, [jobs, search, row]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5">
          <Link2 className="h-3.5 w-3.5" />
          Assign to Job
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-w-[calc(100vw-32px)] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search name, alias, address, PO, OE..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[min(320px,60dvh)]">
            <CommandEmpty>No jobs found.</CommandEmpty>
            <CommandGroup>
              {filtered.slice(0, 50).map((job) => (
                <CommandItem
                  key={job.id}
                  value={job.id}
                  onSelect={() => {
                    onAssign(job.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <div className="min-w-0 flex flex-col break-words py-0.5">
                    <span className="font-medium text-sm">{job.canonical_name}</span>
                    {job.address && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-2.5 w-2.5" />
                        {job.address}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onCreate();
                  setOpen(false);
                  setSearch("");
                }}
                className="border-t border-border mt-1 pt-1"
              >
                <Plus className="h-4 w-4 mr-2 text-accent" />
                <span className="text-sm font-medium">Create new job from this row</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
