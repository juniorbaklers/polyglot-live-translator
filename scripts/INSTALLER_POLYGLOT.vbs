Option Explicit
Dim shell, files, folder, result, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
On Error Resume Next
result = shell.Run("py -3.11 --version", 0, True)
If Err.Number <> 0 Then
  result = -1
  Err.Clear
End If
On Error GoTo 0
If result <> 0 Then
  MsgBox "Python 3.11 est requis. Installez-le avec le lanceur Python, puis relancez ce fichier.", vbInformation, "Polyglot"
  shell.Run "https://www.python.org/downloads/"
Else
  command = "py -3.11 " & Chr(34) & folder & "\installation\windows_installer.py" & Chr(34)
  shell.Run command, 0, False
End If
