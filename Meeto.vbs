Set WshShell = CreateObject("WScript.Shell")
Dim dir
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WshShell.CurrentDirectory = dir
WshShell.Run """" & dir & "node_modules\.bin\electron.cmd"" .", 0, False
