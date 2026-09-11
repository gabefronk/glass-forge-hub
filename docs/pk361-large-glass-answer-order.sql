SELECT WindowID,Name,WindowInheritsID FROM Windows ORDER BY WindowID
;;;
SELECT DISTINCT q.BackendName AS QuestionName,a.AnswerID,a.AnswerOrder,a.BackendName,a.StringValue,a.Visible FROM WindowQuestionsToAnswers wa JOIN Questions q ON q.QuestionID=wa.QuestionID JOIN Answers a ON a.AnswerID=wa.AnswerID WHERE q.BackendName IN ('Glass Thickness','Glass Thickness Configuration') ORDER BY q.BackendName,a.AnswerOrder
