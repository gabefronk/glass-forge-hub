import { MoreVertical, Trash2, Ban, DollarSign } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function RowActions({ row, onDelete, onEdit }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-2 rounded hover:bg-white/10 transition-colors shrink-0"
          aria-label="Fee line actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onEdit(row.id, { billable: !row.billable })}>
          {row.billable ? (
            <>
              <Ban className="h-4 w-4 mr-2" /> Mark non-billable
            </>
          ) : (
            <>
              <DollarSign className="h-4 w-4 mr-2" /> Mark billable
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (confirm(`Delete this fee line?\n${row.job_name_norm} — ${row.job_date}`)) onDelete(row.id);
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete line
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
