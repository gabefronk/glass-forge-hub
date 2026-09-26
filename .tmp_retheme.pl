s/(?<![\w:-])bg-blue-600\b/bg-[var(--gf-teal-600)]/g;
s/(?<![\w:-])bg-blue-(700|800)\b/bg-[var(--gf-teal-600)] hover:bg-[var(--gf-teal-700)]/g;
s/(?<![\w-])text-blue-(600|700|800)\b/text-[var(--gf-teal-600)]/g;
s/(?<![\w-])text-(blue-900|blue-950|sky-900)\b/text-[var(--gf-teal-800)]/g;
s/(?<![\w-])bg-(blue|sky)-(50|100)\b/bg-[var(--gf-teal-050)]/g;
s/(?<![\w-])border-(blue-100|blue-200|blue-300|sky-200)\b/border-[var(--gf-border)]/g;
s/(?<![\w-])((?:focus:|focus-visible:)?ring)-(blue|sky|indigo)-\d+\b/$1-[var(--gf-teal-500)]/g;
