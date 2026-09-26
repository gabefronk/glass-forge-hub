#!/bin/bash
cd /app
FILES=$(grep -rlE "(blue|sky|indigo)-[0-9]+" src/pages/MessagesInbox.jsx src/pages/ContactsDirectory.jsx src/components/contacts src/pages/ProbuildReports.jsx src/pages/JobSetup.jsx src/pages/Todos.jsx src/pages/AdminAgentCenter.jsx src/components/agent-center)
echo "$FILES"
perl -pi .tmp_retheme.pl $FILES
echo "--- remaining:"
grep -rnoE ".{0,30}(blue|sky|indigo)-[0-9]+" $FILES
